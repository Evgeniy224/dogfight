import type { World } from './sim/world.js';

export interface InputState {
  isDown(code: string): boolean;
  justPressed(code: string): boolean;
  endFrame(): void;
}

export function requireCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create 2D canvas context');
  return context;
}

export interface AssetManifest {
  images?: Record<string, string>;
  sounds?: Record<string, string>;
}

export interface LoadedAssets {
  images: Record<string, HTMLImageElement>;
  sounds: Record<string, ArrayBuffer>;
}

export interface ProgressCallback {
  (loaded: number, total: number): void;
}

export interface LoopStats {
  stepsPerSecond: number;
  framesPerSecond: number;
  frameTime: number;
}

export interface GameLoop {
  start(): void;
  stop(): void;
  getStats(): LoopStats;
}

export interface PreviousShipState {
  x: number;
  y: number;
  angle: number;
  thrust: boolean;
}

export interface DrawableShip {
  x: number;
  y: number;
  angle: number;
  thrust: boolean;
}

export type PickupType = 'shield' | 'rapid_fire';

export function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: #${id}`);
  return element;
}

export function requireCanvas(id: string): HTMLCanvasElement {
  const element = requireElement(id);
  if (!(element instanceof HTMLCanvasElement)) {
    throw new Error(`Expected #${id} to be a canvas`);
  }
  return element;
}

export function requireInput(id: string): HTMLInputElement {
  const element = requireElement(id);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Expected #${id} to be an input`);
  }
  return element;
}

export interface HomingBehavior {
  turnRate: number;
  update(self: import('./sim/entity.js').Entity, target: import('./sim/entity.js').Entity, dt: number): void;
}

export interface PickupBehavior {
  type: PickupType;
  apply(target: import('./sim/ship.js').Ship): void;
}

declare global {
  interface Window {
    ws?: WebSocket;
    webkitAudioContext?: typeof AudioContext;
    loop?: GameLoop;
    world?: World;
    roomName?: string;
  }
}
