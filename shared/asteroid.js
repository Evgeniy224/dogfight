// shared/asteroid.js
import { Entity } from './entity.js';

export class Asteroid extends Entity {
  static SIZES = [
    { radius: 40, hp: 100, score: 10 },
    { radius: 25, hp: 60, score: 20 },
    { radius: 15, hp: 30, score: 30 },
  ];

  #hp;

  constructor(x, y, vx, vy, sizeIndex = 0, rng = null) {
    super(x, y);
    this.kind = 'asteroid';
    this.sizeIndex = sizeIndex;

    const size = Asteroid.SIZES[sizeIndex];
    this.radius = size.radius;
    this.#hp = size.hp;
    this.scoreValue = size.score;

    this.vel.x = vx;
    this.vel.y = vy;
    this.angle = 0;
    
    // Детерміноване обертання через rng
    const randVal = rng ? rng.random() : 0.5;
    this.angularVel = (randVal - 0.2) * 0.1;
  }

  get hp() {
    return this.#hp;
  }

  takeDamage(amount) {
    this.#hp -= amount;
    if (this.#hp <= 0) {
      this.kill();
      return true;
    }
    return false;
  }

  update(dt, input, viewWidth, viewHeight) {
    super.update(dt);
    this.angle += this.angularVel * dt;

    if (this.pos.x - this.radius < 0) {
      this.pos.x = this.radius;
      this.vel.x = Math.abs(this.vel.x);
    }
    if (this.pos.x + this.radius > viewWidth) {
      this.pos.x = viewWidth - this.radius;
      this.vel.x = -Math.abs(this.vel.x);
    }
    if (this.pos.y - this.radius < 0) {
      this.pos.y = this.radius;
      this.vel.y = Math.abs(this.vel.y);
    }
    if (this.pos.y + this.radius > viewHeight) {
      this.pos.y = viewHeight - this.radius;
      this.vel.y = -Math.abs(this.vel.y);
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.angle);

    ctx.beginPath();
    const points = 7;
    // Фіксована візуальна форма без Math.random
    for (let i = 0; i < points; i++) {
      const a = (i / points) * Math.PI * 2;
      const r = this.radius * (0.8 + (i % 2 === 0 ? 0.3 : 0.0));
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
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