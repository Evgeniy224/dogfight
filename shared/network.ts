import { z } from 'zod';
import { PRNG } from './rng.js';

declare const entityIdBrand: unique symbol;
declare const tickBrand: unique symbol;
declare const sequenceBrand: unique symbol;
declare const playerIdBrand: unique symbol;

export type EntityId = number & { readonly [entityIdBrand]: true };
export type Tick = number & { readonly [tickBrand]: true };
export type Sequence = number & { readonly [sequenceBrand]: true };
export type PlayerId = number & { readonly [playerIdBrand]: true };

function checkedInteger(value: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new RangeError(`Invalid ${label}`);
  return value;
}

export function entityId(value: number): EntityId {
  if (value < 1) throw new RangeError('Invalid entity id');
  return checkedInteger(value, 0xffff, 'entity id') as EntityId; // validated uint16 protocol ID
}
export function tick(value: number): Tick {
  return checkedInteger(value, 0xffffffff, 'tick') as Tick; // validated uint32 brand
}
export function sequence(value: number): Sequence {
  return checkedInteger(value, 0xffffffff, 'sequence') as Sequence; // validated uint32 brand
}
export function playerId(value: number): PlayerId {
  return checkedInteger(value, 0xffff, 'player id') as PlayerId; // validated uint16 brand
}

export const PROTOCOL_VERSION = 2;
export const MESSAGE_INPUT = 1;
export const MESSAGE_SNAPSHOT = 2;
export const FIXED_DT = 1 / 30;

export type PickupType = 'shield' | 'rapid_fire';
export type EntityKind = 'ship' | 'bullet' | 'asteroid' | 'pickup';

export interface InputCommand {
  readonly seq: Sequence;
  readonly tick?: Tick;
  readonly thrust: boolean;
  readonly turn: -1 | 0 | 1;
  readonly fire: boolean;
}

export interface InputPayload {
  readonly seq: number;
  readonly tick?: number;
  readonly thrust: boolean;
  readonly turn: -1 | 0 | 1;
  readonly fire: boolean;
}

interface EntityStateBase {
  id: EntityId;
  ownerId: PlayerId;
  inputSeq: Sequence;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  radius: number;
  alive: boolean;
}

export interface ShipState extends EntityStateBase {
  kind: 'ship';
  cooldown: number;
  shield: number;
  rapidFire: number;
  score: number;
  respawnTimer: number;
  spawnX: number;
  spawnY: number;
  spawnAngle: number;
  thrust: boolean;
}

export interface BulletState extends EntityStateBase {
  kind: 'bullet';
  ttl: number;
  local?: boolean;
}

export interface AsteroidState extends EntityStateBase {
  kind: 'asteroid';
  angularVel: number;
  scoreValue: number;
  sizeIndex: number;
}

export interface PickupState extends EntityStateBase {
  kind: 'pickup';
  ttl: number;
  type: PickupType;
}

export type MatchEntity = ShipState | BulletState | AsteroidState | PickupState;

export interface Match {
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  tick: Tick;
  nextEntityId: number;
  ships: Map<PlayerId, ShipState>;
  asteroids: AsteroidState[];
  pickups: PickupState[];
  bullets: BulletState[];
  asteroidSpawnTimer: number;
  pickupSpawnTimer: number;
  nextPickupType: PickupType;
  rng: PRNG;
}

interface SnapshotBase {
  readonly id: EntityId;
  readonly ownerId: PlayerId;
  readonly inputSeq: Sequence;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly angle: number;
  readonly hp: number;
  readonly radius: number;
  readonly cooldown: number;
  readonly shield: number;
  readonly rapidFire: number;
  readonly score: number;
  readonly alive: boolean;
  readonly thrust: boolean;
}

export interface ShipSnapshot extends SnapshotBase { readonly kind: 'ship' }
export interface BulletSnapshot extends SnapshotBase { readonly kind: 'bullet' }
export interface AsteroidSnapshot extends SnapshotBase { readonly kind: 'asteroid' }
export interface PickupSnapshot extends SnapshotBase { readonly kind: 'pickup'; readonly type: PickupType }
export type EntitySnapshot = ShipSnapshot | BulletSnapshot | AsteroidSnapshot | PickupSnapshot;

