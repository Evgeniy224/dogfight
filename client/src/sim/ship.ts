import { Entity } from './entity.js';
import { Vector2 } from './vector.js';
import { Bullet } from './bullet.js';
import { events } from '../events.js';
import type { InputState } from '../types.js';

export class Ship extends Entity {
  static readonly ROTATION_SPEED = 4.0;
  static readonly THRUST_POWER = 400;
  static readonly DRAG = 1.5;
  static readonly MAX_SPEED = 500;

  #hp = 100;
  override kind: 'ship';
  radius: number;
  thrust: boolean;
  cooldown: number;
  shield: number;
  rapidFire: number;

  constructor(x: number, y: number) {
    super(x, y);
    this.kind = 'ship';
    this.radius = 15;
    this.thrust = false;
    this.cooldown = 0;
    this.shield = 0;      // секунди захисту
    this.rapidFire = 0;   // секунди швидкої стрільби
  }

  get hp(): number {
    return this.#hp;
  }

  takeDamage(amount: number): boolean {
    if (this.shield > 0) {
      return false; // shield блокує всю шкоду
    }
    this.#hp -= amount;
    if (this.#hp <= 0) {
      this.#hp = 0;
      this.kill();
      return true;
    }
    return false;
  }

  override update(dt: number, input?: InputState): void {
    if (!input) return;
    if (input.isDown('ArrowLeft') || input.isDown('KeyA')) {
      this.angle -= Ship.ROTATION_SPEED * dt;
    }
    if (input.isDown('ArrowRight') || input.isDown('KeyD')) {
      this.angle += Ship.ROTATION_SPEED * dt;
    }

    // Таймери ефектів
    if (this.shield > 0) this.shield -= dt;
    if (this.rapidFire > 0) this.rapidFire -= dt;

    this.thrust = input.isDown('ArrowUp') || input.isDown('KeyW');
    if (this.thrust) {
      const thrustVec = Vector2.fromAngle(this.angle, Ship.THRUST_POWER * dt);
      this.vel.x += thrustVec.x;
      this.vel.y += thrustVec.y;
    }

    const dragFactor = Math.exp(-Ship.DRAG * dt);
    this.vel.x *= dragFactor;
    this.vel.y *= dragFactor;

    const speed = this.vel.length();
    if (speed > Ship.MAX_SPEED) {
      const scale = Ship.MAX_SPEED / speed;
      this.vel.x *= scale;
      this.vel.y *= scale;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    if (this.cooldown > 0) this.cooldown -= dt;
  }

  fire(): Bullet | null {
    if (this.cooldown > 0) return null;
    this.cooldown = this.rapidFire > 0 ? 0.05 : 0.2;

    const nose = Vector2.fromAngle(this.angle, this.radius).add(this.pos);

    // Подія "fired"
    events.dispatchEvent(new CustomEvent('fired', {
      detail: { x: nose.x, y: nose.y }
    }));

    return new Bullet(nose.x, nose.y, this.angle, this.vel);
  }
}