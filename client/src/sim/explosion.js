import { Entity } from './entity.js';

/**
 * Частинка вибуху. Живе коротко, рухається у випадковому напрямку,
 * згасає. Використовується як "ефект" при знищенні об'єктів.
 */
export class Explosion extends Entity {
  static LIFETIME = 0.6;

  constructor(x, y, radius) {
    super(x, y);
    this.kind = 'explosion';
    this.radius = radius * 1.5; // для малювання
    this.lifetime = Explosion.LIFETIME;
    this.maxLifetime = Explosion.LIFETIME;

    // Кількість частинок залежить від розміру
    const count = Math.floor(radius * 0.5) + 5;
    this.particles = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 50 + Math.random() * 200;
      this.particles.push({
        x: 0,
        y: 0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 1 + Math.random() * 3,
      });
    }
  }

  update(dt) {
    this.lifetime -= dt;
    if (this.lifetime <= 0) {
      this.kill();
      return;
    }

    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Тертя
      p.vx *= 0.95;
      p.vy *= 0.95;
    }
  }

  draw(ctx) {
    const t = this.lifetime / this.maxLifetime; // 1 -> 0

    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    for (const p of this.particles) {
      ctx.globalAlpha = t;
      ctx.fillStyle = `hsl(${20 + t * 40}, 100%, ${40 + t * 40}%)`;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.restore();
  }
}