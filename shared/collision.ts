import type { Asteroid } from './asteroid.js';
import type { Bullet } from './bullet.js';
import type { Pickup } from './pickup.js';
import type { Ship } from './ship.js';

export type GameEntity = Ship | Asteroid | Bullet | Pickup;

export interface CollisionPair {
  readonly a: GameEntity;
  readonly b: GameEntity;
}

export interface EntityCollection extends Iterable<GameEntity> {}

export function detectCollisions(world: EntityCollection): CollisionPair[] {
  const collisions: CollisionPair[] = [];
  const entities = [...world];
  for (let i = 0; i < entities.length; i += 1) {
    for (let j = i + 1; j < entities.length; j += 1) {
      const a = entities[i];
      const b = entities[j];
      if (!a || !b || !a.alive || !b.alive) continue;
      if ((a.kind === 'bullet' && b.kind === 'bullet')
        || (a.kind === 'asteroid' && b.kind === 'asteroid')
        || (a.kind === 'pickup' && b.kind === 'pickup')) continue;
      const dx = a.pos.x - b.pos.x;
      const dy = a.pos.y - b.pos.y;
      const radiusSum = a.radius + b.radius;
      if (dx * dx + dy * dy < radiusSum * radiusSum) collisions.push({ a, b });
    }
  }
  return collisions;
}

function isDamageable(entity: GameEntity): entity is Ship | Asteroid {
  return entity.kind === 'ship' || entity.kind === 'asteroid';
}

function handleBulletHit(bullet: Bullet, target: Ship | Asteroid): void {
  if (!bullet.alive || !target.alive) return;
  bullet.kill();
  target.takeDamage(bullet.damage);
}

export function resolveCollisions(collisions: readonly CollisionPair[], _world?: EntityCollection): void {
  for (const { a, b } of collisions) {
    if (a.kind === 'bullet' && isDamageable(b)) {
      handleBulletHit(a, b);
    } else if (b.kind === 'bullet' && isDamageable(a)) {
      handleBulletHit(b, a);
    } else if (a.kind === 'ship' && b.kind === 'asteroid') {
      a.takeDamage(20);
      b.kill();
    } else if (b.kind === 'ship' && a.kind === 'asteroid') {
      b.takeDamage(20);
      a.kill();
    } else if (a.kind === 'ship' && b.kind === 'pickup') {
      b.pickupBehavior.apply(a);
      b.kill();
    } else if (b.kind === 'ship' && a.kind === 'pickup') {
      a.pickupBehavior.apply(b);
      a.kill();
    }
  }
}
