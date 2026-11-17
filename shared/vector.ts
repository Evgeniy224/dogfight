/** Immutable-coordinate vector with explicit mutable hot-path helpers. */
export interface Vector2Data {
  readonly x: number;
  readonly y: number;
}

export class Vector2 {
  #x: number;
  #y: number;

  constructor(x = 0, y = 0) {
    this.#x = x;
    this.#y = y;
  }

  get x(): number { return this.#x; }
  get y(): number { return this.#y; }

  set(x: number, y: number): this {
    this.#x = x;
    this.#y = y;
    return this;
  }

  add(other: Vector2): Vector2 {
    return new Vector2(this.x + other.x, this.y + other.y);
  }

  sub(other: Vector2): Vector2 {
    return new Vector2(this.x - other.x, this.y - other.y);
  }

  scale(scalar: number): Vector2 {
    return new Vector2(this.x * scalar, this.y * scalar);
  }

  length(): number {
    return Math.hypot(this.x, this.y);
  }

  normalize(): Vector2 {
    const length = this.length();
    return length === 0 ? new Vector2() : new Vector2(this.x / length, this.y / length);
  }

  rotate(angle: number): Vector2 {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return new Vector2(this.x * cos - this.y * sin, this.x * sin + this.y * cos);
  }

  dot(other: Vector2): number {
    return this.x * other.x + this.y * other.y;
  }

  addInPlace(other: Vector2): this {
    this.#x += other.x;
    this.#y += other.y;
    return this;
  }

  scaleInPlace(scalar: number): this {
    this.#x *= scalar;
    this.#y *= scalar;
    return this;
  }

  static fromAngle(angle: number, length = 1): Vector2 {
    return new Vector2(Math.cos(angle) * length, Math.sin(angle) * length);
  }

  clone(): Vector2 {
    return new Vector2(this.x, this.y);
  }
}
