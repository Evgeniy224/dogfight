import { Entity, type EntityInput } from './entity.js';

export type PickupType = 'shield' | 'rapid_fire';
export interface PickupTarget { shield: number; rapidFire: number }

export class Pickup extends Entity {
  readonly kind = 'pickup';
  readonly type: PickupType;
  readonly pickupBehavior: { apply(target: PickupTarget): void };
  lifetime = 15;
  pulse = 0;

  constructor(x: number, y: number, type: PickupType = 'shield') {
    super(x, y);
    this.radius = 12;
    this.type = type;
    this.pickupBehavior = { apply: (target) => this.apply(target) };
  }

  apply(target: PickupTarget): void {
    switch (this.type) {
      case 'shield':
        target.shield = 5;
        return;
      case 'rapid_fire':
        target.rapidFire = 5;
        return;
      default: {
        const exhaustiveCheck: never = this.type;
        return exhaustiveCheck;
      }
    }
  }

  override update(dt: number, _input?: EntityInput | null, _viewWidth?: number, _viewHeight?: number): void {
    this.pulse += dt * 4;
    this.lifetime -= dt;
    if (this.lifetime <= 0) this.kill();
  }

  override draw(ctx: CanvasRenderingContext2D): void {
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
    if (this.type === 'shield') ctx.arc(0, 0, this.radius * 0.5, 0, Math.PI * 2);
    else {
      ctx.moveTo(-4, -4);
      ctx.lineTo(4, 0);
      ctx.lineTo(-4, 4);
    }
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }
}
