import { createLoop } from './loop.js';
import { createInput } from './input.js';
import { loadAll, fetchJson } from './load.js';
import { setAudioContext, setBuffer, unlockAudio } from './audio.js';
import { events } from './events.js';
import { Lobby } from './lobby.js';
import { detectCollisions, resolveCollisions } from './sim/collision.js';

// Імпорти з shared/
import { Ship } from '../../shared/ship.js';
import { World } from '../../shared/world.js';
import { Asteroid } from '../../shared/asteroid.js';

// Локальні імпорти
import { Explosion } from './sim/explosion.js';
import { Pickup } from './sim/pickup.js';
import { createHoming } from './sim/behaviors.js';

// --- Canvas ---
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
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
const hudElement = document.getElementById('hud');
const loadingScreen = document.getElementById('loading-screen');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');

// --- Стан ---
let assets = null;
let world, ship, input, score = 0, respawnTimer = 0;
let prevShip = null;
let loop = null;
let shotCounter = 0;

// === ДЛЯ ІНТЕРПОЛЯЦІЇ МЕРЕЖІ ===
let lastSnapshot = null;
let currSnapshot = null;
let snapshotTime = 0;

// --- Старт ---
async function start() {
  let manifest;
  try {
    manifest = await fetchJson('/assets/manifest.json');
  } catch (e) {
    loadingScreen.innerHTML = '<h1 style="color:red;">Failed to load manifest</h1><button onclick="location.reload()">Retry</button>';
    return;
  }

  try {
    assets = await loadAll(manifest, (loaded, total) => {
      progressFill.style.width = `${(loaded / total) * 100}%`;
      progressText.textContent = `${loaded} / ${total}`;
    });
  } catch (e) {
    loadingScreen.innerHTML = '<h1 style="color:red;">Failed to load assets</h1><button onclick="location.reload()">Retry</button>';
    return;
  }

  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    setAudioContext(audioCtx);
    for (const [name, arrayBuffer] of Object.entries(assets.sounds)) {
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      setBuffer(name, audioBuffer);
    }
  } catch (e) {
    console.warn('Audio decode failed:', e);
  }

  window.addEventListener('keydown', unlockAudio, { once: true });
  window.addEventListener('click', unlockAudio, { once: true });

  loadingScreen.classList.add('hidden');

  const lobby = new Lobby();
  lobby.addEventListener('join', (e) => {
    const { room, playerName, ws } = e.detail;
    window.ws = ws;
    initGame(room);
  });
  await lobby.load();
}

function initGame(room) {
  const roomName = room?.name || 'Unknown';
  input = createInput(window);

  world = new World();
  ship = world.spawn(new Ship(1920 / 2, 1080 / 2));
  respawnTimer = 0;
  shotCounter = 0;

  for (let i = 0; i < 12; i++) spawnAsteroid();
  world.spawn(new Pickup(1920 * 0.3, 1080 * 0.3, 'shield'));
  world.spawn(new Pickup(1920 * 0.7, 1080 * 0.7, 'rapid_fire'));

  prevShip = { x: ship.pos.x, y: ship.pos.y, angle: ship.angle, thrust: ship.thrust };

  // === ОНОВЛЕНО: ПОСТРІЛ З ВІЗУАЛЬНОЇ ПОЗИЦІЇ ===
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && ship.alive) {
      // Отримуємо поточну візуальну позицію корабля
      let visualX = ship.pos.x;
      let visualY = ship.pos.y;
      let visualAngle = ship.angle;

      if (lastSnapshot && currSnapshot) {
        const t = Math.min((performance.now() - snapshotTime) / (1000 / 30), 1);
        visualX = lerp(lastSnapshot.x, currSnapshot.x, t);
        visualY = lerp(lastSnapshot.y, currSnapshot.y, t);
        visualAngle = lerpAngle(lastSnapshot.angle, currSnapshot.angle, t);
      } else if (currSnapshot) {
        visualX = currSnapshot.x;
        visualY = currSnapshot.y;
        visualAngle = currSnapshot.angle;
      }

      // Тимчасово переміщуємо корабель у візуальну позицію, щоб куля створилася правильно
      const originalX = ship.pos.x;
      const originalY = ship.pos.y;
      const originalAngle = ship.angle;
      
      ship.pos.x = visualX;
      ship.pos.y = visualY;
      ship.angle = visualAngle;
      
      const bullet = ship.fire();
      
      // Повертаємо корабель назад
      ship.pos.x = originalX;
      ship.pos.y = originalY;
      ship.angle = originalAngle;

      if (bullet) {
        events.dispatchEvent(new CustomEvent('fired', { detail: { x: bullet.pos.x, y: bullet.pos.y } }));
        world.spawn(bullet);
      }
    }
  });
  // ===================================================

  loop = createLoop({ step: 1 / 60, simulate, render });
  loop.start();

  window.loop = loop;
  window.world = world;
  window.roomName = roomName;

  // Чат
  const chatBox = document.getElementById('chat-box');
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  chatBox.classList.remove('hidden');

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && document.activeElement !== chatInput) {
      chatInput.focus(); e.preventDefault();
    }
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.code === 'Enter') {
      const text = chatInput.value.trim();
      if (text && window.ws && window.ws.readyState === 1) {
        window.ws.send(JSON.stringify({ type: 'chat', text }));
        chatInput.value = '';
      }
      chatInput.blur();
    }
  });

  // Слухаємо сервер
  if (window.ws) {
    window.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'chat') {
        const div = document.createElement('div');
        div.innerHTML = `<span style="color:#4af;">${msg.playerName}</span>: ${msg.text}`;
        chatMessages.appendChild(div);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      } else if (msg.type === 'snapshot') {
        lastSnapshot = currSnapshot;
        currSnapshot = msg.ship;
        snapshotTime = performance.now();
      }
    });
  }
}

