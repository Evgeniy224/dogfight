import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { EventEmitter } from 'node:events';
import { createWriteStream, mkdirSync } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { WebSocket, type RawData } from 'ws';
import {
  createMatch,
  addPlayer,
  stepMatch,
  snapshotEntities,
  decodeInput,
  encodeSnapshot,
  FIXED_DT,
  parseClientMessage,
  playerId,
  sequence,
} from '@dogfight/shared/network';
import type {
  ClientMessage,
  Match,
  PlayerId,
  ServerMessage,
  Sequence,
} from '@dogfight/shared/network';

type InputCommand = ReturnType<typeof decodeInput>;

declare module 'ws' {
  interface WebSocket {
    roomId?: string;
    playerName?: string;
    playerId?: PlayerId;
    codec: 'json' | 'binary';
    network: NetworkConditions;
    lastInputSeq?: Sequence;
    lastProcessedSeq?: Sequence;
    inputRate: { start: number; count: number };
    isAlive: boolean;
  }
}

interface NetworkConditions {
  latency: number;
  jitter: number;
  drop: number;
}

interface RoomPlayerEvent {
  playerName: string | undefined;
}

interface ChatEntry {
  playerName: string;
  text: string;
}

const EnvironmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_DIR: z.string().min(1).default('logs'),
});
const { PORT, LOG_DIR } = EnvironmentSchema.parse(process.env);

// === Логування (NDJSON) ===
mkdirSync(LOG_DIR, { recursive: true });

let ndjsonTransform: Transform | null = null;
let currentLogFile: ReturnType<typeof createWriteStream> | null = null;

function startMatchLog(roomId: string) {
  const filename = join(LOG_DIR, `match-${roomId}-${Date.now()}.ndjson`);
  const file = createWriteStream(filename);
  const transform = new Transform({
    objectMode: true,
    transform(chunk: unknown, _encoding: BufferEncoding, callback) {
      callback(null, `${JSON.stringify(chunk)}\n`);
    },
  });
  currentLogFile = file;
  ndjsonTransform = transform;

  // pipeline з'єднує Transform і WriteStream, обробляючи backpressure
  pipeline(transform, file).catch((error: unknown) => {
    console.error('Log pipeline error:', error);
  });
  
  console.log(`Match log started: ${filename}`);
}

function logEvent(event: Record<string, unknown>) {
  if (ndjsonTransform && ndjsonTransform.writable) {
    ndjsonTransform.write({
      timestamp: Date.now(),
      ...event,
    });
  }
}

function stopMatchLog() {
  if (ndjsonTransform && ndjsonTransform.writable) {
    ndjsonTransform.end();
  }
}

