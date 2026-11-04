import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { EventEmitter } from 'node:events';
import { createWriteStream, mkdirSync } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

// Імпорти з shared/
import { createWorld, stepSimulation } from '../shared/simulation.js';

const PORT = process.env.PORT || 3001;
const TICK_RATE = 30;
const ARENA_WIDTH = 1920;
const ARENA_HEIGHT = 1080;

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

  pipeline(ndjsonTransform, currentLogFile).catch(err => {
    console.error('Log pipeline error:', err);
  });
  
  console.log(`Match log started: ${filename}`);
}

function logEvent(event) {
  if (ndjsonTransform && ndjsonTransform.writable) {
    ndjsonTransform.write({ timestamp: Date.now(), ...event });
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
    
    // === СЕРВЕРНА СИМУЛЯЦІЯ ===
    this.worldData = createWorld(ARENA_WIDTH, ARENA_HEIGHT);
    this.world = this.worldData.world;
    this.ship = this.worldData.ship;
    this.inputs = {};
    this.tickInterval = null;
    // ===========================
  }

  join(ws, playerName) {
    this.clients.add(ws);
    ws.roomId = this.id;
    ws.playerName = playerName;
    ws.playerId = Math.random().toString(36).substring(2, 9);
    
    this.emit('join', { playerName });
    logEvent({ type: 'join', roomId: this.id, playerName });
    
    // Відправляємо початковий стан
    ws.send(JSON.stringify({
      type: 'snapshot',
      ship: { x: this.ship.pos.x, y: this.ship.pos.y, angle: this.ship.angle }
    }));

    for (const msg of this.chatHistory) {
      ws.send(JSON.stringify({ type: 'chat', ...msg }));
    }
    
    if (this.clients.size === 1) {
      this.startSimulation();
    }
  }

  leave(ws) {
    this.clients.delete(ws);
    delete this.inputs[ws.playerId];
    this.emit('leave', { playerName: ws.playerName });
    logEvent({ type: 'leave', roomId: this.id, playerName: ws.playerName });
    
    if (this.clients.size === 0) {
      this.stopSimulation();
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

  startSimulation() {
    if (this.tickInterval) return;
    console.log(`Starting simulation for room ${this.id}`);
    
    let lastTime = performance.now();
    let accumulator = 0;
    const step = 1 / TICK_RATE;

    this.tickInterval = setInterval(() => {
      const now = performance.now();
      const frameTime = (now - lastTime) / 1000;
      lastTime = now;
      accumulator += frameTime;

      while (accumulator >= step) {
        // === АДАПТЕР ДЛЯ ІНПУТІВ ===
        const inputAdapter = {
          isDown: (code) => {
            const firstPlayerInput = Object.values(this.inputs)[0] || {};
            if (code === 'KeyW' || code === 'ArrowUp') return !!firstPlayerInput.up;
            if (code === 'KeyA' || code === 'ArrowLeft') return !!firstPlayerInput.left;
            if (code === 'KeyD' || code === 'ArrowRight') return !!firstPlayerInput.right;
            return false;
          }
        };
        // ===========================
        
        stepSimulation(this.world, step, inputAdapter, ARENA_WIDTH, ARENA_HEIGHT);
        accumulator -= step;
      }

      // Відправляємо знімок
      const snapshot = {
        type: 'snapshot',
        ship: { x: this.ship.pos.x, y: this.ship.pos.y, angle: this.ship.angle }
      };
      this.broadcast(snapshot);
    }, 1000 / TICK_RATE);
  }

  stopSimulation() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
      console.log(`Stopped simulation for room ${this.id}`);
    }
  }
}

const rooms = new Map();
for (const id of ['alpha', 'beta', 'gamma']) {
  rooms.set(id, new Room(id));
}

function getOrCreateRoom(id) {
  if (!rooms.has(id)) {
    rooms.set(id, new Room(id));
  }
  return rooms.get(id);
}

// === HTTP-сервер ===
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.includes('..')) {
    res.writeHead(403); res.end('Forbidden'); return;
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

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  res.writeHead(404); res.end('Not Found');
});

// === WebSocket-сервер ===
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const joinTimeout = setTimeout(() => {
    if (!ws.roomId) ws.close(4000, 'Join timeout');
  }, 5000);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { ws.close(4001, 'Invalid JSON'); return; }

    if (msg.type === 'join') {
      clearTimeout(joinTimeout);
      const room = getOrCreateRoom(msg.roomId);
      if (room.clients.size >= 8) { ws.close(4003, 'Room full'); return; }
      room.join(ws, msg.playerName || 'Anonymous');
      ws.send(JSON.stringify({ type: 'joined', roomId: msg.roomId, players: room.clients.size }));
      room.broadcast({ type: 'chat', playerName: 'System', text: `${msg.playerName} joined` }, ws);
    } 
    else if (msg.type === 'chat') {
      if (!ws.roomId) return;
      const room = rooms.get(ws.roomId);
      if (!room) return;
      const chatMsg = { playerName: ws.playerName, text: msg.text };
      room.chatHistory.push(chatMsg);
      if (room.chatHistory.length > 50) room.chatHistory.shift();
      logEvent({ type: 'chat', roomId: ws.roomId, playerName: ws.playerName, text: msg.text });
      room.broadcast({ type: 'chat', ...chatMsg });
    } 
    else if (msg.type === 'input') {
      if (!ws.roomId) return;
      const room = rooms.get(ws.roomId);
      if (!room) return;
      room.inputs[ws.playerId] = msg;
    } 
    else {
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

  ws.on('error', (err) => console.error('WebSocket error:', err));
});

// === Heartbeat ===
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);

wss.on('close', () => clearInterval(heartbeatInterval));

// === Запуск ===
startMatchLog('global');
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  stopMatchLog();
  wss.clients.forEach(ws => ws.close(1001, 'Server shutting down'));
  server.close(() => { console.log('Server closed'); process.exit(0); });
});