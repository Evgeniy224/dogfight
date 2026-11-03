import { Entity } from './entity.js';
import { createPickup } from './behaviors.js';

export class Pickup extends Entity {
  constructor(x, y, type = 'shield') {
    super(x, y);
    this.kind = 'pickup';
    this.radius = 12;
    this.type = type;
    this.lifetime = 15;
    this.pulse = 0;

    // === КОМПОЗИЦІЯ ===
    // Додаємо поведінку pickup як поле.
    // Тепер Pickup не "extends" якийсь PickupBase — він має поведінку.
    this.pickupBehavior = createPickup(type);
    // === КІНЕЦЬ ===
  }

  update(dt) {
    this.pulse += dt * 4;
    this.lifetime -= dt;
    if (this.lifetime <= 0) {
      this.kill();
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);

    const scale = 1 + Math.sin(this.pulse) * 0.1;
    ctx.scale(scale, scale);

    const color = this.type === 'shield' ? '#4f4' : '#ff4';

    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    if (this.type === 'shield') {
      ctx.arc(0, 0, this.radius * 0.5, 0, Math.PI * 2);
    } else {
      ctx.moveTo(-4, -4);
      ctx.lineTo(4, 0);
      ctx.lineTo(-4, 4);
    }
    ctx.fillStyle = color;
    ctx.fill();

    ctx.restore();
  }
}