function spawnAsteroid() {
  let x, y;
  do { x = Math.random() * 1920; y = Math.random() * 1080; }
  while (Math.hypot(x - ship.pos.x, y - ship.pos.y) < 200);
  const vx = (Math.random() - 0.5) * 100;
  const vy = (Math.random() - 0.5) * 100;
  world.spawn(new Asteroid(x, y, vx, vy, Math.floor(Math.random() * 3)));
}

function simulate(dt) {
  if (ship.alive) {
    prevShip.x = ship.pos.x; prevShip.y = ship.pos.y;
    prevShip.angle = ship.angle; prevShip.thrust = ship.thrust;
  }

  // Відправляємо інпути на сервер
  if (window.ws && window.ws.readyState === 1) {
    window.ws.send(JSON.stringify({
      type: 'input',
      up: input.isDown('ArrowUp') || input.isDown('KeyW'),
      left: input.isDown('ArrowLeft') || input.isDown('KeyA'),
      right: input.isDown('ArrowRight') || input.isDown('KeyD'),
    }));
  }

  // Рухаємо локально
  world.step(dt, input, 1920, 1080);

  const collisions = detectCollisions(world);
  resolveCollisions(
    collisions, world,
    (x, y, r) => world.spawn(new Explosion(x, y, r)),
    (points) => { score += points; },
    () => {}
  );

  if (ship.alive) {
    if (ship.pos.x < 0) ship.pos.x += 1920;
    if (ship.pos.x > 1920) ship.pos.x -= 1920;
    if (ship.pos.y < 0) ship.pos.y += 1080;
    if (ship.pos.y > 1080) ship.pos.y -= 1080;
  } else {
    respawnTimer += dt;
    if (respawnTimer >= 2) {
      respawnTimer = 0;
      ship = world.spawn(new Ship(1920 / 2, 1080 / 2));
    }
  }
  input.endFrame();
}

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function render(alpha) {
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, viewWidth, viewHeight);
  drawGrid();

  for (const e of world) {
    if (e.kind === 'ship') continue;
    e.draw(ctx);
  }

  // === ІНТЕРПОЛЯЦІЯ КОРАБЛЯ ===
  if (ship.alive && currSnapshot) {
    let drawX = ship.pos.x;
    let drawY = ship.pos.y;
    let drawAngle = ship.angle;

    if (lastSnapshot && currSnapshot) {
      const t = Math.min((performance.now() - snapshotTime) / (1000 / 30), 1);
      drawX = lerp(lastSnapshot.x, currSnapshot.x, t);
      drawY = lerp(lastSnapshot.y, currSnapshot.y, t);
      drawAngle = lerpAngle(lastSnapshot.angle, currSnapshot.angle, t);
    } else if (currSnapshot) {
      drawX = currSnapshot.x;
      drawY = currSnapshot.y;
      drawAngle = currSnapshot.angle;
    }

    const interpShip = {
      x: drawX,
      y: drawY,
      angle: drawAngle,
      thrust: ship.thrust,
    };
    drawShip(interpShip);
  }

  const stats = loop.getStats();
  const speed = ship.vel.length();
  hudElement.innerHTML = `
    steps/s: ${stats.stepsPerSecond}<br>
    frames/s: ${stats.framesPerSecond}<br>
    frame time: ${stats.frameTime.toFixed(2)} ms<br>
    <br>
    x: ${ship.pos.x.toFixed(0)}, y: ${ship.pos.y.toFixed(0)}<br>
    speed: ${speed.toFixed(0)} px/s<br>
    hp: ${ship.hp}<br>
    entities: ${world.size}<br>
    <br>
    <span style="color: yellow; font-size: 18px;">SCORE: ${score}</span><br>
    <span style="color: #888;">Room: ${window.roomName || 'Unknown'}</span>
    ${!ship.alive ? `<br><span style="color: red;">RESPAWN IN ${(2 - respawnTimer).toFixed(1)}s</span>` : ''}
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

function drawShip(s) {
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
    ctx.moveTo(-10, -6); ctx.lineTo(-20 - Math.random() * 8, 0); ctx.lineTo(-10, 6);
    ctx.closePath(); ctx.fillStyle = 'orange'; ctx.fill();
  }
  ctx.restore();
}

start();