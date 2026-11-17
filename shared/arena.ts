import { Vector2, type Vector2Data } from './vector.js';

/** Mutates a position to wrap once across each arena boundary. */
export function wrapAround(pos: Vector2 | { x: number; y: number }, width: number, height: number): void {
  let x = pos.x;
  let y = pos.y;
  if (x < 0) x += width;
  if (x > width) x -= width;
  if (y < 0) y += height;
  if (y > height) y -= height;
  if (pos instanceof Vector2) pos.set(x, y);
  else {
    pos.x = x;
    pos.y = y;
  }
}

export type ArenaPosition = Vector2;
export type ReadonlyArenaPosition = Vector2Data;
