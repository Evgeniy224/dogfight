/**
 * Двовимірний вектор. Усі методи — ЧИСТІ: вони повертають новий вектор,
 * не змінюючи поточний. Це запобігає випадковим мутаціям у грі.
 */
export class Vector2 {
  constructor(public x = 0, public y = 0) {
  }

  /** Додавання: повертає новий вектор (this + other). */
  add(other: Vector2): Vector2 {
    return new Vector2(this.x + other.x, this.y + other.y);
  }

  /** Віднімання: повертає новий вектор (this - other). */
  sub(other: Vector2): Vector2 {
    return new Vector2(this.x - other.x, this.y - other.y);
  }

  /** Множення на скаляр: повертає новий вектор. */
  scale(s: number): Vector2 {
    return new Vector2(this.x * s, this.y * s);
  }

  /** Довжина вектора (модуль). */
  length(): number {
    return Math.hypot(this.x, this.y);
  }

  /** Нормалізація: повертає одиничний вектор того ж напрямку. */
  normalize(): Vector2 {
    const len = this.length();
    if (len === 0) return new Vector2(0, 0);
    return new Vector2(this.x / len, this.y / len);
  }

  /** Обертання на кут (радіани). Повертає новий вектор. */
  rotate(angle: number): Vector2 {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return new Vector2(
      this.x * cos - this.y * sin,
      this.x * sin + this.y * cos
    );
  }

  /** Скалярний добуток. */
  dot(other: Vector2): number {
    return this.x * other.x + this.y * other.y;
  }

  /**
   * Мутабельні версії (для гарячих шляхів, де важлива швидкість).
   */
  addInPlace(other: Vector2): this {
    this.x += other.x;
    this.y += other.y;
    return this;
  }

  scaleInPlace(s: number): this {
    this.x *= s;
    this.y *= s;
    return this;
  }

  /** Статичний конструктор: вектор з кута (для напрямку). */
  static fromAngle(angle: number, length = 1): Vector2 {
    return new Vector2(Math.cos(angle) * length, Math.sin(angle) * length);
  }

  /** Копія вектора. */
  clone(): Vector2 {
    return new Vector2(this.x, this.y);
  }
}