import { Entity } from './entity.js';

export class Bullet extends Entity {
  static TTL = 2.0;
  static DAMAGE = 25;
  static SPEED = 600;

  constructor(x, y, angle, inheritVel = null) {
    super(x, y);
    this.kind = 'bullet';
    this.radius = 3;
    this.angle = angle;
    this.ttl = Bullet.TTL;

    this.vel.x = Math.cos(angle) * Bullet.SPEED;
    this.vel.y = Math.sin(angle) * Bullet.SPEED;
    if (inheritVel) {
      this.vel.x += inheritVel.x;
      this.vel.y += inheritVel.y;
    }

    this.damage = Bullet.DAMAGE;

    // === КОМПОЗИЦІЯ ===
    // Якщо задано — куля буде наводитися на ціль.
    // За замовчуванням null (звичайна куля).
    this.homing = null;
  }

  update(dt) {
    super.update(dt);

    // === КОМПОЗИЦІЯ ===
    // Якщо є поведінка homing — застосовуємо її.
    if (this.homing && this.homingTarget) {
      this.homing.update(this, this.homingTarget, dt);
    }

    this.ttl -= dt;
    if (this.ttl <= 0) {
      this.kill();
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = this.homing ? '#f0f' : '#ff0'; // фіолетовий для homing
    ctx.fillRect(-4, -2, 8, 4);
    ctx.restore();
  }
}