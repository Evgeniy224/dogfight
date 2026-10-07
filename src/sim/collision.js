/**
 * Система колізій. Наївна O(n²) — для кожної пари сутностей перевіряємо
 * перетин кіл. Для 100+ об'єктів це ок.
 *
 * НЕ мутує сутності — лише повертає список пар, що перетинаються.
 * Це дозволяє легко замінити реалізацію (spatial hash, quadtree).
 *
 * @param {World} world
 * @returns {Array<{a: Entity, b: Entity}>} — список пар, що зіткнулися
 */
export function detectCollisions(world) {
  const collisions = [];
  const entities = [...world]; // Матеріалізуємо у масив для подвійного циклу


  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i];
      const b = entities[j];

      // Пропускаємо мертвих
      if (!a.alive || !b.alive) continue;

      // Пропускаємо пари, які не повинні взаємодіяти
      if (!shouldCollide(a, b)) continue;

      // Перевірка перетину кіл
      const dx = a.pos.x - b.pos.x;
      const dy = a.pos.y - b.pos.y;
      const distSq = dx * dx + dy * dy;
      const radiusSum = a.radius + b.radius;

      if (distSq < radiusSum * radiusSum) {
        collisions.push({ a, b });
      }
    }
  }

  return collisions;
}

/**
 * Чи можуть дві сутності взаємодіяти? Наприклад:
 * - куля не б'є іншу кулю
 * - корабель не б'є інший корабель (для гравця — можна, але поки ні)
 */
function shouldCollide(a, b) {
  // Куля vs куля — ігноруємо
  if (a.kind === 'bullet' && b.kind === 'bullet') return false;
  // Корабель vs куля — так
  // Корабель vs астероїд — так
  // Астероїд vs астероїд — ігноруємо (нехай пролітають крізь)
  if (a.kind === 'asteroid' && b.kind === 'asteroid') return false;
  // Куля vs астероїд — так
  if (a.kind === 'pickup' && b.kind === 'pickup') return false;
  return true;
}

/**
 * Обробляє колізію: завдає шкоди, позначає мертвих.
 * Викликається з World.step() після detectCollisions().
 *
 * @param {Array<{a: Entity, b: Entity}>} collisions
 * @param {World} world
 * @param {function} onExplosion - callback для створення вибуху
 * @param {function} onScore - callback для збільшення рахунку
 */
export function resolveCollisions(collisions, world, onExplosion, onScore) {
  for (const { a, b } of collisions) {
    // Куля vs (корабель або астероїд)
    if (a.kind === 'bullet' && (b.kind === 'ship' || b.kind === 'asteroid')) {
      handleBulletHit(a, b, world, onExplosion, onScore);
    } else if (b.kind === 'bullet' && (a.kind === 'ship' || a.kind === 'asteroid')) {
      handleBulletHit(b, a, world, onExplosion, onScore);
    }
    // Корабель vs астероїд
    else if (a.kind === 'ship' && b.kind === 'asteroid') {
      handleShipAsteroid(a, b, world, onExplosion);
    } else if (b.kind === 'ship' && a.kind === 'asteroid') {
      handleShipAsteroid(b, a, world, onExplosion);
    }
        // Корабель vs pickup
    else if (a.kind === 'ship' && b.kind === 'pickup') {
      handlePickup(a, b);
    } else if (b.kind === 'ship' && a.kind === 'pickup') {
      handlePickup(b, a);
    }
  }
}

function handleBulletHit(bullet, target, world, onExplosion, onScore) {
  if (!bullet.alive || !target.alive) return;

  bullet.kill();

  const destroyed = target.takeDamage(bullet.damage);
  if (destroyed) {
    // Вибух у позиції цілі
    onExplosion(target.pos.x, target.pos.y, target.radius);

    // Рахунок, якщо астероїд
    if (target.kind === 'asteroid') {
      onScore(target.scoreValue);
    }
  }
}

function handleShipAsteroid(ship, asteroid, world, onExplosion) {
  if (!ship.alive) return;

  // Корабель отримує шкоду від астероїда, але не гине від одного удару
  const dmg = 20;
  ship.takeDamage(dmg);
  // Астероїд теж руйнується
  asteroid.kill();
  onExplosion(asteroid.pos.x, asteroid.pos.y, asteroid.radius);
}

function handlePickup(ship, pickup) {
  if (!ship.alive || !pickup.alive) return;

  // === КОМПОЗИЦІЯ ===
  // Якщо pickup має поведінку — застосовуємо її.
  if (pickup.pickupBehavior) {
    pickup.pickupBehavior.apply(ship);
  }
  // === КІНЕЦЬ ===

  pickup.kill();
}