// === Кімнати ===
class Room extends EventEmitter<{
  join: [event: RoomPlayerEvent];
  leave: [event: RoomPlayerEvent];
}> {
  id: string;
  clients = new Set<WebSocket>();
  chatHistory: ChatEntry[] = [];
  match: Match;
  queues = new Map<PlayerId, InputCommand[]>();
  lastInputs = new Map<PlayerId, InputCommand>();
  timer: ReturnType<typeof setTimeout> | null = null;
  nextTickAt = 0;
  stats = { tickMs: 0, jitterMs: 0, tickCount: 0 };

  constructor(id: string) {
    super();
    this.id = id;
    this.match = createMatch(1280, 720, randomInt(1, 0xffffffff));
  }

  join(ws: WebSocket, playerName: string): PlayerId {
    const activePlayerIds = new Set([...this.clients].map((client) => client.playerId));
    const assignedPlayerId = Array.from({ length: 8 }, (_, index) => playerId(index + 1))
      .find((id) => !activePlayerIds.has(id));
    if (assignedPlayerId === undefined) throw new Error('Room has no available player slots');
    this.clients.add(ws);
    ws.roomId = this.id;
    ws.playerName = playerName;
    ws.playerId = assignedPlayerId;
    ws.lastInputSeq = sequence(0);
    ws.lastProcessedSeq = sequence(0);
    ws.inputRate = { start: performance.now(), count: 0 };
    addPlayer(this.match, assignedPlayerId);
    this.queues.set(assignedPlayerId, []);
    this.lastInputs.set(assignedPlayerId, {
      seq: sequence(0),
      tick: this.match.tick,
      turn: 0,
      thrust: false,
      fire: false,
    });
    this.start();
    this.emit('join', { playerName });
    logEvent({ type: 'join', roomId: this.id, playerName });
    for (const msg of this.chatHistory) {
      ws.send(JSON.stringify({ type: 'chat', ...msg }));
    }
    return assignedPlayerId;
  }

  leave(ws: WebSocket) {
    this.clients.delete(ws);
    const id = ws.playerId;
    if (id === undefined) return;
    this.queues.delete(id);
    this.lastInputs.delete(id);
    this.match.ships.delete(id);
    this.emit('leave', { playerName: ws.playerName });
    logEvent({ type: 'leave', roomId: this.id, playerName: ws.playerName });
    if (this.clients.size === 0) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.match = createMatch(1280, 720, randomInt(1, 0xffffffff));
    }
  }

  broadcast(message: ServerMessage, exclude: WebSocket | null = null) {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client !== exclude && client.readyState === 1) {
        client.send(data);
      }
    }
  }

  acceptInput(ws: WebSocket, input: InputCommand) {
    const now = performance.now();
    if (now - ws.inputRate.start >= 1000) ws.inputRate = { start: now, count: 0 };
    ws.inputRate.count += 1;
    if (ws.inputRate.count > 60) {
      ws.close(4008, 'Input rate exceeded');
      return;
    }
    if (ws.lastInputSeq !== undefined && input.seq <= ws.lastInputSeq) return;
    const id = ws.playerId;
    if (id === undefined) return;
    const queue = this.queues.get(id);
    if (!queue || queue.length >= 60) return;
    ws.lastInputSeq = input.seq;
    queue.push(input);
  }

  start() {
    if (this.timer) return;
    this.nextTickAt = performance.now() + FIXED_DT * 1000;
    this.scheduleNextTick();
  }

  scheduleNextTick() {
    const delay = Math.max(0, this.nextTickAt - performance.now());
    this.timer = setTimeout(() => this.tick(), delay);
  }

  tick() {
    this.timer = null;
    if (this.clients.size === 0) return;
    const startedAt = performance.now();
    const inputs = new Map<PlayerId, InputCommand>();
    for (const ws of this.clients) {
      const id = ws.playerId;
      if (id === undefined) continue;
      const queue = this.queues.get(id);
      const next = queue?.shift();
      if (next) {
        ws.lastProcessedSeq = next.seq;
        this.lastInputs.set(id, next);
      }
      const held = this.lastInputs.get(id) ?? {
        seq: sequence(0),
        tick: this.match.tick,
        turn: 0,
        thrust: false,
        fire: false,
      };
      inputs.set(id, { ...held, fire: Boolean(next?.fire), seq: held.seq });
    }

    stepMatch(this.match, inputs, FIXED_DT);
    const duration = performance.now() - startedAt;
    const targetJitter = Math.abs(startedAt - this.nextTickAt);
    this.stats.tickMs += (duration - this.stats.tickMs) / Math.min(this.stats.tickCount + 1, 60);
    this.stats.jitterMs += (targetJitter - this.stats.jitterMs) / Math.min(this.stats.tickCount + 1, 60);
    this.stats.tickCount += 1;

    const entities = snapshotEntities(this.match);
    for (const ws of this.clients) {
      const snapshot = {
        tick: this.match.tick,
        ack: ws.lastProcessedSeq ?? sequence(0),
        entities,
      };
      const payload = ws.codec === 'json'
        ? JSON.stringify({ type: 'snapshot', ...snapshot })
        : encodeSnapshot(snapshot);
      deliverWithNetworkConditions(ws, () => {
        if (ws.readyState === 1) ws.send(payload, { binary: ws.codec !== 'json' });
      });
    }

    this.nextTickAt += FIXED_DT * 1000;
    if (this.nextTickAt < performance.now() - FIXED_DT * 1000) {
      this.nextTickAt = performance.now() + FIXED_DT * 1000;
    }
    this.scheduleNextTick();
  }
}

function deliverWithNetworkConditions(ws: WebSocket, callback: () => void) {
  const { latency, jitter, drop } = ws.network;
  if (Math.random() < drop) return;
  const delay = Math.max(0, latency + (Math.random() * 2 - 1) * jitter);
  setTimeout(callback, delay);
}

function normalizeRawData(data: RawData): ArrayBuffer | ArrayBufferView {
  if (Array.isArray(data)) return Buffer.concat(data);
  return data;
}

const rooms = new Map<string, Room>();

// Створюємо стандартні кімнати при старті
for (const id of ['alpha', 'beta', 'gamma']) {
  rooms.set(id, new Room(id));
}

function getOrCreateRoom(id: string) {
  const existingRoom = rooms.get(id);
  if (existingRoom) return existingRoom;
  const room = new Room(id);
  rooms.set(id, room);
  console.log(`Room ${id} created on demand`);
  return room;
}

