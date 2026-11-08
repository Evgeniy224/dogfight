export function detectCollisions(world) {
  const collisions = [];
  const entities = [...world];

  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i];
      const b = entities[j];
      if (!a.alive || !b.alive) continue;
      
      if (a.kind === 'bullet' && b.kind === 'bullet') continue;
      if (a.kind === 'asteroid' && b.kind === 'asteroid') continue;
      if (a.kind === 'pickup' && b.kind === 'pickup') continue;

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

export function resolveCollisions(collisions, world) {
  for (const { a, b } of collisions) {
    if (a.kind === 'bullet' && (b.kind === 'ship' || b.kind === 'asteroid')) {
      handleBulletHit(a, b);
    } else if (b.kind === 'bullet' && (a.kind === 'ship' || a.kind === 'asteroid')) {
      handleBulletHit(b, a);
    } else if (a.kind === 'ship' && b.kind === 'asteroid') {
      a.takeDamage(20);
      b.kill(); // <-- Астероїд гине при зіткненні
    } else if (b.kind === 'ship' && a.kind === 'asteroid') {
      b.takeDamage(20);
      a.kill(); // <-- Астероїд гине при зіткненні
    } else if (a.kind === 'ship' && b.kind === 'pickup') {
      if (b.pickupBehavior) b.pickupBehavior.apply(a);
      b.kill(); // <-- Pickup зникає
    } else if (b.kind === 'ship' && a.kind === 'pickup') {
      if (a.pickupBehavior) a.pickupBehavior.apply(b);
      a.kill(); // <-- Pickup зникає
    }
  }
}

function handleBulletHit(bullet, target) {
  if (!bullet.alive || !target.alive) return;
  bullet.kill();
  if (target.takeDamage) {
    const destroyed = target.takeDamage(bullet.damage || 25);
    if (destroyed) {
      // target вже викликав kill() всередині takeDamage
    }
  } else {
    target.kill();
  }
}