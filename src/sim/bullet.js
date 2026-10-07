import { Entity } from './entity.js';

/**
 * Куля. Має TTL (time-to-live) — автоматично зникає через певний час.
 * Рухається по прямій, завдає шкоди при зіткненні.
 */
export class Bullet extends Entity {
  static TTL = 2.0;      // секунд до самознищення
  static DAMAGE = 25;    // шкода
  static SPEED = 600;    // пікселів/с

  constructor(x, y, angle, inheritVel = null) {
    super(x, y);
    this.kind = 'bullet';
    this.radius = 3;
    this.angle = angle;
    this.ttl = Bullet.TTL;

    // Швидкість: у напрямку кута + успадкована від корабля
    this.vel.x = Math.cos(angle) * Bullet.SPEED;
    this.vel.y = Math.sin(angle) * Bullet.SPEED;
    if (inheritVel) {
      this.vel.x += inheritVel.x;
      this.vel.y += inheritVel.y;
    }

    this.damage = Bullet.DAMAGE;
  }

  update(dt) {
    super.update(dt); // Рухаємось
    this.ttl -= dt;
    if (this.ttl <= 0) {
      this.kill();
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = '#ff0';
    ctx.fillRect(-4, -2, 8, 4);
    ctx.restore();
  }
}