export interface Snapshot {
  readonly tick: Tick;
  readonly ack: Sequence;
  readonly entities: readonly EntitySnapshot[];
}

const NetworkSchema = z.object({
  latency: z.number().finite().transform((value) => Math.max(0, Math.min(500, value))),
  jitter: z.number().finite().transform((value) => Math.max(0, Math.min(200, value))),
  drop: z.number().finite().transform((value) => Math.max(0, Math.min(0.2, value))),
}).strict();

const JoinMessageSchema = z.object({
  type: z.literal('join'),
  roomId: z.string().regex(/^[a-z0-9_-]{1,24}$/i),
  playerName: z.string().min(1).max(24),
  codec: z.enum(['json', 'binary']),
  network: NetworkSchema,
}).strict();
const ChatMessageSchema = z.object({
  type: z.literal('chat'),
  text: z.string().min(1).max(500),
}).strict();
export const ClientInputMessageSchema = z.object({
  type: z.literal('input'),
  seq: z.number().int().min(0).max(0xffffffff),
  tick: z.number().int().min(0).max(0xffffffff).optional(),
  thrust: z.boolean(),
  turn: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  fire: z.boolean(),
}).strict();
export type ClientInputMessageData = z.infer<typeof ClientInputMessageSchema>;
export type ClientInputMessage = Omit<ClientInputMessageData, 'seq' | 'tick'> & {
  seq: Sequence;
  tick?: Tick;
};
const PingMessageSchema = z.object({
  type: z.literal('ping'),
  sentAt: z.number().finite().min(0),
}).strict();

export const ClientMessageSchema = z.discriminatedUnion('type', [
  JoinMessageSchema,
  ChatMessageSchema,
  ClientInputMessageSchema,
  PingMessageSchema,
]);

export type ClientMessage =
  | z.infer<typeof JoinMessageSchema>
  | z.infer<typeof ChatMessageSchema>
  | ClientInputMessage
  | z.infer<typeof PingMessageSchema>;

export type ClientMessageResult = z.SafeParseReturnType<unknown, ClientMessage>;

export function parseClientMessage(value: unknown): z.SafeParseReturnType<unknown, ClientMessage> {
  try {
    const result = ClientMessageSchema.safeParse(value);
    if (!result.success) return result;
    const parsed = result.data;
    switch (parsed.type) {
      case 'join':
      case 'chat':
      case 'ping':
        return { success: true, data: parsed };
      case 'input': {
        const { seq: rawSeq, tick: rawTick, ...rest } = parsed;
        return {
          success: true,
          data: {
            ...rest,
            seq: sequence(rawSeq),
            ...(rawTick === undefined ? {} : { tick: tick(rawTick) }),
          },
        };
      }
      default: {
        const exhaustiveCheck: never = parsed;
        return {
          success: false,
          error: new z.ZodError([{
            code: z.ZodIssueCode.custom,
            path: [],
            message: `Unsupported client message: ${String(exhaustiveCheck)}`,
          }]),
        };
      }
    }
  } catch (error: unknown) {
    return {
      success: false,
      error: new z.ZodError([{
        code: z.ZodIssueCode.custom,
        path: [],
        message: error instanceof Error ? 'Invalid client message' : 'Invalid client message value',
      }]),
    };
  }
}

const serverSnapshotBaseSchema = z.object({
  id: z.number().int().min(1).max(0xffff),
  ownerId: z.number().int().min(0).max(0xffff),
  inputSeq: z.number().int().min(0).max(0xffffffff),
  x: z.number().finite(),
  y: z.number().finite(),
  vx: z.number().finite(),
  vy: z.number().finite(),
  angle: z.number().finite(),
  hp: z.number().int().min(0).max(100),
  radius: z.number().int().min(0).max(255),
  cooldown: z.number().finite().min(0),
  shield: z.number().finite().min(0),
  rapidFire: z.number().finite().min(0),
  score: z.number().int().min(0).max(0xffff),
  alive: z.boolean(),
  thrust: z.boolean(),
});

