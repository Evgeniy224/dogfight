import { Entity, type EntityInput } from './entity.js';
import { Vector2 } from './vector.js';

export interface HomingBehavior {
  update(bullet: Bullet, target: Entity, dt: number): void;
}

export class Bullet extends Entity {
  static readonly TTL = 2;
  static readonly DAMAGE = 25;
  static readonly SPEED = 600;
  readonly kind = 'bullet';
  readonly damage = Bullet.DAMAGE;
  ownerId?: number;
  ttl = Bullet.TTL;
  homing: HomingBehavior | null = null;
  homingTarget: Entity | null = null;

  constructor(x: number, y: number, angle: number, inheritVel: { x: number; y: number } | null = null) {
    super(x, y);
    this.radius = 3;
    this.angle = angle;
    this.vel = new Vector2(
      Math.cos(angle) * Bullet.SPEED + (inheritVel?.x ?? 0),
      Math.sin(angle) * Bullet.SPEED + (inheritVel?.y ?? 0),
    );
  }

  override update(dt: number, _input?: EntityInput | null, _viewWidth?: number, _viewHeight?: number): void {
    super.update(dt);
    if (this.homing && this.homingTarget) this.homing.update(this, this.homingTarget, dt);
    this.ttl -= dt;
    if (this.ttl <= 0) this.kill();
  }

  override draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = this.homing ? '#f0f' : '#ff0';
    ctx.fillRect(-4, -2, 8, 4);
    ctx.restore();
  }
}
