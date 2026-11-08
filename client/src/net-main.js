import { FIXED_DT, createBullet, decodeSnapshot, encodeInput, integrateShip } from '@dogfight/shared/network';
import { PRNG } from '@dogfight/shared/rng';
import { createInput } from './input.js';
import { loadAll, fetchJson } from './load.js';
import { Lobby } from './lobby.js';
import { Netgraph } from './netgraph.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');
const loadingScreen = document.getElementById('loading-screen');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const netgraph = new Netgraph();
const input = createInput(window);
const game = {
  ws: null,
  playerId: 0,
  roomName: '',
  playerName: '',
  codec: 'binary',
  width: 1280,
  height: 720,
  tick: 0,
  seed: 0,
  seq: 0,
  ship: null,
  pending: [],
  predictedBullets: [],
  snapshots: [],
  lastSnapshotAt: 0,
  lastPingAt: 0,
  correctionX: 0,
  correctionY: 0,
  correctionAngle: 0,
  assets: null,
  asteroidShapes: new Map(),
  predictionEnabled: true,
  lastFrame: performance.now(),
  accumulator: 0,
};

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

async function start() {
  try {
    const manifest = await fetchJson('/assets/manifest.json');
    game.assets = await loadAll(manifest, (loaded, total) => {
      progressFill.style.width = `${(loaded / total) * 100}%`;
      progressText.textContent = `${loaded} / ${total}`;
    });
  } catch (error) {
    console.error('Asset loading failed:', error);
    loadingScreen.innerHTML = '<h1>Unable to load game assets</h1><button onclick="location.reload()">Retry</button>';
    return;
  }

  loadingScreen.classList.add('hidden');
  const lobby = new Lobby();
  lobby.addEventListener('join', ({ detail }) => startGame(detail));
  await lobby.load();
}

function startGame({ room, playerName, ws, session }) {
  game.ws = ws;
  game.playerId = session.playerId;
  game.roomName = room.name;
  game.playerName = playerName;
  game.codec = session.codec;
  game.seed = session.seed;
  game.asteroidShapes.clear();
  game.predictionEnabled = new URLSearchParams(location.search).get('prediction') !== 'off';
  netgraph.predictionMode = game.predictionEnabled ? 'prediction' : 'snapshot-only';
  game.width = session.width;
  game.height = session.height;
  game.tick = 0;
  game.seq = 0;
  game.pending = [];
  game.predictedBullets = [];
  game.snapshots = [];
  game.lastFrame = performance.now();
  game.accumulator = 0;

  ws.addEventListener('message', onMessage);
  window.addEventListener('keydown', onHotkey);
  window.addEventListener('keydown', focusChat);
  setupChat();
  requestAnimationFrame(frame);
}

function onMessage(event) {
  netgraph.addBytes(typeof event.data === 'string' ? new TextEncoder().encode(event.data).byteLength : event.data.byteLength);
  if (typeof event.data !== 'string') {
    try {
      receiveSnapshot(decodeSnapshot(event.data));
    } catch (error) {
      console.warn('Invalid snapshot:', error);
    }
    return;
  }

  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    return;
  }
  if (message.type === 'snapshot') receiveSnapshot(message);
  if (message.type === 'pong') netgraph.rtt = performance.now() - message.sentAt;
  if (message.type === 'chat') appendChat(message.playerName, message.text);
}

