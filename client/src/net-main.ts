import {
  FIXED_DT,
  ServerMessageSchema,
  decodeSnapshot,
  encodeInput,
  sequence,
  tick,
} from '@dogfight/shared/network';
import { PRNG } from '@dogfight/shared/rng';
import { createInput } from './input.js';
import { loadAll, fetchJson, parseAssetManifest } from './load.js';
import { Lobby } from './lobby.js';
import { Netgraph } from './netgraph.js';
import { requireCanvas, requireCanvasContext, requireElement, requireInput } from './types.js';
import type { InputCommand, PickupType } from '@dogfight/shared/network';
import type { LoadedAssets } from './types.js';
import type { JoinedSession, LobbyRoom } from './lobby.js';

interface ClientEntity {
  readonly id: number;
  readonly ownerId: number;
  readonly inputSeq: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly angle: number;
  readonly hp: number;
  readonly radius: number;
  readonly cooldown: number;
  readonly shield: number;
  readonly rapidFire: number;
  readonly score: number;
  readonly alive: boolean;
  readonly thrust: boolean;
  readonly kind: 'ship' | 'bullet' | 'asteroid' | 'pickup';
  readonly type?: PickupType;
  readonly ttl?: number;
  readonly local?: boolean;
}

type MutableClientEntity = { -readonly [Key in keyof ClientEntity]: ClientEntity[Key] };

interface ClientSnapshot {
  tick: number;
  ack: number;
  entities: readonly ClientEntity[];
}

interface SnapshotHistoryEntry {
  receivedAt: number;
  tick: number;
  entities: readonly ClientEntity[];
}

interface PredictedBullet {
  id: number;
  kind: 'bullet';
  ownerId: number;
  inputSeq: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  radius: number;
  ttl: number;
  local: true;
}

interface GameState {
  ws: WebSocket | null;
  playerId: number;
  roomName: string;
  playerName: string;
  codec: 'binary' | 'json';
  width: number;
  height: number;
  tick: number;
  seed: number;
  seq: number;
  ship: MutableClientEntity | null;
  pending: InputCommand[];
  predictedBullets: PredictedBullet[];
  snapshots: SnapshotHistoryEntry[];
  lastSnapshotAt: number;
  lastPingAt: number;
  correctionX: number;
  correctionY: number;
  correctionAngle: number;
  assets: LoadedAssets | null;
  asteroidShapes: Map<number, number[]>;
  predictionEnabled: boolean;
  lastFrame: number;
  accumulator: number;
}

const canvas = requireCanvas('game');
const ctx = requireCanvasContext(canvas);
const hud = requireElement('hud');
const loadingScreen = requireElement('loading-screen');
const progressFill = requireElement('progress-fill');
const progressText = requireElement('progress-text');
const netgraph = new Netgraph();
const input = createInput(window);
const game: GameState = {
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
    const manifest = parseAssetManifest(await fetchJson('/assets/manifest.json'));
    game.assets = await loadAll(manifest, (loaded, total) => {
      progressFill.style.width = `${(loaded / total) * 100}%`;
      progressText.textContent = `${loaded} / ${total}`;
    });
  } catch (error: unknown) {
    console.error('Asset loading failed:', error);
    loadingScreen.innerHTML = '<h1>Unable to load game assets</h1><button onclick="location.reload()">Retry</button>';
    return;
  }

  loadingScreen.classList.add('hidden');
  const lobby = new Lobby();
  lobby.onJoin((detail) => startGame(detail));
  await lobby.load();
}