export const ServerShipSnapshotSchema = serverSnapshotBaseSchema.extend({
  kind: z.literal('ship'),
}).strict();
export const ServerBulletSnapshotSchema = serverSnapshotBaseSchema.extend({
  kind: z.literal('bullet'),
}).strict();
export const ServerAsteroidSnapshotSchema = serverSnapshotBaseSchema.extend({
  kind: z.literal('asteroid'),
}).strict();
export const ServerPickupSnapshotSchema = serverSnapshotBaseSchema.extend({
  kind: z.literal('pickup'),
  type: z.enum(['shield', 'rapid_fire']),
}).strict();
export const ServerEntitySnapshotSchema = z.discriminatedUnion('kind', [
  ServerShipSnapshotSchema,
  ServerBulletSnapshotSchema,
  ServerAsteroidSnapshotSchema,
  ServerPickupSnapshotSchema,
]);

export const ServerJoinedMessageSchema = z.object({
  type: z.literal('joined'),
  roomId: z.string().min(1).max(32),
  playerId: z.number().int().min(1).max(0xffff),
  seed: z.number().int().min(0).max(0xffffffff),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  tickRate: z.number().finite().positive(),
  codec: z.enum(['json', 'binary']),
}).strict();
export const ServerChatMessageSchema = z.object({
  type: z.literal('chat'),
  playerName: z.string().min(1).max(24),
  text: z.string().min(1).max(500),
}).strict();
export const ServerSnapshotMessageSchema = z.object({
  type: z.literal('snapshot'),
  tick: z.number().int().min(0).max(0xffffffff),
  ack: z.number().int().min(0).max(0xffffffff),
  entities: z.array(ServerEntitySnapshotSchema).max(0xffff),
}).strict();
export const ServerPongMessageSchema = z.object({
  type: z.literal('pong'),
  sentAt: z.number().finite().min(0),
}).strict();

export const ServerMessageSchema = z.discriminatedUnion('type', [
  ServerJoinedMessageSchema,
  ServerChatMessageSchema,
  ServerSnapshotMessageSchema,
  ServerPongMessageSchema,
]);

export type ServerJoinedMessage = z.infer<typeof ServerJoinedMessageSchema>;
export type ServerChatMessage = z.infer<typeof ServerChatMessageSchema>;
export type ServerSnapshotMessage = z.infer<typeof ServerSnapshotMessageSchema>;
export type ServerPongMessage = z.infer<typeof ServerPongMessageSchema>;
export type ServerEntitySnapshot = z.infer<typeof ServerEntitySnapshotSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

const MAX_ASTEROIDS = 12;
const MAX_PICKUPS = 2;
const RESPAWN_INTERVAL = 5;
const INPUT_BYTES = 12;
const SNAPSHOT_HEADER_BYTES = 12;
const ENTITY_BYTES = 44;
const KIND_CODES: Readonly<Record<EntityKind, number>> = { ship: 1, bullet: 2, asteroid: 3, pickup: 4 };
const ASTEROID_SIZES: readonly { readonly radius: number; readonly hp: number; readonly score: number }[] = [
  { radius: 40, hp: 100, score: 10 },
  { radius: 25, hp: 60, score: 20 },
  { radius: 15, hp: 30, score: 30 },
];

export function createMatch(width: number, height: number, seed = 12345): Match {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new RangeError('Match dimensions must be positive finite numbers');
  }
  const normalizedSeed = seed >>> 0;
  const match: Match = {
    width, height, seed: normalizedSeed, tick: tick(0), nextEntityId: 1,
    ships: new Map(), asteroids: [], pickups: [], bullets: [],
    asteroidSpawnTimer: 0, pickupSpawnTimer: 0, nextPickupType: 'shield',
    rng: new PRNG(normalizedSeed),
  };
  for (let index = 0; index < MAX_ASTEROIDS; index += 1) match.asteroids.push(spawnAsteroid(match, false));
  match.pickups.push(createPickup(match, width * 0.3, height * 0.3, 'shield'));
  match.pickups.push(createPickup(match, width * 0.7, height * 0.7, 'rapid_fire'));
  return match;
}

