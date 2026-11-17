import { detectCollisions, resolveCollisions, type GameEntity } from './collision.js';
import type { EntityInput } from './entity.js';
import type { Asteroid } from './asteroid.js';
import type { Bullet } from './bullet.js';
import type { Pickup } from './pickup.js';
import type { Ship } from './ship.js';

export interface WorldCallbacks {
  onExplosion?: (x: number, y: number, radius: number) => void;
  onScore?: (score: number) => void;
}

export class World implements Iterable<GameEntity> {
  #entities = new Map<number, GameEntity>();
  #pendingRemoval: number[] = [];
  #onExplosion: (x: number, y: number, radius: number) => void;
  #onScore: (score: number) => void;

  constructor({ onExplosion, onScore }: WorldCallbacks = {}) {
    this.#onExplosion = onExplosion ?? (() => {});
    this.#onScore = onScore ?? (() => {});
  }

  spawn<T extends GameEntity>(entity: T): T {
    this.#entities.set(entity.id, entity);
    return entity;
  }

  despawn(id: number): void {
    this.#pendingRemoval.push(id);
  }

  get(id: number): GameEntity | undefined {
    return this.#entities.get(id);
  }

  get size(): number {
    return this.#entities.size;
  }

  *[Symbol.iterator](): IterableIterator<GameEntity> {
    yield* this.#entities.values();
  }

  ofKind(kind: 'ship'): IterableIterator<Ship>;
  ofKind(kind: 'asteroid'): IterableIterator<Asteroid>;
  ofKind(kind: 'bullet'): IterableIterator<Bullet>;
  ofKind(kind: 'pickup'): IterableIterator<Pickup>;
  *ofKind(kind: GameEntity['kind']): IterableIterator<GameEntity> {
    for (const entity of this) {
      if (entity.kind === kind) yield entity;
    }
  }

  step(dt: number, input: EntityInput | null, viewWidth: number, viewHeight: number): void {
    for (const entity of this.#entities.values()) entity.update(dt, input, viewWidth, viewHeight);
    const collisions = detectCollisions(this);
    resolveCollisions(collisions, this);
    for (const entity of this.#entities.values()) {
      if (!entity.alive) {
        this.#entities.delete(entity.id);
      }
    }
    for (const id of this.#pendingRemoval) this.#entities.delete(id);
    this.#pendingRemoval.length = 0;
  }
}
