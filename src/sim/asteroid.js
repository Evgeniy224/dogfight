import { Entity } from './entity.js';

/**
 * Астероїд. Дрейфує з постійною швидкістю, має HP, при знищенні розпадається.
 * Не може вилітати за межі арени — відбивається від стін.
 */
export class Asteroid extends Entity {
  static SIZES = [
    { radius: 40, hp: 100, score: 10 },  // великий
    { radius: 25, hp: 60, score: 20 },   // середній
    { radius: 15, hp: 30, score: 30 },   // малий
  ];

  #hp;

  constructor(x, y, vx, vy, sizeIndex = 0) {
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
    this.angularVel = (Math.random() - 0.5) * 1.5; // легке обертання
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

    // Відбиття від стін арени (замість загортання)
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
    // Простий многокутник, схожий на астероїд
    const points = 7;
    for (let i = 0; i < points; i++) {
      const a = (i / points) * Math.PI * 2;
      const r = this.radius * (0.8 + Math.random() * 0.4);
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