import { events } from '../events.js';
import { Asteroid } from './asteroid.js';
import { Bullet } from './bullet.js';
import { Entity } from './entity.js';
import { Pickup } from './pickup.js';
import { Ship } from './ship.js';
import type { World } from './world.js';

interface CollisionPair {
  a: Entity;
  b: Entity;
}

type DamageableEntity = Ship | Asteroid;
type ExplosionCallback = (x: number, y: number, radius: number) => void;
type ScoreCallback = (points: number) => void;
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
export function detectCollisions(world: World): CollisionPair[] {
  const collisions: CollisionPair[] = [];
  const entities = [...world]; // Матеріалізуємо у масив для подвійного циклу


  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i];
      const b = entities[j];
      if (!a || !b) continue;

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
function shouldCollide(a: Entity, b: Entity): boolean {
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
export function resolveCollisions(
  collisions: CollisionPair[],
  _world: World,
  onExplosion: ExplosionCallback,
  onScore: ScoreCallback,
): void {
  for (const { a, b } of collisions) {
    // Куля vs (корабель або астероїд)
    if (a instanceof Bullet && (b instanceof Ship || b instanceof Asteroid)) {
      handleBulletHit(a, b, onExplosion, onScore);
    } else if (b instanceof Bullet && (a instanceof Ship || a instanceof Asteroid)) {
      handleBulletHit(b, a, onExplosion, onScore);
    }
    // Корабель vs астероїд
    else if (a instanceof Ship && b instanceof Asteroid) {
      handleShipAsteroid(a, b, onExplosion);
    } else if (b instanceof Ship && a instanceof Asteroid) {
      handleShipAsteroid(b, a, onExplosion);
    }
        // Корабель vs pickup
    else if (a instanceof Ship && b instanceof Pickup) {
      handlePickup(a, b);
    } else if (b instanceof Ship && a instanceof Pickup) {
      handlePickup(b, a);
    }
  }
}

function handleBulletHit(
  bullet: Bullet,
  target: DamageableEntity,
  onExplosion: ExplosionCallback,
  onScore: ScoreCallback,
): void {
  if (!bullet.alive || !target.alive) return;

  bullet.kill();

  // Подія "hit" (куля влучила)
  events.dispatchEvent(new CustomEvent('hit', {
    detail: { x: target.pos.x, y: target.pos.y }
  }));

  const destroyed = target.takeDamage(bullet.damage);
  if (destroyed) {
    onExplosion(target.pos.x, target.pos.y, target.radius);

    // Подія "exploded" (об'єкт знищено)
    events.dispatchEvent(new CustomEvent('exploded', {
      detail: { x: target.pos.x, y: target.pos.y, radius: target.radius }
    }));

    if (target instanceof Asteroid) {
      onScore(target.scoreValue);
    }
  }
}

function handleShipAsteroid(ship: Ship, asteroid: Asteroid, onExplosion: ExplosionCallback): void {
  if (!ship.alive) return;

  const dmg = 20;
  ship.takeDamage(dmg);
  asteroid.kill();

  onExplosion(asteroid.pos.x, asteroid.pos.y, asteroid.radius);

  // Подія "exploded"
  events.dispatchEvent(new CustomEvent('exploded', {
    detail: { x: asteroid.pos.x, y: asteroid.pos.y, radius: asteroid.radius }
  }));
}

function handlePickup(ship: Ship, pickup: Pickup): void {
  if (!ship.alive || !pickup.alive) return;

  // === КОМПОЗИЦІЯ ===
  // Якщо pickup має поведінку — застосовуємо її.
  if (pickup.pickupBehavior) {
    pickup.pickupBehavior.apply(ship);
  }
  // === КІНЕЦЬ ===

  pickup.kill();
}