function receiveSnapshot(snapshot) {
  const now = performance.now();
  game.lastSnapshotAt = now;
  game.snapshots.push({ receivedAt: now, tick: snapshot.tick, entities: snapshot.entities });
  if (game.snapshots.length > 20) game.snapshots.shift();
  game.tick = snapshot.tick;

  const serverShip = snapshot.entities.find((entity) => entity.kind === 'ship' && entity.ownerId === game.playerId);
  if (serverShip) {
    if (game.ship) {
      const oldVisualX = game.ship.x + game.correctionX;
      const oldVisualY = game.ship.y + game.correctionY;
      const oldVisualAngle = game.ship.angle + game.correctionAngle;
      netgraph.errorMagnitude = Math.hypot(
        shortestDelta(game.ship.x, serverShip.x, game.width),
        shortestDelta(game.ship.y, serverShip.y, game.height),
      );
      game.pending = game.pending.filter((queued) => queued.seq > snapshot.ack);
      game.ship = { ...serverShip };
      if (game.predictionEnabled) {
        for (const queued of game.pending) predict(queued, false);
      }
      game.correctionX = shortestDelta(game.ship.x, oldVisualX, game.width);
      game.correctionY = shortestDelta(game.ship.y, oldVisualY, game.height);
      game.correctionAngle = shortestAngle(game.ship.angle, oldVisualAngle);
    } else {
      game.ship = { ...serverShip };
    }
    game.predictedBullets = game.predictedBullets.filter((bullet) => bullet.inputSeq > snapshot.ack);
  }
  netgraph.pendingQueueLength = game.pending.length;
}

function getInput() {
  const left = input.isDown('ArrowLeft') || input.isDown('KeyA');
  const right = input.isDown('ArrowRight') || input.isDown('KeyD');
  return {
    seq: ++game.seq,
    tick: game.tick + 1,
    thrust: input.isDown('ArrowUp') || input.isDown('KeyW'),
    turn: left === right ? 0 : (left ? -1 : 1),
    fire: input.isDown('Space'),
  };
}

function predict(command, createLocalBullet = true) {
  if (!game.ship) return;
  game.ship = integrateShip(game.ship, command, FIXED_DT, game.width, game.height);
  if (command.fire && game.ship.cooldown <= 0) {
    game.ship.cooldown = game.ship.rapidFire > 0 ? 0.05 : 0.2;
    if (createLocalBullet) {
      const bullet = createBullet(game.ship, -command.seq, command.seq);
      bullet.local = true;
      game.predictedBullets.push(bullet);
    }
  }
}

function simulateStep() {
  if (!game.ship) return;
  const command = getInput();
  game.pending.push(command);
  if (game.ws.readyState === WebSocket.OPEN) {
    const packet = game.codec === 'json'
      ? JSON.stringify({ type: 'input', ...command })
      : encodeInput(command);
    game.ws.send(packet);
    netgraph.addBytes(typeof packet === 'string' ? new TextEncoder().encode(packet).byteLength : packet.byteLength);
  }
  if (game.predictionEnabled) predict(command);

  for (const bullet of game.predictedBullets) {
    bullet.x += bullet.vx * FIXED_DT;
    bullet.y += bullet.vy * FIXED_DT;
    bullet.ttl -= FIXED_DT;
  }
  game.predictedBullets = game.predictedBullets.filter((bullet) => bullet.ttl > 0);
  game.correctionX *= Math.exp(-FIXED_DT / 0.1);
  game.correctionY *= Math.exp(-FIXED_DT / 0.1);
  game.correctionAngle *= Math.exp(-FIXED_DT / 0.1);
  input.endFrame();

  const now = performance.now();
  if (now - game.lastPingAt >= 1000 && game.ws.readyState === WebSocket.OPEN) {
    game.lastPingAt = now;
    game.ws.send(JSON.stringify({ type: 'ping', sentAt: now }));
  }
}

function frame(now) {
  const elapsed = Math.min((now - game.lastFrame) / 1000, 0.25);
  game.lastFrame = now;
  game.accumulator += elapsed;
  while (game.accumulator >= FIXED_DT) {
    simulateStep();
    game.accumulator -= FIXED_DT;
  }
  render(now);
  requestAnimationFrame(frame);
}

