import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { EventEmitter } from 'node:events';
import { createWriteStream, mkdirSync } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';
import {
  createMatch,
  addPlayer,
  stepMatch,
  snapshotEntities,
  decodeInput,
  encodeSnapshot,
  FIXED_DT,
} from '@dogfight/shared/network';

const PORT = process.env.PORT || 3001;

// === Логування (NDJSON) ===
const LOG_DIR = process.env.LOG_DIR || 'logs';
mkdirSync(LOG_DIR, { recursive: true });

let ndjsonTransform = null;
let currentLogFile = null;

function startMatchLog(roomId) {
  const filename = join(LOG_DIR, `match-${roomId}-${Date.now()}.ndjson`);
  currentLogFile = createWriteStream(filename);
  
  ndjsonTransform = new Transform({
    objectMode: true,
    transform(chunk, _encoding, callback) {
      callback(null, JSON.stringify(chunk) + '\n');
    },
  });

  // pipeline з'єднує Transform і WriteStream, обробляючи backpressure
  pipeline(ndjsonTransform, currentLogFile).catch(err => {
    console.error('Log pipeline error:', err);
  });
  
  console.log(`Match log started: ${filename}`);
}

function logEvent(event) {
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
class Room extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.clients = new Set();
    this.chatHistory = [];
    this.match = createMatch(1280, 720, randomInt(1, 0xffffffff));
    this.queues = new Map();
    this.lastInputs = new Map();
    this.timer = null;
    this.nextTickAt = 0;
    this.stats = { tickMs: 0, jitterMs: 0, tickCount: 0 };
  }

  join(ws, playerName) {
    this.clients.add(ws);
    ws.roomId = this.id;
    ws.playerName = playerName;
    const activePlayerIds = new Set([...this.clients].map((client) => client.playerId));
    ws.playerId = Array.from({ length: 8 }, (_, index) => index + 1).find((id) => !activePlayerIds.has(id));
    ws.lastInputSeq = 0;
    ws.lastProcessedSeq = 0;
    ws.inputRate = { start: performance.now(), count: 0 };
    addPlayer(this.match, ws.playerId);
    this.queues.set(ws.playerId, []);
    this.lastInputs.set(ws.playerId, { turn: 0, thrust: false, fire: false, seq: 0 });
    this.start();
    this.emit('join', { playerName });
    logEvent({ type: 'join', roomId: this.id, playerName });
    for (const msg of this.chatHistory) {
      ws.send(JSON.stringify({ type: 'chat', ...msg }));
    }
  }

  leave(ws) {
    this.clients.delete(ws);
    this.queues.delete(ws.playerId);
    this.lastInputs.delete(ws.playerId);
    this.match.ships.delete(ws.playerId);
    this.emit('leave', { playerName: ws.playerName });
    logEvent({ type: 'leave', roomId: this.id, playerName: ws.playerName });
    if (this.clients.size === 0) {
      clearTimeout(this.timer);
      this.timer = null;
      this.match = createMatch(1280, 720, randomInt(1, 0xffffffff));
    }
  }

  broadcast(message, exclude = null) {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client !== exclude && client.readyState === 1) {
        client.send(data);
      }
    }
  }

  acceptInput(ws, input) {
    const now = performance.now();
    if (now - ws.inputRate.start >= 1000) ws.inputRate = { start: now, count: 0 };
    ws.inputRate.count += 1;
    if (ws.inputRate.count > 60) {
      ws.close(4008, 'Input rate exceeded');
      return;
    }
    if (!Number.isInteger(input.seq) || input.seq <= ws.lastInputSeq || input.seq > 0xffffffff) return;
    if (!Number.isInteger(input.turn) || input.turn < -1 || input.turn > 1 || typeof input.thrust !== 'boolean' || typeof input.fire !== 'boolean') return;
    const queue = this.queues.get(ws.playerId);
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
    const inputs = new Map();
    for (const ws of this.clients) {
      const queue = this.queues.get(ws.playerId);
      const next = queue?.shift();
      if (next) {
        ws.lastProcessedSeq = next.seq;
        this.lastInputs.set(ws.playerId, next);
      }
      const held = this.lastInputs.get(ws.playerId) || { turn: 0, thrust: false, fire: false, seq: 0 };
      inputs.set(ws.playerId, { ...held, fire: Boolean(next?.fire), seq: held.seq });
    }

    stepMatch(this.match, inputs, FIXED_DT);
    const duration = performance.now() - startedAt;
    const targetJitter = Math.abs(startedAt - this.nextTickAt);
    this.stats.tickMs += (duration - this.stats.tickMs) / Math.min(this.stats.tickCount + 1, 60);
    this.stats.jitterMs += (targetJitter - this.stats.jitterMs) / Math.min(this.stats.tickCount + 1, 60);
    this.stats.tickCount += 1;

    const entities = snapshotEntities(this.match);
    for (const ws of this.clients) {
      const snapshot = { tick: this.match.tick, ack: ws.lastProcessedSeq, entities };
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

function deliverWithNetworkConditions(ws, callback) {
  const { latency = 0, jitter = 0, drop = 0 } = ws.network || {};
  if (Math.random() < drop) return;
  const delay = Math.max(0, latency + (Math.random() * 2 - 1) * jitter);
  setTimeout(callback, delay);
}

function validateNetworkConfig(config = {}) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  return {
    latency: clamp(config.latency, 0, 500),
    jitter: clamp(config.jitter, 0, 200),
    drop: clamp(config.drop, 0, 0.2),
  };
}

const rooms = new Map();

// Створюємо стандартні кімнати при старті
for (const id of ['alpha', 'beta', 'gamma']) {
  rooms.set(id, new Room(id));
}

function getOrCreateRoom(id) {
  if (!rooms.has(id)) {
    rooms.set(id, new Room(id));
    console.log(`Room ${id} created on demand`);
  }
  return rooms.get(id);
}

// === HTTP-сервер ===
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

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
        const input = decodeInput(raw);
        const room = rooms.get(ws.roomId);
        deliverWithNetworkConditions(ws, () => room?.acceptInput(ws, input));
      } catch {
        ws.close(4001, 'Invalid binary input');
      }
      return;
    }
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.close(4001, 'Invalid JSON');
      return;
    }

    if (msg.type === 'join') {
      if (ws.roomId) return;
      clearTimeout(joinTimeout);
      const { roomId, playerName } = msg;
      if (typeof roomId !== 'string' || !/^[a-z0-9_-]{1,24}$/i.test(roomId)) {
        ws.close(4002, 'Invalid room');
        return;
      }
      const room = getOrCreateRoom(roomId);
      
      if (room.clients.size >= 8) {
        ws.close(4003, 'Room full');
        return;
      }
      ws.codec = msg.codec === 'json' ? 'json' : 'binary';
      ws.network = validateNetworkConfig(msg.network);
      room.join(ws, String(playerName || 'Anonymous').slice(0, 24));
      ws.send(JSON.stringify({
        type: 'joined', roomId, playerId: ws.playerId,
        seed: room.match.seed, width: room.match.width, height: room.match.height,
        tickRate: 30, codec: ws.codec,
      }));
      room.broadcast({ type: 'chat', playerName: 'System', text: `${playerName} joined` }, ws);
    } else if (msg.type === 'chat') {
      if (!ws.roomId) {
        ws.close(4004, 'Join a room first');
        return;
      }
      const room = rooms.get(ws.roomId);
      if (!room) return;
      const chatMsg = { playerName: ws.playerName, text: msg.text };
      room.chatHistory.push(chatMsg);
      if (room.chatHistory.length > 50) room.chatHistory.shift();
      
      logEvent({ type: 'chat', roomId: ws.roomId, playerName: ws.playerName, text: msg.text });
      
      room.broadcast({ type: 'chat', ...chatMsg });
    } else if (msg.type === 'input') {
      if (!ws.roomId) return;
      const room = rooms.get(ws.roomId);
      deliverWithNetworkConditions(ws, () => room?.acceptInput(ws, msg));
    } else if (msg.type === 'ping') {
      deliverWithNetworkConditions(ws, () => {
        deliverWithNetworkConditions(ws, () => {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'pong', sentAt: msg.sentAt }));
        });
      });
    } else {
      ws.close(4005, 'Unknown message type');
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