function nextId(match: Match): EntityId {
  const id = entityId(match.nextEntityId);
  match.nextEntityId += 1;
  return id;
}

function spawnAsteroid(match: Match, avoidShips = true): AsteroidState {
  let x = match.width / 2;
  let y = match.height / 2;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    x = match.rng.range(0, match.width);
    y = match.rng.range(0, match.height);
    const awayFromCenter = Math.hypot(x - match.width / 2, y - match.height / 2) >= 200;
    const awayFromShips = !avoidShips || [...match.ships.values()].every((ship) =>
      !ship.alive || Math.hypot(x - ship.x, y - ship.y) >= 200);
    if (awayFromCenter && awayFromShips) break;
  }
  const vx = match.rng.range(-50, 50);
  const vy = match.rng.range(-50, 50);
  const sizeIndex = Math.floor(match.rng.range(0, ASTEROID_SIZES.length));
  const size = ASTEROID_SIZES[sizeIndex];
  if (!size) throw new Error('Random asteroid size was out of range');
  return {
    id: nextId(match), kind: 'asteroid', ownerId: playerId(0), inputSeq: sequence(0),
    x, y, vx, vy, angle: 0, angularVel: (match.rng.random() - 0.2) * 0.1,
    hp: size.hp, radius: size.radius, scoreValue: size.score, sizeIndex, alive: true,
  };
}

function createPickup(match: Match, x: number, y: number, type: PickupType): PickupState {
  return {
    id: nextId(match), kind: 'pickup', ownerId: playerId(0), inputSeq: sequence(0),
    x, y, vx: 0, vy: 0, angle: 0, hp: 0, radius: 12, ttl: 15, type, alive: true,
  };
}

function spawnPickup(match: Match, type: PickupType): void {
  let x = match.width / 2;
  let y = match.height / 2;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    x = match.rng.range(60, match.width - 60);
    y = match.rng.range(60, match.height - 60);
    if ([...match.ships.values()].every((ship) =>
      !ship.alive || Math.hypot(x - ship.x, y - ship.y) >= 100)) break;
  }
  match.pickups.push(createPickup(match, x, y, type));
}

export function addPlayer(match: Match, id: PlayerId): ShipState {
  const slot = match.ships.size;
  const x = match.width * (slot % 2 === 0 ? 0.25 : 0.75);
  const y = match.height * (slot < 2 ? 0.5 : 0.25 + 0.5 * (slot % 2));
  const angle = slot % 2 === 0 ? 0 : Math.PI;
  const ship: ShipState = {
    id: nextId(match), kind: 'ship', ownerId: id, inputSeq: sequence(0),
    x, y, vx: 0, vy: 0, angle, hp: 100, radius: 15, cooldown: 0, shield: 0,
    rapidFire: 0, score: 0, respawnTimer: 0, spawnX: x, spawnY: y, spawnAngle: angle,
    alive: true, thrust: false,
  };
  match.ships.set(id, ship);
  return ship;
}

export interface ShipMotion {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  thrust: boolean;
  cooldown: number;
  shield: number;
  rapidFire: number;
}

export function integrateShip<T extends ShipMotion>(
  ship: T,
  input: Pick<InputCommand, 'turn' | 'thrust'>,
  dt = FIXED_DT,
  width?: number,
  height?: number,
): T {
  const next = { ...ship };
  next.angle += input.turn * 4 * dt;
  next.angle = wrapAngle(next.angle);
  next.thrust = input.thrust;
  if (next.thrust) {
    next.vx += Math.cos(next.angle) * 400 * dt;
    next.vy += Math.sin(next.angle) * 400 * dt;
  }
  const drag = Math.exp(-1.5 * dt);
  next.vx *= drag;
  next.vy *= drag;
  const speed = Math.hypot(next.vx, next.vy);
  if (speed > 500) {
    next.vx *= 500 / speed;
    next.vy *= 500 / speed;
  }
  next.x += next.vx * dt;
  next.y += next.vy * dt;
  if (width !== undefined && Number.isFinite(width) && width > 0) next.x = (next.x + width) % width;
  if (height !== undefined && Number.isFinite(height) && height > 0) next.y = (next.y + height) % height;
  next.cooldown = Math.max(0, next.cooldown - dt);
  next.shield = Math.max(0, next.shield - dt);
  next.rapidFire = Math.max(0, next.rapidFire - dt);
  return next;
}

