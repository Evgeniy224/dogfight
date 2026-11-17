import { createLoop } from './loop.js';
import { createInput } from './input.js';
import { Ship } from './sim/ship.js';
import { World } from './sim/world.js';
import { Asteroid } from './sim/asteroid.js';
import { Explosion } from './sim/explosion.js';
import { Pickup } from './sim/pickup.js';
import { createHoming } from './sim/behaviors.js';
import { loadAll, fetchJson, parseAssetManifest } from './load.js';

// === ЗВУК ===
import { setAudioContext, setBuffer, unlockAudio } from './audio.js';
// === ЛОБІ ===
import { Lobby } from './lobby.js';
import type { LobbyRoom } from './lobby.js';
import {
  requireCanvas,
  requireCanvasContext,
  requireElement,
  requireInput,
} from './types.js';
import type {
  AssetManifest,
  DrawableShip,
  GameLoop,
  InputState,
  LoadedAssets,
  PreviousShipState,
} from './types.js';

// --- Canvas ---
const canvas = requireCanvas('game');
const ctx = requireCanvasContext(canvas);
let viewWidth = window.innerWidth;
let viewHeight = window.innerHeight;

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  viewWidth = window.innerWidth;
  viewHeight = window.innerHeight;
  canvas.width = viewWidth * dpr;
  canvas.height = viewHeight * dpr;
  canvas.style.width = `${viewWidth}px`;
  canvas.style.height = `${viewHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- HUD ---
const hudElement = requireElement('hud');

// --- Loading UI ---
const loadingScreen = requireElement('loading-screen');
const progressFill = requireElement('progress-fill');
const progressText = requireElement('progress-text');

// --- Глобальні ресурси ---
let assets: LoadedAssets | null = null;

// --- Стан гри ---
let world: World | null = null;
let ship: Ship | null = null;
let input: InputState | null = null;
let score = 0;
let respawnTimer = 0;
let prevShip: PreviousShipState | null = null;
let loop: GameLoop | null = null;
let shotCounter = 0;

// --- Старт ---
async function start() {
  let manifest: AssetManifest;
  try {
    manifest = parseAssetManifest(await fetchJson('/assets/manifest.json'));
  } catch (error: unknown) {
    console.error('Failed to load manifest:', error);
    loadingScreen.innerHTML = '<h1 style="color:red;">Failed to load manifest</h1><button onclick="location.reload()">Retry</button>';
    return;
  }

  try {
    assets = await loadAll(manifest, (loaded, total) => {
      const percent = (loaded / total) * 100;
      progressFill.style.width = `${percent}%`;
      progressText.textContent = `${loaded} / ${total}`;
    });
  } catch (error: unknown) {
    console.error('Failed to load assets:', error);
    loadingScreen.innerHTML = '<h1 style="color:red;">Failed to load assets</h1><button onclick="location.reload()">Retry</button>';
    return;
  }

  // === ДЕКОДУВАННЯ ЗВУКІВ ===
  try {
    const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext;
    if (AudioContextConstructor) {
      const audioCtx = new AudioContextConstructor();
      setAudioContext(audioCtx);
      for (const [name, arrayBuffer] of Object.entries(assets.sounds)) {
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        setBuffer(name, audioBuffer);
      }
      console.log('Audio decoded:', Object.keys(assets.sounds));
    }
  } catch (error: unknown) {
    console.warn('Audio decode failed:', error);
  }

  // === РОЗБЛОКУВАННЯ АУДІО ПРИ ПЕРШОМУ ЖЕСТІ ===
  window.addEventListener('keydown', unlockAudio, { once: true });
  window.addEventListener('click', unlockAudio, { once: true });

  loadingScreen.classList.add('hidden');

  // === ЛОБІ ===
  const lobby = new Lobby();
  lobby.onJoin(({ room, playerName, ws }) => {
    console.log('Joining room:', room.name, 'as', playerName);
    window.ws = ws;
    initGame(room);
  });
  await lobby.load();
}

function initGame(room: LobbyRoom): void {
  const roomName = room?.name || 'Unknown';

  input = createInput(window);

  let newWorld: World;
  newWorld = new World({
    onExplosion: (x, y, r) => {
      newWorld.spawn(new Explosion(x, y, r));
    },
    onScore: (points) => {
      score += points;
    },
  });
  world = newWorld;

  ship = newWorld.spawn(new Ship(viewWidth / 2, viewHeight / 2));
  respawnTimer = 0;
  shotCounter = 0;

  for (let i = 0; i < 12; i++) spawnAsteroid();

  newWorld.spawn(new Pickup(viewWidth * 0.3, viewHeight * 0.3, 'shield'));
  newWorld.spawn(new Pickup(viewWidth * 0.7, viewHeight * 0.7, 'rapid_fire'));

  prevShip = {
    x: ship.pos.x,
    y: ship.pos.y,
    angle: ship.angle,
    thrust: ship.thrust,
  };

  window.addEventListener('keydown', (e) => {
    const currentShip = ship;
    const currentWorld = world;
    if (e.code === 'Space' && currentShip?.alive && currentWorld) {
      const bullet = currentShip.fire();
      if (bullet) {
        shotCounter++;
        if (shotCounter % 5 === 0) {
          bullet.homing = createHoming(4.0);
          let nearest = null;
          let nearestDist = Infinity;
          for (const ast of currentWorld.ofKind('asteroid')) {
            if (!(ast instanceof Asteroid)) continue;
            const d = Math.hypot(ast.pos.x - currentShip.pos.x, ast.pos.y - currentShip.pos.y);
            if (d < nearestDist) {
              nearestDist = d;
              nearest = ast;
            }
          }
          bullet.homingTarget = nearest;
        }
        currentWorld.spawn(bullet);
      }
    }
  });

  const gameLoop = createLoop({
    step: 1 / 60,
    simulate,
    render,
  });
  loop = gameLoop;
  gameLoop.start();

  window.loop = gameLoop;
  window.world = newWorld;
  window.roomName = roomName;

  // === ЧАТ ===
  const chatBox = requireElement('chat-box');
  const chatMessages = requireElement('chat-messages');
  const chatInput = requireInput('chat-input');
  
  chatBox.classList.remove('hidden');

  // Фокус на чат по Enter
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && document.activeElement !== chatInput) {
      chatInput.focus();
      e.preventDefault();
    }
  });

  // Відправка повідомлення
  chatInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code === 'Enter') {
      const text = chatInput.value.trim();
      if (text && window.ws && window.ws.readyState === 1) {
        window.ws.send(JSON.stringify({ type: 'chat', text }));
        chatInput.value = '';
      }
      chatInput.blur();
    }
  });

  // Отримання повідомлень
  if (window.ws) {
    window.ws.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      let msg: unknown;
      try {
        msg = JSON.parse(event.data);
      } catch (_error: unknown) {
        return;
      }
      if (isChatMessage(msg)) {
        const div = document.createElement('div');
        // Робимо ім'я кольоровим
        div.innerHTML = `<span style="color:#4af;">${msg.playerName}</span>: ${msg.text}`;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    });
  }
}

function spawnAsteroid(): void {
  const currentWorld = world;
  const currentShip = ship;
  if (!currentWorld || !currentShip) return;
  let x, y;
  do {
    x = Math.random() * viewWidth;
    y = Math.random() * viewHeight;
  } while (Math.hypot(x - currentShip.pos.x, y - currentShip.pos.y) < 200);

  const vx = (Math.random() - 0.5) * 100;
  const vy = (Math.random() - 0.5) * 100;
  currentWorld.spawn(new Asteroid(x, y, vx, vy, Math.floor(Math.random() * 3)));
}

function simulate(dt: number): void {
  const currentWorld = world;
  const currentShip = ship;
  const currentInput = input;
  const previousShip = prevShip;
  if (!currentWorld || !currentShip || !currentInput || !previousShip) return;
  if (currentShip.alive) {
    previousShip.x = currentShip.pos.x;
    previousShip.y = currentShip.pos.y;
    previousShip.angle = currentShip.angle;
    previousShip.thrust = currentShip.thrust;
  }

  currentWorld.step(dt, currentInput, viewWidth, viewHeight);

  if (currentShip.alive) {
    if (currentShip.pos.x < 0) currentShip.pos.x += viewWidth;
    if (currentShip.pos.x > viewWidth) currentShip.pos.x -= viewWidth;
    if (currentShip.pos.y < 0) currentShip.pos.y += viewHeight;
    if (currentShip.pos.y > viewHeight) currentShip.pos.y -= viewHeight;
  } else {
    respawnTimer += dt;
    if (respawnTimer >= 2) {
      respawnTimer = 0;
      const newShip = currentWorld.spawn(new Ship(viewWidth / 2, viewHeight / 2));
      ship = newShip;
      previousShip.x = newShip.pos.x;
      previousShip.y = newShip.pos.y;
      previousShip.angle = newShip.angle;
      previousShip.thrust = newShip.thrust;
    }
  }

  currentInput.endFrame();
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function render(alpha: number): void {
  const currentWorld = world;
  const currentShip = ship;
  const previousShip = prevShip;
  const currentLoop = loop;
  if (!currentWorld || !currentShip || !previousShip || !currentLoop) return;
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, viewWidth, viewHeight);
  drawGrid();

  for (const e of currentWorld) {
    if (e.kind === 'ship') continue;
    e.draw(ctx);
  }

  if (currentShip.alive) {
    const interpShip = {
      x: lerp(previousShip.x, currentShip.pos.x, alpha),
      y: lerp(previousShip.y, currentShip.pos.y, alpha),
      angle: lerpAngle(previousShip.angle, currentShip.angle, alpha),
      thrust: currentShip.thrust,
    };
    drawShip(interpShip);
  }

  const stats = currentLoop.getStats();
  const speed = currentShip.vel.length();
  hudElement.innerHTML = `
    steps/s: ${stats.stepsPerSecond}<br>
    frames/s: ${stats.framesPerSecond}<br>
    frame time: ${stats.frameTime.toFixed(2)} ms<br>
    <br>
    x: ${currentShip.pos.x.toFixed(0)}, y: ${currentShip.pos.y.toFixed(0)}<br>
    speed: ${speed.toFixed(0)} px/s<br>
    hp: ${currentShip.hp}<br>
    entities: ${currentWorld.size}<br>
    <br>
    <span style="color: yellow; font-size: 18px;">SCORE: ${score}</span><br>
    <span style="color: #888;">Room: ${window.roomName || 'Unknown'}</span>
    ${!currentShip.alive ? `<br><span style="color: red;">RESPAWN IN ${(2 - respawnTimer).toFixed(1)}s</span>` : ''}
  `;
}

function drawGrid() {
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1;
  const step = 50;
  ctx.beginPath();
  for (let x = 0; x < viewWidth; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, viewHeight); }
  for (let y = 0; y < viewHeight; y += step) { ctx.moveTo(0, y); ctx.lineTo(viewWidth, y); }
  ctx.stroke();
}

function drawShip(s: DrawableShip): void {
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.angle);

  if (assets?.images?.ship) {
    ctx.drawImage(assets.images.ship, -15, -15, 30, 30);
  } else {
    ctx.beginPath();
    ctx.moveTo(15, 0); ctx.lineTo(-10, -8); ctx.lineTo(-10, 8); ctx.closePath();
    ctx.fillStyle = '#4af'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }

  if (s.thrust) {
    ctx.beginPath();
    ctx.moveTo(-10, -6);
    ctx.lineTo(-20 - Math.random() * 8, 0);
    ctx.lineTo(-10, 6);
    ctx.closePath();
    ctx.fillStyle = 'orange';
    ctx.fill();
  }

  ctx.restore();
}

// --- Запуск ---
start();

function isChatMessage(value: unknown): value is { type: 'chat'; playerName: string; text: string } {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && value.type === 'chat'
    && 'playerName' in value
    && typeof value.playerName === 'string'
    && 'text' in value
    && typeof value.text === 'string';
}