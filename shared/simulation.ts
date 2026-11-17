import { Asteroid } from './asteroid.js';
import { detectCollisions, resolveCollisions, type GameEntity } from './collision.js';
import { Pickup } from './pickup.js';
import { PRNG } from './rng.js';
import { Ship } from './ship.js';
import { World } from './world.js';

export interface SimulationInput {
  up?: boolean;
  left?: boolean;
  right?: boolean;
  fire?: boolean;
}

export function createWorld(width: number, height: number, seed = 12345): { world: World; rng: PRNG } {
  const world = new World();
  const rng = new PRNG(seed);
  for (let index = 0; index < 12; index += 1) {
    let x: number;
    let y: number;
    do {
      x = rng.range(0, width);
      y = rng.range(0, height);
    } while (Math.hypot(x - width / 2, y - height / 2) < 200);
    world.spawn(new Asteroid(x, y, rng.range(-50, 50), rng.range(-50, 50), Math.floor(rng.range(0, 3)), rng));
  }
  world.spawn(new Pickup(width * 0.3, height * 0.3, 'shield'));
  world.spawn(new Pickup(width * 0.7, height * 0.7, 'rapid_fire'));
  return { world, rng };
}

export function stepSimulation(
  world: World,
  dt: number,
  inputs: Readonly<Record<number, SimulationInput | undefined>>,
  width: number,
  height: number,
): void {
  for (const ship of world.ofKind('ship')) {
    const input = inputs[ship.id] ?? {};
    const adapter = {
      isDown(code: string): boolean {
        if (code === 'KeyW' || code === 'ArrowUp') return Boolean(input.up);
        if (code === 'KeyA' || code === 'ArrowLeft') return Boolean(input.left);
        if (code === 'KeyD' || code === 'ArrowRight') return Boolean(input.right);
        return false;
      },
    };
    ship.update(dt, adapter);
    if (input.fire) {
      const bullet = ship.fire();
      if (bullet) {
        bullet.ownerId = ship.id;
        world.spawn(bullet);
      }
    }
  }
  for (const entity of world) {
    if (entity.kind !== 'ship') entity.update(dt, null, width, height);
  }
  for (const ship of world.ofKind('ship')) {
    let x = ship.pos.x;
    let y = ship.pos.y;
    if (x < 0) x += width;
    if (x > width) x -= width;
    if (y < 0) y += height;
    if (y > height) y -= height;
    ship.pos.set(x, y);
  }
  const collisions = detectCollisions(world);
  resolveCollisions(collisions, world);
}
