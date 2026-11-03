import { detectCollisions, resolveCollisions } from './collision.js';

export class World {
  #entities = new Map();
  #pendingRemoval = [];

  // Callbacks для подій
  #onExplosion = null;
  #onScore = null;

  constructor({ onExplosion, onScore } = {}) {
    this.#onExplosion = onExplosion || (() => {});
    this.#onScore = onScore || (() => {});
  }

  spawn(entity) {
    this.#entities.set(entity.id, entity);
    return entity;
  }

  despawn(id) {
    this.#pendingRemoval.push(id);
  }

  get(id) {
    return this.#entities.get(id);
  }

  get size() {
    return this.#entities.size;
  }

  *[Symbol.iterator]() {
    yield* this.#entities.values();
  }

  *ofKind(kind) {
    for (const e of this) {
      if (e.kind === kind) yield e;
    }
  }

  
    step(dt, input, viewWidth, viewHeight) {
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

  #sweep() {
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