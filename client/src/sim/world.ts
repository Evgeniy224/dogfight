import { detectCollisions, resolveCollisions } from './collision.js';
import type { InputState } from '../types.js';
import type { Entity } from './entity.js';

interface WorldCallbacks {
  onExplosion?: (x: number, y: number, radius: number) => void;
  onScore?: (points: number) => void;
}

export class World {
  #entities = new Map<number, Entity>();
  #pendingRemoval: number[] = [];

  // Callbacks для подій
  #onExplosion: (x: number, y: number, radius: number) => void;
  #onScore: (points: number) => void;

  constructor({ onExplosion, onScore }: WorldCallbacks = {}) {
    this.#onExplosion = onExplosion || (() => {});
    this.#onScore = onScore || (() => {});
  }

  spawn<T extends Entity>(entity: T): T {
    this.#entities.set(entity.id, entity);
    return entity;
  }

  despawn(id: number): void {
    this.#pendingRemoval.push(id);
  }

  get(id: number): Entity | undefined {
    return this.#entities.get(id);
  }

  get size(): number {
    return this.#entities.size;
  }

  *[Symbol.iterator](): IterableIterator<Entity> {
    yield* this.#entities.values();
  }

  *ofKind(kind: string): IterableIterator<Entity> {
    for (const e of this) {
      if (e.kind === kind) yield e;
    }
  }

  
    step(dt: number, input: InputState, viewWidth: number, viewHeight: number): void {
    // 1. Оновлення
    for (const e of this.#entities.values()) {
      e.update(dt, input, viewWidth, viewHeight);
    }

    // 2. Колізії
    const collisions = detectCollisions(this);
    resolveCollisions(
      collisions,
      this,
      (x, y, r) => this.#onExplosion(x, y, r),
      (score) => this.#onScore(score)
    );

    // 3. Sweep
    this.#sweep();
  }

  #sweep(): void {
    for (const [id, e] of this.#entities) {
      if (!e.alive) {
        this.#entities.delete(id);
      }
    }
    for (const id of this.#pendingRemoval) {
      this.#entities.delete(id);
    }
    this.#pendingRemoval.length = 0;
  }
}