function startGame({ room, playerName, ws, session }: {
  room: LobbyRoom;
  playerName: string;
  ws: WebSocket;
  session: JoinedSession;
}): void {
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

function onMessage(event: MessageEvent): void {
  if (typeof event.data !== 'string') {
    if (!(event.data instanceof ArrayBuffer)) return;
    netgraph.addBytes(event.data.byteLength);
    try {
      receiveSnapshot(decodeSnapshot(event.data));
    } catch (error: unknown) {
      console.warn('Invalid snapshot:', error);
    }
    return;
  }

  netgraph.addBytes(new TextEncoder().encode(event.data).byteLength);
  let untrusted: unknown;
  try {
    untrusted = JSON.parse(event.data);
  } catch (error: unknown) {
    console.warn('Invalid server JSON:', error);
    return;
  }
  const parsed = ServerMessageSchema.safeParse(untrusted);
  if (!parsed.success) {
    console.warn('Invalid server message:', parsed.error);
    return;
  }
  const message = parsed.data;
  switch (message.type) {
    case 'snapshot':
      receiveSnapshot(message);
      return;
    case 'pong':
      netgraph.rtt = performance.now() - message.sentAt;
      return;
    case 'chat':
      appendChat(message.playerName, message.text);
      return;
    case 'joined':
      return;
    default: {
      const exhaustiveCheck: never = message;
      return exhaustiveCheck;
    }
  }
}

function receiveSnapshot(snapshot: ClientSnapshot): void {
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

function getInput(): InputCommand {
  const left = input.isDown('ArrowLeft') || input.isDown('KeyA');
  const right = input.isDown('ArrowRight') || input.isDown('KeyD');
  return {
    seq: sequence(++game.seq),
    tick: tick(game.tick + 1),
    thrust: input.isDown('ArrowUp') || input.isDown('KeyW'),
    turn: left === right ? 0 : (left ? -1 : 1),
    fire: input.isDown('Space'),
  };
}

function predict(command: InputCommand, createLocalBullet = true): void {
  if (!game.ship) return;
  const ship = { ...game.ship };
  ship.angle += command.turn * 4 * FIXED_DT;
  ship.angle = ((ship.angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  ship.thrust = command.thrust;
  if (ship.thrust) {
    ship.vx += Math.cos(ship.angle) * 400 * FIXED_DT;
    ship.vy += Math.sin(ship.angle) * 400 * FIXED_DT;
  }
  const drag = Math.exp(-1.5 * FIXED_DT);
  ship.vx *= drag;
  ship.vy *= drag;
  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed > 500) {
    ship.vx *= 500 / speed;
    ship.vy *= 500 / speed;
  }
  ship.x = (ship.x + ship.vx * FIXED_DT + game.width) % game.width;
  ship.y = (ship.y + ship.vy * FIXED_DT + game.height) % game.height;
  ship.cooldown = Math.max(0, ship.cooldown - FIXED_DT);
  ship.shield = Math.max(0, ship.shield - FIXED_DT);
  ship.rapidFire = Math.max(0, ship.rapidFire - FIXED_DT);
  game.ship = ship;
  if (command.fire && game.ship.cooldown <= 0) {
    game.ship.cooldown = game.ship.rapidFire > 0 ? 0.05 : 0.2;
    if (createLocalBullet) {
      const bullet: PredictedBullet = {
        id: -command.seq,
        kind: 'bullet',
        ownerId: game.ship.ownerId,
        inputSeq: command.seq,
        x: game.ship.x + Math.cos(game.ship.angle) * game.ship.radius,
        y: game.ship.y + Math.sin(game.ship.angle) * game.ship.radius,
        vx: game.ship.vx + Math.cos(game.ship.angle) * 600,
        vy: game.ship.vy + Math.sin(game.ship.angle) * 600,
        angle: game.ship.angle,
        radius: 3,
        ttl: 2,
        local: true,
      };
      game.predictedBullets.push(bullet);
    }
  }
}

function simulateStep(): void {
  const ws = game.ws;
  if (!ws) return;
  if (!game.ship) return;
  const command = getInput();
  game.pending.push(command);
  if (ws.readyState === WebSocket.OPEN) {
    const packet = game.codec === 'json'
      ? JSON.stringify({ type: 'input', ...command })
      : encodeInput(command);
    ws.send(packet);
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
  if (now - game.lastPingAt >= 1000 && ws.readyState === WebSocket.OPEN) {
    game.lastPingAt = now;
    ws.send(JSON.stringify({ type: 'ping', sentAt: now }));
  }
}

function frame(now: number): void {
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

function render(now: number): void {
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

function interpolatedEntities(targetTime: number): ClientEntity[] {
  const buffer = game.snapshots;
  if (!buffer.length) return [];
  const first = buffer[0];
  const last = buffer[buffer.length - 1];
  if (!first || !last) return [];
  let before = first;
  let after = last;
  for (let index = 1; index < buffer.length; index += 1) {
    const current = buffer[index];
    const previous = buffer[index - 1];
    if (!current || !previous) continue;
    if (current.receivedAt >= targetTime) {
      before = previous;
      after = current;
      break;
    }
    before = current;
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

function wrapLerp(a: number, b: number, alpha: number, limit: number): number {
  let delta = b - a;
  if (Math.abs(delta) > limit / 2) delta -= Math.sign(delta) * limit;
  return (a + delta * alpha + limit) % limit;
}

function shortestDelta(from: number, to: number, limit: number): number {
  let delta = to - from;
  if (Math.abs(delta) > limit / 2) delta -= Math.sign(delta) * limit;
  return delta;
}

function shortestAngle(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function drawGrid(): void {
  ctx.strokeStyle = '#202a32';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= game.width; x += 50) { ctx.moveTo(x, 0); ctx.lineTo(x, game.height); }
  for (let y = 0; y <= game.height; y += 50) { ctx.moveTo(0, y); ctx.lineTo(game.width, y); }
  ctx.stroke();
}

function drawShip(ship: ClientEntity, color: string): void {
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

function drawBullet(bullet: Pick<ClientEntity, 'x' | 'y' | 'radius'>, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(bullet.x, bullet.y, bullet.radius || 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawAsteroid(asteroid: ClientEntity): void {
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
    const shapeScale = shape[point];
    if (shapeScale === undefined) continue;
    const angle = point / 7 * Math.PI * 2;
    const radius = asteroid.radius * shapeScale;
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

function drawPickup(pickup: ClientEntity, now: number): void {
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

function setupChat(): void {
  const box = requireElement('chat-box');
  const chatInput = requireInput('chat-input');
  box.classList.remove('hidden');
  chatInput.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.code !== 'Enter') return;
    const text = chatInput.value.trim();
    const ws = game.ws;
    if (text && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'chat', text }));
    chatInput.value = '';
    chatInput.blur();
  });
}

function appendChat(playerName: string, text: string): void {
  const messages = requireElement('chat-messages');
  const line = document.createElement('div');
  const name = document.createElement('span');
  name.style.color = '#4af';
  name.textContent = `${playerName}: `;
  line.append(name, document.createTextNode(text));
  messages.appendChild(line);
  messages.scrollTop = messages.scrollHeight;
}

function focusChat(event: KeyboardEvent): void {
  const chatInput = requireInput('chat-input');
  if (event.code === 'Enter' && document.activeElement !== chatInput) {
    chatInput.focus();
    event.preventDefault();
  }
}

function onHotkey(event: KeyboardEvent): void {
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