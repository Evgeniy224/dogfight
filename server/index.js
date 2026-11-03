import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { EventEmitter } from 'node:events';
import { createWriteStream, mkdirSync } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

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
  }

  join(ws, playerName) {
    this.clients.add(ws);
    ws.roomId = this.id;
    ws.playerName = playerName;
    this.emit('join', { playerName });
    logEvent({ type: 'join', roomId: this.id, playerName });
    for (const msg of this.chatHistory) {
      ws.send(JSON.stringify({ type: 'chat', ...msg }));
    }
  }

  leave(ws) {
    this.clients.delete(ws);
    this.emit('leave', { playerName: ws.playerName });
    logEvent({ type: 'leave', roomId: this.id, playerName: ws.playerName });
  }

  broadcast(message, exclude = null) {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client !== exclude && client.readyState === 1) {
        client.send(data);
      }
    }
  }
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

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.close(4001, 'Invalid JSON');
      return;
    }

    if (msg.type === 'join') {
      clearTimeout(joinTimeout);
      const { roomId, playerName } = msg;
      const room = getOrCreateRoom(roomId);
      
      if (room.clients.size >= 8) {
        ws.close(4003, 'Room full');
        return;
      }
      room.join(ws, playerName || 'Anonymous');
      ws.send(JSON.stringify({ type: 'joined', roomId, players: room.clients.size }));
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