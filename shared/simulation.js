// shared/simulation.js
import { Ship } from './ship.js';
import { Asteroid } from './asteroid.js';
import { World } from './world.js';
import { Pickup } from './pickup.js';
import { PRNG } from './rng.js';
import { detectCollisions, resolveCollisions } from './collision.js';

export function createWorld(width, height, seed = 12345) {
  const world = new World();
  const rng = new PRNG(seed);
  
  for (let i = 0; i < 12; i++) {
    let x, y;
    do {
      x = rng.range(0, width);
      y = rng.range(0, height);
    } while (Math.hypot(x - width / 2, y - height / 2) < 200);
    
    const vx = rng.range(-50, 50);
    const vy = rng.range(-50, 50);
    const sizeIndex = Math.floor(rng.range(0, 3));
    world.spawn(new Asteroid(x, y, vx, vy, sizeIndex, rng));
  }
  
  world.spawn(new Pickup(width * 0.3, height * 0.3, 'shield'));
  world.spawn(new Pickup(width * 0.7, height * 0.7, 'rapid_fire'));
  
  return { world, rng };
}

export function stepSimulation(world, dt, inputs, width, height) {
  // Оновлення кораблів
  for (const ship of world.ofKind('ship')) {
    const input = inputs[ship.id] || {};
    const inputAdapter = {
      isDown: (code) => {
        if (code === 'KeyW' || code === 'ArrowUp') return !!input.up;
        if (code === 'KeyA' || code === 'ArrowLeft') return !!input.left;
        if (code === 'KeyD' || code === 'ArrowRight') return !!input.right;
        return false;
      }
    };
    ship.update(dt, inputAdapter);
    
    // Якщо гравець натиснув постріл
    if (input.fire) {
      const bullet = ship.fire();
      if (bullet) {
        bullet.ownerId = ship.id;
        world.spawn(bullet);
      }
    }
  }

  // Оновлення інших сутностей
  for (const entity of world) {
    if (entity.kind !== 'ship') {
      entity.update(dt, null, width, height);
    }
  }

  // Загортання країв для кораблів
  for (const ship of world.ofKind('ship')) {
    if (ship.pos.x < 0) ship.pos.x += width;
    if (ship.pos.x > width) ship.pos.x -= width;
    if (ship.pos.y < 0) ship.pos.y += height;
    if (ship.pos.y > height) ship.pos.y -= height;
  }

  // Колізії
  const collisions = detectCollisions(world);
  resolveCollisions(collisions, world);
}