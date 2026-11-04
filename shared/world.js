export class World {
  #entities = new Map();
  #pendingRemoval = [];

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

  /**
   * Оновлює всі сутності. 
   * Колізії НЕ обробляються тут — вони викликаються ззовні 
   * (на сервері або в клієнті), щоб World залишався "чистим".
   */
  step(dt, input, viewWidth, viewHeight) {
    for (const e of this.#entities.values()) {
      e.update(dt, input, viewWidth, viewHeight);
    }
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