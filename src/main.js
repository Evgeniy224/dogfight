import { createLoop } from './loop.js';
import { createInput } from './input.js';
import { Ship } from './sim/ship.js';
import { World } from './sim/world.js';
import { Asteroid } from './sim/asteroid.js';
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

// --- Введення ---
const input = createInput(window);

// --- Рахунок ---
let score = 0;

// --- Світ ---
const world = new World({
  onExplosion: (x, y, r) => {
    world.spawn(new Explosion(x, y, r));
  },
  onScore: (points) => {
    score += points;
  },
});

// === ДЕМО КОМПОЗИЦІЇ: homing-куля ===
// Кожен 5-й постріл буде homing
let shotCounter = 0;

// --- Корабель ---
let ship = world.spawn(new Ship(viewWidth / 2, viewHeight / 2));
let respawnTimer = 0;

// --- Астероїди ---
function spawnAsteroid() {
  let x, y;
  do {
    x = Math.random() * viewWidth;
    y = Math.random() * viewHeight;
  } while (Math.hypot(x - ship.pos.x, y - ship.pos.y) < 200);

  const vx = (Math.random() - 0.5) * 100;
  const vy = (Math.random() - 0.5) * 100;
  world.spawn(new Asteroid(x, y, vx, vy, Math.floor(Math.random() * 3)));
}

for (let i = 0; i < 8; i++) spawnAsteroid();

// --- Pickup для тесту ---
world.spawn(new Pickup(viewWidth * 0.3, viewHeight * 0.3, 'shield'));
world.spawn(new Pickup(viewWidth * 0.7, viewHeight * 0.7, 'rapid_fire'));

// --- Стрільба ---
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && ship.alive) {
    const bullet = ship.fire();
    if (bullet) {
      // === КОМПОЗИЦІЯ: кожен 5-й постріл — homing ===
      shotCounter++;
      if (shotCounter % 5 === 0) {
        bullet.homing = createHoming(4.0);
        // Знаходимо найближчий астероїд
        let nearest = null;
        let nearestDist = Infinity;
        for (const ast of world.ofKind('asteroid')) {
          const d = Math.hypot(ast.pos.x - ship.pos.x, ast.pos.y - ship.pos.y);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = ast;
          }
        }
        bullet.homingTarget = nearest;
      }
      world.spawn(bullet);
    }
  }
});

// --- Інтерполяція корабля ---
let prevShip = {
  x: ship.pos.x,
  y: ship.pos.y,
  angle: ship.angle,
  thrust: ship.thrust,
};

let spawnTimer = 0;

// --- Симуляція ---
function simulate(dt) {
  if (ship.alive) {
    prevShip.x = ship.pos.x;
    prevShip.y = ship.pos.y;
    prevShip.angle = ship.angle;
    prevShip.thrust = ship.thrust;

     // Спавн нових астероїдів кожні 3 секунди
  spawnTimer += dt;
  if (spawnTimer >= 8) {
    spawnTimer = 0;
    if (world.ofKind('asteroid').next().done === false || countAsteroids() < 15) {
      spawnAsteroid();
    }
  }

  input.endFrame();
}

function countAsteroids() {
  let n = 0;
  for (const _ of world.ofKind('asteroid')) n++;
  return n;
  }

  world.step(dt, input, viewWidth, viewHeight);

  // Загортання корабля
  if (ship.alive) {
    if (ship.pos.x < 0) ship.pos.x += viewWidth;
    if (ship.pos.x > viewWidth) ship.pos.x -= viewWidth;
    if (ship.pos.y < 0) ship.pos.y += viewHeight;
    if (ship.pos.y > viewHeight) ship.pos.y -= viewHeight;
  } else {
    // Респавн
    respawnTimer += dt;
    if (respawnTimer >= 2) {
      respawnTimer = 0;
      ship = world.spawn(new Ship(viewWidth / 2, viewHeight / 2));
      prevShip.x = ship.pos.x;
      prevShip.y = ship.pos.y;
      prevShip.angle = ship.angle;
      prevShip.thrust = ship.thrust;
    }
  }

  input.endFrame();
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

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

  // Малюємо всі сутності (крім корабля)
  for (const e of world) {
    if (e.kind === 'ship') continue;
    e.draw(ctx);
  }

  // Корабель з інтерполяцією
  if (ship.alive) {
    const interpShip = {
      x: lerp(prevShip.x, ship.pos.x, alpha),
      y: lerp(prevShip.y, ship.pos.y, alpha),
      angle: lerpAngle(prevShip.angle, ship.angle, alpha),
      thrust: ship.thrust,
    };
    drawShip(interpShip);
  }

  // HUD
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
    ${ship.shield > 0 ? `<span style="color: #4f4;">SHIELD: ${ship.shield.toFixed(1)}s</span><br>` : ''}
    ${ship.rapidFire > 0 ? `<span style="color: #ff4;">RAPID FIRE: ${ship.rapidFire.toFixed(1)}s</span><br>` : ''}
    <br>
    <span style="color: yellow; font-size: 18px;">SCORE: ${score}</span>
    ${!ship.alive ? `<br><span style="color: red;">RESPAWN IN ${(2 - respawnTimer).toFixed(1)}s</span>` : ''}
  `;
}

function drawGrid() {
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1;
  const step = 50;
  ctx.beginPath();
  for (let x = 0; x < viewWidth; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, viewHeight);
  }
  for (let y = 0; y < viewHeight; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(viewWidth, y);
  }
  ctx.stroke();
}

function drawShip(s) {
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.angle);

  ctx.beginPath();
  ctx.moveTo(15, 0);
  ctx.lineTo(-10, -8);
  ctx.lineTo(-10, 8);
  ctx.closePath();

  ctx.fillStyle = '#4af';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();

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

const loop = createLoop({
  step: 1 / 60,
  simulate,
  render,
});

loop.start();

window.loop = loop;
window.world = world;