// === HTTP-сервер ===
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname.includes('..')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (url.pathname === '/api/rooms' && req.method === 'GET') {
    const roomList = [...rooms.values()].map(r => ({
      id: r.id,
      name: r.id.toUpperCase() + ' Arena',
      players: r.clients.size,
      maxPlayers: 8,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ rooms: roomList }));
    return;
  }

  if (url.pathname === '/api/stats' && req.method === 'GET') {
    const stats = [...rooms.values()].map((room) => ({
      roomId: room.id,
      tick: room.match.tick,
      tickMs: room.stats.tickMs,
      jitterMs: room.stats.jitterMs,
      players: room.clients.size,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tickRate: 1 / FIXED_DT, rooms: stats }));
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

// === WebSocket-сервер ===
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  ws.codec = 'binary';
  ws.network = { latency: 0, jitter: 0, drop: 0 };
  ws.inputRate = { start: performance.now(), count: 0 };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const joinTimeout = setTimeout(() => {
    if (!ws.roomId) {
      ws.close(4000, 'Join timeout');
    }
  }, 5000);

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      if (!ws.roomId) {
        ws.close(4004, 'Join a room first');
        return;
      }
      try {
        const input = decodeInput(normalizeRawData(raw));
        const room = rooms.get(ws.roomId);
        deliverWithNetworkConditions(ws, () => room?.acceptInput(ws, input));
      } catch (error: unknown) {
        console.error('Invalid binary input:', error);
        ws.close(4001, 'Invalid binary input');
      }
      return;
    }
    let untrusted: unknown;
    try {
      untrusted = JSON.parse(raw.toString());
    } catch (error: unknown) {
      console.error('Invalid client JSON:', error);
      ws.close(4001, 'Invalid JSON');
      return;
    }

    const parsedMessage = parseClientMessage(untrusted);
    if (!parsedMessage.success) {
      console.error('Invalid client message:', parsedMessage.error);
      ws.close(4001, 'Invalid message');
      return;
    }
    const message: ClientMessage = parsedMessage.data;

    switch (message.type) {
      case 'join': {
        if (ws.roomId) return;
        clearTimeout(joinTimeout);
        const room = getOrCreateRoom(message.roomId);
        if (room.clients.size >= 8) {
          ws.close(4003, 'Room full');
          return;
        }
        ws.codec = message.codec;
        ws.network = message.network;
        const joinedPlayerId = room.join(ws, message.playerName);
        ws.send(JSON.stringify({
          type: 'joined',
          roomId: message.roomId,
          playerId: joinedPlayerId,
          seed: room.match.seed,
          width: room.match.width,
          height: room.match.height,
          tickRate: 30,
          codec: ws.codec,
        }));
        room.broadcast({ type: 'chat', playerName: 'System', text: `${message.playerName} joined` }, ws);
        return;
      }
      case 'chat': {
        if (!ws.roomId || !ws.playerName) {
          ws.close(4004, 'Join a room first');
          return;
        }
        const room = rooms.get(ws.roomId);
        if (!room) return;
        const chatMessage = { playerName: ws.playerName, text: message.text };
        room.chatHistory.push(chatMessage);
        if (room.chatHistory.length > 50) room.chatHistory.shift();
        logEvent({ type: 'chat', roomId: ws.roomId, ...chatMessage });
        room.broadcast({ type: 'chat', ...chatMessage });
        return;
      }
      case 'input': {
        if (!ws.roomId) return;
        const room = rooms.get(ws.roomId);
        deliverWithNetworkConditions(ws, () => room?.acceptInput(ws, message));
        return;
      }
      case 'ping':
        deliverWithNetworkConditions(ws, () => {
          deliverWithNetworkConditions(ws, () => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'pong', sentAt: message.sentAt }));
            }
          });
        });
        return;
      default: {
        const exhaustiveCheck: never = message;
        return exhaustiveCheck;
      }
    }
  });

  ws.on('close', () => {
    clearTimeout(joinTimeout);
    if (ws.roomId) {
      const room = rooms.get(ws.roomId);
      if (room) {
        room.leave(ws);
        room.broadcast({ type: 'chat', playerName: 'System', text: `${ws.playerName} left` });
      }
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });
});

// === Heartbeat ===
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

// === Запуск ===
startMatchLog('global');

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

// === Graceful shutdown ===
process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  stopMatchLog();
  wss.clients.forEach(ws => ws.close(1001, 'Server shutting down'));
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});