export interface BulletSource {
  readonly ownerId: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly angle: number;
  readonly radius: number;
}

export function createBullet(ship: BulletSource, id: number, inputSeq: number): BulletState {
  return {
    id: entityId(id), kind: 'bullet', ownerId: playerId(ship.ownerId), inputSeq: sequence(inputSeq),
    x: ship.x + Math.cos(ship.angle) * ship.radius, y: ship.y + Math.sin(ship.angle) * ship.radius,
    vx: ship.vx + Math.cos(ship.angle) * 600, vy: ship.vy + Math.sin(ship.angle) * 600,
    angle: ship.angle, hp: 0, radius: 3, ttl: 2, alive: true,
  };
}

export function stepMatch(match: Match, inputs: ReadonlyMap<PlayerId, InputCommand>, dt = FIXED_DT): void {
  match.tick = tick(match.tick + 1);
  const newBullets: BulletState[] = [];
  for (const [ownerId, ship] of match.ships) {
    if (!ship.alive) {
      ship.respawnTimer += dt;
      if (ship.respawnTimer >= 2) {
        ship.alive = true; ship.hp = 100; ship.x = ship.spawnX; ship.y = ship.spawnY;
        ship.vx = 0; ship.vy = 0; ship.angle = ship.spawnAngle; ship.cooldown = 0; ship.respawnTimer = 0;
      }
      continue;
    }
    const command = inputs.get(ownerId) ?? { turn: 0, thrust: false, fire: false, seq: sequence(0) };
    Object.assign(ship, integrateShip(ship, command, dt, match.width, match.height));
    if (command.fire && ship.cooldown <= 0) {
      ship.cooldown = ship.rapidFire > 0 ? 0.05 : 0.2;
      newBullets.push(createBullet(ship, nextId(match), command.seq));
    }
  }
  for (const asteroid of match.asteroids) {
    if (!asteroid.alive) continue;
    asteroid.x += asteroid.vx * dt;
    asteroid.y += asteroid.vy * dt;
    asteroid.angle = wrapAngle(asteroid.angle + asteroid.angularVel * dt);
    if (asteroid.x - asteroid.radius < 0) { asteroid.x = asteroid.radius; asteroid.vx = Math.abs(asteroid.vx); }
    if (asteroid.x + asteroid.radius > match.width) { asteroid.x = match.width - asteroid.radius; asteroid.vx = -Math.abs(asteroid.vx); }
    if (asteroid.y - asteroid.radius < 0) { asteroid.y = asteroid.radius; asteroid.vy = Math.abs(asteroid.vy); }
    if (asteroid.y + asteroid.radius > match.height) { asteroid.y = match.height - asteroid.radius; asteroid.vy = -Math.abs(asteroid.vy); }
  }
  match.bullets.push(...newBullets);
  for (const bullet of match.bullets) {
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.ttl -= dt;
    if (bullet.x < 0 || bullet.x > match.width || bullet.y < 0 || bullet.y > match.height || bullet.ttl <= 0) {
      bullet.alive = false;
      continue;
    }
    for (const asteroid of match.asteroids) {
      if (!asteroid.alive) continue;
      if (Math.hypot(asteroid.x - bullet.x, asteroid.y - bullet.y) <= asteroid.radius + bullet.radius) {
        asteroid.hp = Math.max(0, asteroid.hp - 25);
        if (asteroid.hp === 0) {
          asteroid.alive = false;
          const owner = match.ships.get(bullet.ownerId);
          if (owner) owner.score = Math.min(65535, owner.score + asteroid.scoreValue);
        }
        bullet.alive = false;
        break;
      }
    }
  }
  for (const ship of match.ships.values()) {
    if (!ship.alive) continue;
    for (const pickup of match.pickups) {
      if (!pickup.alive) continue;
      if (Math.hypot(ship.x - pickup.x, ship.y - pickup.y) <= ship.radius + pickup.radius) {
        if (pickup.type === 'shield') ship.shield = 5;
        else if (pickup.type === 'rapid_fire') ship.rapidFire = 5;
        else {
          const exhaustiveCheck: never = pickup.type;
          return exhaustiveCheck;
        }
        pickup.alive = false;
        break;
      }
    }
    for (const asteroid of match.asteroids) {
      if (!asteroid.alive) continue;
      if (Math.hypot(ship.x - asteroid.x, ship.y - asteroid.y) <= ship.radius + asteroid.radius) {
        if (ship.shield <= 0) ship.hp = Math.max(0, ship.hp - 20);
        if (ship.hp === 0) ship.alive = false;
        asteroid.alive = false;
        break;
      }
    }
    if (!ship.alive) ship.respawnTimer = 0;
  }
  match.asteroids = match.asteroids.filter((asteroid) => asteroid.alive);
  for (const pickup of match.pickups) {
    pickup.ttl -= dt;
    if (pickup.ttl <= 0) pickup.alive = false;
  }
  match.pickups = match.pickups.filter((pickup) => pickup.alive);
  if (match.asteroids.length < MAX_ASTEROIDS) {
    match.asteroidSpawnTimer += dt;
    if (match.asteroidSpawnTimer >= RESPAWN_INTERVAL) {
      match.asteroids.push(spawnAsteroid(match));
      match.asteroidSpawnTimer = 0;
    }
  } else match.asteroidSpawnTimer = 0;
  if (match.pickups.length < MAX_PICKUPS) {
    match.pickupSpawnTimer += dt;
    if (match.pickupSpawnTimer >= RESPAWN_INTERVAL) {
      spawnPickup(match, match.nextPickupType);
      match.nextPickupType = match.nextPickupType === 'shield' ? 'rapid_fire' : 'shield';
      match.pickupSpawnTimer = 0;
    }
  } else match.pickupSpawnTimer = 0;
  match.bullets = match.bullets.filter((bullet) => bullet.alive);
}

