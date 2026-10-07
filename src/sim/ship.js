/**
 * Створює новий корабель з початковим станом.
 */
export function createShip(x, y) {
  return {
    // Позиція
    x,
    y,
    // Швидкість
    vx: 0,
    vy: 0,
    // Кут повороту в радіанах (0 = вправо)
    angle: 0,
    // Чи застосовується тяга
    thrust: false,
  };
}

// --- Константи фізики ---
const ROTATION_SPEED = 4.0;   // рад/сек — швидкість повороту
const THRUST_POWER = 400;     // пікселів/сек² — прискорення при тязі
const DRAG = 1.5;             // коефіцієнт тертя (чим більше — тим швидше гальмує)
const MAX_SPEED = 500;        // максимальна швидкість (пікселів/сек)

/**
 * Оновлює стан корабля на основі введення та часу.
 * Це ЧИСТА функція — вона не торкається DOM, canvas чи чогось іншого.
 *
 * @param {object} ship - об'єкт корабля
 * @param {object} input - об'єкт з методами isDown(code)
 * @param {number} dt - фіксований крок часу в секундах (завжди 1/60)
 */
export function integrate(ship, input, dt) {
  // --- 1. Поворот ---
  if (input.isDown('ArrowLeft') || input.isDown('KeyA')) {
    ship.angle -= ROTATION_SPEED * dt;
  }
  if (input.isDown('ArrowRight') || input.isDown('KeyD')) {
    ship.angle += ROTATION_SPEED * dt;
  }

  // --- 2. Тяга ---
  ship.thrust = input.isDown('ArrowUp') || input.isDown('KeyW');
  if (ship.thrust) {
    ship.vx += Math.cos(ship.angle) * THRUST_POWER * dt;
    ship.vy += Math.sin(ship.angle) * THRUST_POWER * dt;
  }

  // --- 3. Тертя (drag) — експоненційне згасання швидкості ---
  const dragFactor = Math.exp(-DRAG * dt);
  ship.vx *= dragFactor;
  ship.vy *= dragFactor;

  // --- 4. Обмеження максимальної швидкості ---
  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed > MAX_SPEED) {
    ship.vx = (ship.vx / speed) * MAX_SPEED;
    ship.vy = (ship.vy / speed) * MAX_SPEED;
  }

  // --- 5. Оновлення позиції ---
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
}