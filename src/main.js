import { createLoop } from './loop.js';
import { createInput } from './input.js';
import { createShip, integrate } from './sim/ship.js';
import { wrapAround } from './sim/arena.js';

// --- Налаштування Canvas ---
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

// --- Введення з клавіатури ---
const input = createInput(window);

// --- Стан гри ---
const ship = createShip(viewWidth / 2, viewHeight / 2);

// Для інтерполяції
const prevShip = {
  x: ship.x,
  y: ship.y,
  angle: ship.angle,
  vx: ship.vx,
  vy: ship.vy,
  thrust: ship.thrust,
};

// --- Функції симуляції та рендерингу ---

function simulate(dt) {
  prevShip.x = ship.x;
  prevShip.y = ship.y;
  prevShip.angle = ship.angle;
  prevShip.thrust = ship.thrust;

  integrate(ship, input, dt);
  wrapAround(ship, viewWidth, viewHeight);

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

  const interpShip = {
    x: lerpWithWrap(prevShip.x, ship.x, alpha, viewWidth),
    y: lerpWithWrap(prevShip.y, ship.y, alpha, viewHeight),
    angle: lerpAngle(prevShip.angle, ship.angle, alpha),
    thrust: ship.thrust,
  };

  drawShip(interpShip);

  const stats = loop.getStats();
  const speed = Math.hypot(ship.vx, ship.vy);
  hudElement.innerHTML = `
    steps/s: ${stats.stepsPerSecond}<br>
    frames/s: ${stats.framesPerSecond}<br>
    frame time: ${stats.frameTime.toFixed(2)} ms<br>
    <br>
    x: ${ship.x.toFixed(0)}, y: ${ship.y.toFixed(0)}<br>
    speed: ${speed.toFixed(0)} px/s
  `;
}

function lerpWithWrap(a, b, t, size) {
  const diff = b - a;
  if (Math.abs(diff) > size / 2) {
    if (diff > 0) {
      return (a + (b + size - a) * t) % size;
    } else {
      return (a + (b - size - a) * t + size) % size;
    }
  }
  return lerp(a, b, t);
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

// --- Створення та запуск циклу ---
const loop = createLoop({
  step: 1 / 60,
  simulate,
  render,
});

loop.start();

window.loop = loop;
window.ship = ship;