export function snapshotEntities(match: Match): EntitySnapshot[] {
  const entities: MatchEntity[] = [...match.ships.values(), ...match.asteroids, ...match.pickups, ...match.bullets];
  return entities.map((entity) => {
    const base = {
      id: entity.id, ownerId: entity.ownerId, inputSeq: entity.inputSeq,
      x: entity.x, y: entity.y, vx: entity.vx, vy: entity.vy, angle: entity.angle,
      hp: entity.hp, radius: entity.radius, cooldown: entity.kind === 'ship' ? entity.cooldown : 0,
      shield: entity.kind === 'ship' ? entity.shield : 0,
      rapidFire: entity.kind === 'ship' ? entity.rapidFire : 0,
      score: entity.kind === 'ship' ? entity.score : 0,
      alive: entity.alive, thrust: entity.kind === 'ship' && entity.thrust,
    };
    switch (entity.kind) {
      case 'ship': return { ...base, kind: 'ship' };
      case 'bullet': return { ...base, kind: 'bullet' };
      case 'asteroid': return { ...base, kind: 'asteroid' };
      case 'pickup': return { ...base, kind: 'pickup', type: entity.type };
      default: {
        const exhaustiveCheck: never = entity;
        return exhaustiveCheck;
      }
    }
  });
}

export function encodeInput(input: InputPayload): ArrayBuffer {
  const buffer = new ArrayBuffer(INPUT_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, MESSAGE_INPUT);
  view.setUint8(1, PROTOCOL_VERSION);
  view.setUint32(2, checkedInteger(input.seq, 0xffffffff, 'sequence'), true);
  view.setUint32(6, checkedInteger(input.tick ?? 0, 0xffffffff, 'tick'), true);
  view.setUint8(10, (input.thrust ? 1 : 0) | (input.fire ? 2 : 0));
  if (input.turn !== -1 && input.turn !== 0 && input.turn !== 1) throw new RangeError('Invalid turn');
  view.setInt8(11, input.turn);
  return buffer;
}