function render(now) {
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.min(canvas.width / dpr / game.width, canvas.height / dpr / game.height);
  const offsetX = (canvas.width / dpr - game.width * scale) / 2;
  const offsetY = (canvas.height / dpr - game.height * scale) / 2;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#090d12';
  ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#111820';
  ctx.fillRect(0, 0, game.width, game.height);
  drawGrid();

  const remote = interpolatedEntities(now - netgraph.interpolationDelay);
  for (const entity of remote) {
    if (entity.kind === 'ship' && entity.ownerId !== game.playerId && entity.alive) drawShip(entity, '#45d6a8');
    if (entity.kind === 'bullet' && entity.ownerId !== game.playerId) drawBullet(entity, '#ffd166');
    if (entity.kind === 'asteroid') drawAsteroid(entity);
    if (entity.kind === 'pickup') drawPickup(entity, now);
  }
  const latestEntities = game.snapshots.at(-1)?.entities || [];
  for (const bullet of latestEntities) {
    if (bullet.kind === 'bullet' && bullet.ownerId === game.playerId) drawBullet(bullet, '#fff06a');
  }
  for (const bullet of game.predictedBullets) {
    const confirmed = remote.some((entity) => entity.kind === 'bullet' && entity.ownerId === game.playerId && entity.inputSeq === bullet.inputSeq);
    if (!confirmed) drawBullet(bullet, '#fff06a');
  }
  if (game.ship?.alive) {
    drawShip({
      ...game.ship,
      x: (game.ship.x + game.correctionX + game.width) % game.width,
      y: (game.ship.y + game.correctionY + game.height) % game.height,
      angle: game.ship.angle + game.correctionAngle,
    }, '#4af');
  }
  ctx.restore();

  netgraph.snapshotAge = game.lastSnapshotAt ? now - game.lastSnapshotAt + netgraph.rtt / 2 : 0;
  netgraph.pendingQueueLength = game.pending.length;
  netgraph.render(ctx, Math.max(10, window.innerWidth - 250), 10);
  const speed = game.ship ? Math.hypot(game.ship.vx, game.ship.vy) : 0;
  const asteroidCount = remote.filter((entity) => entity.kind === 'asteroid').length;
  hud.textContent = `Room: ${game.roomName}\nPlayer: ${game.playerName}\nTick: ${game.tick}\nSpeed: ${speed.toFixed(0)} px/s\nHP: ${game.ship?.hp ?? '--'}\nScore: ${game.ship?.score ?? 0}\nAsteroids: ${asteroidCount}\nEntities: ${remote.length}`;
}

function interpolatedEntities(targetTime) {
  const buffer = game.snapshots;
  if (!buffer.length) return [];
  let before = buffer[0];
  let after = buffer[buffer.length - 1];
  for (let index = 1; index < buffer.length; index += 1) {
    if (buffer[index].receivedAt >= targetTime) {
      before = buffer[index - 1];
      after = buffer[index];
      break;
    }
    before = buffer[index];
  }
  const span = after.receivedAt - before.receivedAt;
  const alpha = span > 0 ? Math.max(0, Math.min(1, (targetTime - before.receivedAt) / span)) : 1;
  const nextById = new Map(after.entities.map((entity) => [entity.id, entity]));
  return before.entities.flatMap((entity) => {
    const next = nextById.get(entity.id);
    if (!next) return targetTime > before.receivedAt ? [] : [entity];
    return [{
      ...entity,
      x: wrapLerp(entity.x, next.x, alpha, game.width),
      y: wrapLerp(entity.y, next.y, alpha, game.height),
      angle: entity.angle + shortestAngle(entity.angle, next.angle) * alpha,
    }];
  });
}

function wrapLerp(a, b, alpha, limit) {
  let delta = b - a;
  if (Math.abs(delta) > limit / 2) delta -= Math.sign(delta) * limit;
  return (a + delta * alpha + limit) % limit;
}

function shortestDelta(from, to, limit) {
  let delta = to - from;
  if (Math.abs(delta) > limit / 2) delta -= Math.sign(delta) * limit;
  return delta;
}

function shortestAngle(from, to) {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function drawGrid() {
  ctx.strokeStyle = '#202a32';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= game.width; x += 50) { ctx.moveTo(x, 0); ctx.lineTo(x, game.height); }
  for (let y = 0; y <= game.height; y += 50) { ctx.moveTo(0, y); ctx.lineTo(game.width, y); }
  ctx.stroke();
}

