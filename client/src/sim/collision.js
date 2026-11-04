import { events } from '../events.js';

/**
 * Система колізій. Наївна O(n²) — для кожної пари сутностей перевіряємо
 * перетин кіл.
 */
export function detectCollisions(world) {
  const collisions = [];
  const entities = [...world];

  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i];
      const b = entities[j];

      if (!a.alive || !b.alive) continue;
      if (!shouldCollide(a, b)) continue;

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

function shouldCollide(a, b) {
  if (a.kind === 'bullet' && b.kind === 'bullet') return false;
  if (a.kind === 'asteroid' && b.kind === 'asteroid') return false;
  if (a.kind === 'pickup' && b.kind === 'pickup') return false;
  return true;
}

export function resolveCollisions(collisions, world, onExplosion, onScore, onSplitAsteroid) {
  for (const { a, b } of collisions) {
    if (a.kind === 'bullet' && (b.kind === 'ship' || b.kind === 'asteroid')) {
      handleBulletHit(a, b, world, onExplosion, onScore, onSplitAsteroid);
    } else if (b.kind === 'bullet' && (a.kind === 'ship' || a.kind === 'asteroid')) {
      handleBulletHit(b, a, world, onExplosion, onScore, onSplitAsteroid);
    } else if (a.kind === 'ship' && b.kind === 'asteroid') {
      handleShipAsteroid(a, b, world, onExplosion);
    } else if (b.kind === 'ship' && a.kind === 'asteroid') {
      handleShipAsteroid(b, a, world, onExplosion);
    } else if (a.kind === 'ship' && b.kind === 'pickup') {
      handlePickup(a, b);
    } else if (b.kind === 'ship' && a.kind === 'pickup') {
      handlePickup(b, a);
    }
  }
}

function handleBulletHit(bullet, target, world, onExplosion, onScore, onSplitAsteroid) {
  if (!bullet.alive || !target.alive) return;
  bullet.kill();

  events.dispatchEvent(new CustomEvent('hit', { detail: { x: target.pos.x, y: target.pos.y } }));
  const destroyed = target.takeDamage(bullet.damage);
  
  if (destroyed) {
    onExplosion(target.pos.x, target.pos.y, target.radius);
    events.dispatchEvent(new CustomEvent('exploded', { detail: { x: target.pos.x, y: target.pos.y, radius: target.radius } }));
    if (target.kind === 'asteroid') onScore(target.scoreValue);
  }
}

function handleShipAsteroid(ship, asteroid, world, onExplosion) {
  if (!ship.alive) return;
  ship.takeDamage(20);
  asteroid.kill();
  onExplosion(asteroid.pos.x, asteroid.pos.y, asteroid.radius);
  events.dispatchEvent(new CustomEvent('exploded', { detail: { x: asteroid.pos.x, y: asteroid.pos.y, radius: asteroid.radius } }));
}

function handlePickup(ship, pickup) {
  if (!ship.alive || !pickup.alive) return;
  if (pickup.pickupBehavior) pickup.pickupBehavior.apply(ship);
  pickup.kill();
}