export function decodeInput(data: unknown): InputCommand {
  const view = asDataView(data);
  if (view.byteLength !== INPUT_BYTES || view.getUint8(0) !== MESSAGE_INPUT || view.getUint8(1) !== PROTOCOL_VERSION) {
    throw new Error('Invalid input packet');
  }
  const flags = view.getUint8(10);
  const turn = view.getInt8(11);
  if ((flags & ~3) !== 0 || (turn !== -1 && turn !== 0 && turn !== 1)) throw new Error('Invalid input packet');
  return {
    seq: sequence(view.getUint32(2, true)),
    tick: tick(view.getUint32(6, true)),
    thrust: Boolean(flags & 1),
    fire: Boolean(flags & 2),
    turn,
  };
}

function kindCode(kind: EntityKind): number {
  switch (kind) {
    case 'ship': return KIND_CODES.ship;
    case 'bullet': return KIND_CODES.bullet;
    case 'asteroid': return KIND_CODES.asteroid;
    case 'pickup': return KIND_CODES.pickup;
    default: {
      const exhaustiveCheck: never = kind;
      return exhaustiveCheck;
    }
  }
}

function expectedRadius(entity: EntitySnapshot): number {
  switch (entity.kind) {
    case 'ship': return 15;
    case 'bullet': return 3;
    case 'asteroid': return entity.radius;
    case 'pickup': return 12;
    default: {
      const exhaustiveCheck: never = entity;
      return exhaustiveCheck;
    }
  }
}

export function encodeSnapshot(snapshot: Snapshot): ArrayBuffer {
  if (snapshot.entities.length > 0xffff) throw new RangeError('Too many entities');
  const buffer = new ArrayBuffer(SNAPSHOT_HEADER_BYTES + snapshot.entities.length * ENTITY_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, MESSAGE_SNAPSHOT);
  view.setUint8(1, PROTOCOL_VERSION);
  view.setUint32(2, checkedInteger(snapshot.tick, 0xffffffff, 'tick'), true);
  view.setUint32(6, checkedInteger(snapshot.ack, 0xffffffff, 'sequence'), true);
  view.setUint16(10, snapshot.entities.length, true);
  let offset = SNAPSHOT_HEADER_BYTES;
  for (const entity of snapshot.entities) {
    const code = kindCode(entity.kind);
    const radius = expectedRadius(entity);
    if (entity.kind === 'asteroid' && ![15, 25, 40].includes(radius)) throw new RangeError('Invalid asteroid radius');
    if (entity.radius !== radius || !Number.isInteger(entity.hp) || entity.hp < 0 || entity.hp > 100) {
      throw new RangeError('Invalid entity fields');
    }
    const numericFields = [entity.x, entity.y, entity.vx, entity.vy, entity.angle, entity.cooldown, entity.shield, entity.rapidFire];
    if (!numericFields.every((value) => Number.isFinite(value) && Math.abs(value) <= 3.402823466e38)
      || entity.cooldown < 0 || entity.shield < 0 || entity.rapidFire < 0) {
      throw new RangeError('Invalid entity fields');
    }
    const angle = Math.round(entity.angle * 1000);
    if (angle < -0x8000 || angle > 0x7fff) throw new RangeError('Invalid entity angle');
    view.setUint16(offset, checkedInteger(entity.id, 0xffff, 'entity id'), true); offset += 2;
    view.setUint8(offset++, code);
    view.setUint16(offset, checkedInteger(entity.ownerId, 0xffff, 'player id'), true); offset += 2;
    view.setUint32(offset, checkedInteger(entity.inputSeq, 0xffffffff, 'sequence'), true); offset += 4;
    view.setFloat32(offset, entity.x, true); offset += 4;
    view.setFloat32(offset, entity.y, true); offset += 4;
    view.setFloat32(offset, entity.vx, true); offset += 4;
    view.setFloat32(offset, entity.vy, true); offset += 4;
    view.setInt16(offset, angle, true); offset += 2;
    view.setUint8(offset++, entity.hp);
    view.setUint8(offset++, entity.radius);
    view.setFloat32(offset, entity.cooldown, true); offset += 4;
    view.setFloat32(offset, entity.shield, true); offset += 4;
    view.setFloat32(offset, entity.rapidFire, true); offset += 4;
    view.setUint16(offset, checkedInteger(entity.score, 0xffff, 'score'), true); offset += 2;
    const pickupFlag = entity.kind === 'pickup' && entity.type === 'rapid_fire' ? 4 : 0;
    view.setUint8(offset++, (entity.alive ? 1 : 0) | (entity.thrust ? 2 : 0) | pickupFlag);
  }
  return buffer;
}

