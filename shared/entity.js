import { Vector2 } from './vector.js';

/**
 * Базова сутність. Усе, що рухається, має позицію, швидкість, кут,
 * радіус (для колізій), стан "живий/мертвий" і тип (kind).
 */
export class Entity {
  // Приватний статичний лічильник для унікальних id
  static #nextId = 1;

  // Приватне поле id — доступне лише всередині класу
  #id = Entity.#nextId++;

  constructor(x = 0, y = 0) {
    this.pos = new Vector2(x, y);
    this.vel = new Vector2(0, 0);
    this.angle = 0;
    this.radius = 10;
    this.alive = true;
    this.kind = 'entity';
  }

  /** Публічний гетер для id. */
  get id() {
    return this.#id;
  }

  /** Публічний сеттер для id, щоб локальний клієнт синхронізував ID з сервером. */
  set id(value) {
    this.#id = Number(value);
  }

  /**
   * Оновлення стану. Викликається кожен крок симуляції.
   */
  update(dt) {
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
  }

  /**
   * Малювання. За замовчуванням — нічого.
   */
  draw(ctx) {}

  /** Позначити сутність як "мертву". */
  kill() {
    this.alive = false;
  }
}