import { Bullet } from './bullet.js';
import { Entity, type EntityInput } from './entity.js';
import { Vector2 } from './vector.js';

export class Ship extends Entity {
  static readonly ROTATION_SPEED = 4;
  static readonly THRUST_POWER = 400;
  static readonly DRAG = 1.5;
  static readonly MAX_SPEED = 500;
  readonly kind = 'ship';
  #hp = 100;
  thrust = false;
  cooldown = 0;
  shield = 0;
  rapidFire = 0;

  constructor(x: number, y: number) {
    super(x, y);
    this.radius = 15;
  }

  get hp(): number { return this.#hp; }

  takeDamage(amount: number): boolean {
    if (this.shield > 0) return false;
    this.#hp -= amount;
    if (this.#hp <= 0) {
      this.#hp = 0;
      this.kill();
      return true;
    }
    return false;
  }

  override update(dt: number, input: EntityInput | null = null): void {
    if (input?.isDown('ArrowLeft') || input?.isDown('KeyA')) this.angle -= Ship.ROTATION_SPEED * dt;
    if (input?.isDown('ArrowRight') || input?.isDown('KeyD')) this.angle += Ship.ROTATION_SPEED * dt;
    if (this.shield > 0) this.shield -= dt;
    if (this.rapidFire > 0) this.rapidFire -= dt;
    this.thrust = Boolean(input?.isDown('ArrowUp') || input?.isDown('KeyW'));
    if (this.thrust) {
      const thrust = Vector2.fromAngle(this.angle, Ship.THRUST_POWER * dt);
      this.vel.addInPlace(thrust);
    }
    const drag = Math.exp(-Ship.DRAG * dt);
    this.vel.scaleInPlace(drag);
    const speed = this.vel.length();
    if (speed > Ship.MAX_SPEED) this.vel.scaleInPlace(Ship.MAX_SPEED / speed);
    this.pos.addInPlace(this.vel.scale(dt));
    if (this.cooldown > 0) this.cooldown -= dt;
  }

  fire(): Bullet | null {
    if (this.cooldown > 0) return null;
    this.cooldown = this.rapidFire > 0 ? 0.05 : 0.2;
    const nose = Vector2.fromAngle(this.angle, this.radius).add(new Vector2(this.pos.x, this.pos.y));
    return new Bullet(nose.x, nose.y, this.angle, this.vel);
  }
}
