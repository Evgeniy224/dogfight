import { Vector2 } from './vector.js';

export type EntityKind = 'entity' | 'ship' | 'asteroid' | 'bullet' | 'pickup';

export interface EntityInput {
  isDown(code: string): boolean;
}

export class Entity {
  static #nextId = 1;
  #id = Entity.#nextId++;

  pos: Vector2;
  vel: Vector2;
  angle = 0;
  radius = 10;
  alive = true;
  readonly kind: EntityKind = 'entity';

  constructor(x = 0, y = 0) {
    this.pos = new Vector2(x, y);
    this.vel = new Vector2();
  }

  get id(): number {
    return this.#id;
  }

  set id(value: number) {
    const numericId = Number(value);
    if (!Number.isSafeInteger(numericId) || numericId < 0) throw new RangeError('Invalid entity id');
    this.#id = numericId;
  }

  update(dt: number, _input?: EntityInput | null, _viewWidth?: number, _viewHeight?: number): void {
    this.pos.addInPlace(this.vel.scale(dt));
  }

  draw(_ctx: CanvasRenderingContext2D): void {}

  kill(): void {
    this.alive = false;
  }
}

export { Vector2 };