export function decodeSnapshot(data: unknown): Snapshot {
  const view = asDataView(data);
  if (view.byteLength < SNAPSHOT_HEADER_BYTES || view.getUint8(0) !== MESSAGE_SNAPSHOT || view.getUint8(1) !== PROTOCOL_VERSION) {
    throw new Error('Invalid snapshot packet');
  }
  const count = view.getUint16(10, true);
  if (view.byteLength !== SNAPSHOT_HEADER_BYTES + count * ENTITY_BYTES) throw new Error('Invalid snapshot length');
  const entities: EntitySnapshot[] = [];
  let offset = SNAPSHOT_HEADER_BYTES;
  for (let index = 0; index < count; index += 1) {
    const id = entityId(view.getUint16(offset, true)); offset += 2;
    const code = view.getUint8(offset++);
    const kind = entityKindFromCode(code);
    const ownerId = playerId(view.getUint16(offset, true)); offset += 2;
    const inputSeq = sequence(view.getUint32(offset, true)); offset += 4;
    const x = view.getFloat32(offset, true); offset += 4;
    const y = view.getFloat32(offset, true); offset += 4;
    const vx = view.getFloat32(offset, true); offset += 4;
    const vy = view.getFloat32(offset, true); offset += 4;
    const angle = view.getInt16(offset, true) / 1000; offset += 2;
    const hp = view.getUint8(offset++);
    const radius = view.getUint8(offset++);
    const cooldown = view.getFloat32(offset, true); offset += 4;
    const shield = view.getFloat32(offset, true); offset += 4;
    const rapidFire = view.getFloat32(offset, true); offset += 4;
    const score = view.getUint16(offset, true); offset += 2;
    const flags = view.getUint8(offset++);
    if ((flags & ~7) !== 0 || ![x, y, vx, vy, cooldown, shield, rapidFire].every(Number.isFinite)
      || hp > 100 || cooldown < 0 || shield < 0 || rapidFire < 0) throw new Error('Invalid snapshot fields');
    const expected = kind === 'asteroid' ? [15, 25, 40].includes(radius) : radius === (kind === 'ship' ? 15 : kind === 'bullet' ? 3 : 12);
    if (!expected || ((flags & 2) !== 0 && kind !== 'ship') || ((flags & 4) !== 0 && kind !== 'pickup')) {
      throw new Error('Invalid snapshot fields');
    }
    const base = {
      id, ownerId, inputSeq, x, y, vx, vy, angle, hp, radius, cooldown, shield, rapidFire, score,
      alive: Boolean(flags & 1), thrust: Boolean(flags & 2),
    };
    switch (kind) {
      case 'ship': entities.push({ ...base, kind }); break;
      case 'bullet': entities.push({ ...base, kind }); break;
      case 'asteroid': entities.push({ ...base, kind }); break;
      case 'pickup': entities.push({ ...base, kind, type: flags & 4 ? 'rapid_fire' : 'shield' }); break;
      default: {
        const exhaustiveCheck: never = kind;
        throw new Error(`Unknown entity kind ${String(exhaustiveCheck)}`);
      }
    }
  }
  return { tick: tick(view.getUint32(2, true)), ack: sequence(view.getUint32(6, true)), entities };
}

function entityKindFromCode(code: number): EntityKind {
  switch (code) {
    case 1: return 'ship';
    case 2: return 'bullet';
    case 3: return 'asteroid';
    case 4: return 'pickup';
    default: throw new Error('Unknown entity kind');
  }
}

function asDataView(value: unknown): DataView {
  if (value instanceof DataView) return value;
  if (value instanceof ArrayBuffer) return new DataView(value);
  if (ArrayBuffer.isView(value)) return new DataView(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('Expected an ArrayBuffer or view');
}

function wrapAngle(angle: number): number {
  return ((angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}