function drawShip(ship, color) {
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);
  const sprite = game.assets?.images?.ship;
  if (sprite) {
    ctx.filter = color === '#4af' ? 'none' : 'hue-rotate(95deg) saturate(1.7)';
    ctx.drawImage(sprite, -18, -18, 36, 36);
    ctx.filter = 'none';
  } else {
    ctx.beginPath();
    ctx.moveTo(18, 0); ctx.lineTo(-12, -10); ctx.lineTo(-8, 0); ctx.lineTo(-12, 10); ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
  if (ship.thrust) {
    ctx.beginPath();
    ctx.moveTo(-9, -5); ctx.lineTo(-22, 0); ctx.lineTo(-9, 5); ctx.closePath();
    ctx.fillStyle = '#f4a261';
    ctx.fill();
  }
  ctx.restore();
}

function drawBullet(bullet, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(bullet.x, bullet.y, bullet.radius || 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawAsteroid(asteroid) {
  let shape = game.asteroidShapes.get(asteroid.id);
  if (!shape) {
    const rng = new PRNG((game.seed ^ asteroid.id) >>> 0);
    shape = Array.from({ length: 7 }, () => 0.8 + rng.random() * 0.4);
    game.asteroidShapes.set(asteroid.id, shape);
  }
  ctx.save();
  ctx.translate(asteroid.x, asteroid.y);
  ctx.rotate(asteroid.angle);
  ctx.beginPath();
  for (let point = 0; point < 7; point += 1) {
    const angle = point / 7 * Math.PI * 2;
    const radius = asteroid.radius * shape[point];
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (point === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = '#666';
  ctx.fill();
  ctx.strokeStyle = '#aaa';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawPickup(pickup, now) {
  ctx.save();
  ctx.translate(pickup.x, pickup.y);
  const scale = 1 + Math.sin(now / 1000 * 4) * 0.1;
  ctx.scale(scale, scale);
  const color = pickup.type === 'shield' ? '#4f4' : '#ff4';
  ctx.beginPath();
  ctx.arc(0, 0, pickup.radius, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  if (pickup.type === 'shield') {
    ctx.arc(0, 0, pickup.radius * 0.5, 0, Math.PI * 2);
  } else {
    ctx.moveTo(-4, -4); ctx.lineTo(4, 0); ctx.lineTo(-4, 4);
  }
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function setupChat() {
  const box = document.getElementById('chat-box');
  const chatInput = document.getElementById('chat-input');
  box.classList.remove('hidden');
  chatInput.addEventListener('keydown', (event) => {
    if (event.code !== 'Enter') return;
    const text = chatInput.value.trim();
    if (text && game.ws.readyState === WebSocket.OPEN) game.ws.send(JSON.stringify({ type: 'chat', text }));
    chatInput.value = '';
    chatInput.blur();
  });
}

function appendChat(playerName, text) {
  const messages = document.getElementById('chat-messages');
  const line = document.createElement('div');
  const name = document.createElement('span');
  name.style.color = '#4af';
  name.textContent = `${playerName}: `;
  line.append(name, document.createTextNode(text));
  messages.appendChild(line);
  messages.scrollTop = messages.scrollHeight;
}

function focusChat(event) {
  const chatInput = document.getElementById('chat-input');
  if (event.code === 'Enter' && document.activeElement !== chatInput) {
    chatInput.focus();
    event.preventDefault();
  }
}

function onHotkey(event) {
  if (document.activeElement?.id === 'chat-input') return;
  if (event.code === 'BracketLeft') netgraph.interpolationDelay = Math.max(33, netgraph.interpolationDelay - 33);
  if (event.code === 'BracketRight') netgraph.interpolationDelay = Math.min(250, netgraph.interpolationDelay + 33);
  if (event.code === 'KeyP') {
    game.predictionEnabled = !game.predictionEnabled;
    netgraph.predictionMode = game.predictionEnabled ? 'prediction' : 'snapshot-only';
  }
  if (event.code === 'Space') event.preventDefault();
}

start();