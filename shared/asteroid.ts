import { Entity, type EntityInput } from './entity.js';
import type { PRNG } from './rng.js';
import { Vector2 } from './vector.js';

export interface AsteroidSize { readonly radius: number; readonly hp: number; readonly score: number }

export class Asteroid extends Entity {
  static readonly SIZES: readonly AsteroidSize[] = [
    { radius: 40, hp: 100, score: 10 },
    { radius: 25, hp: 60, score: 20 },
    { radius: 15, hp: 30, score: 30 },
  ];
  readonly kind = 'asteroid';
  readonly sizeIndex: number;
  readonly scoreValue: number;
  readonly angularVel: number;
  #hp: number;

  constructor(x: number, y: number, vx: number, vy: number, sizeIndex = 0, rng: PRNG | null = null) {
    super(x, y);
    const size = Asteroid.SIZES[sizeIndex];
    if (!size) throw new RangeError('Invalid asteroid size');
    this.sizeIndex = sizeIndex;
    this.radius = size.radius;
    this.#hp = size.hp;
    this.scoreValue = size.score;
    this.vel = new Vector2(vx, vy);
    this.angularVel = ((rng?.random() ?? 0.5) - 0.2) * 0.1;
  }

  get hp(): number { return this.#hp; }

  takeDamage(amount: number): boolean {
    this.#hp -= amount;
    if (this.#hp <= 0) {
      this.kill();
      return true;
    }
    return false;
  }

  override update(dt: number, _input?: EntityInput | null, viewWidth = 0, viewHeight = 0): void {
    super.update(dt);
    this.angle += this.angularVel * dt;
    let x = this.pos.x;
    let y = this.pos.y;
    let vx = this.vel.x;
    let vy = this.vel.y;
    if (x - this.radius < 0) { x = this.radius; vx = Math.abs(vx); }
    if (x + this.radius > viewWidth) { x = viewWidth - this.radius; vx = -Math.abs(vx); }
    if (y - this.radius < 0) { y = this.radius; vy = Math.abs(vy); }
    if (y + this.radius > viewHeight) { y = viewHeight - this.radius; vy = -Math.abs(vy); }
    this.pos.set(x, y);
    this.vel.set(vx, vy);
  }

  override draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.angle);
    ctx.beginPath();
    for (let index = 0; index < 7; index += 1) {
      const angle = (index / 7) * Math.PI * 2;
      const radius = this.radius * (0.8 + (index % 2 === 0 ? 0.3 : 0));
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#666';
    ctx.fill();
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}
