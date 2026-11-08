import { PRNG } from './rng.js';

export const PROTOCOL_VERSION = 2;
export const MESSAGE_INPUT = 1;
export const MESSAGE_SNAPSHOT = 2;
export const FIXED_DT = 1 / 30;

const INPUT_BYTES = 12;
const SNAPSHOT_HEADER_BYTES = 12;
const ENTITY_BYTES = 44;
const MAX_ASTEROIDS = 12;
const MAX_PICKUPS = 2;
const RESPAWN_INTERVAL = 5;
const KIND_CODES = { ship: 1, bullet: 2, asteroid: 3, pickup: 4 };
const CODE_KINDS = { 1: 'ship', 2: 'bullet', 3: 'asteroid', 4: 'pickup' };
const ASTEROID_SIZES = [
  { radius: 40, hp: 100, score: 10 },
  { radius: 25, hp: 60, score: 20 },
  { radius: 15, hp: 30, score: 30 },
];

export function createMatch(width, height, seed = 12345) {
  const match = {
    width,
    height,
    seed: seed >>> 0,
    tick: 0,
    nextEntityId: 1,
    ships: new Map(),
    asteroids: [],
    pickups: [],
    bullets: [],
    asteroidSpawnTimer: 0,
    pickupSpawnTimer: 0,
    nextPickupType: 'shield',
    rng: null,
  };
  const rng = new PRNG(match.seed);
  match.rng = rng;

  for (let index = 0; index < MAX_ASTEROIDS; index += 1) match.asteroids.push(spawnAsteroid(match, false));
  match.pickups.push(createPickup(match, width * 0.3, height * 0.3, 'shield'));
  match.pickups.push(createPickup(match, width * 0.7, height * 0.7, 'rapid_fire'));
  return match;
}

function spawnAsteroid(match, avoidShips = true) {
  const { rng, width, height } = match;
  let x = width / 2;
  let y = height / 2;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    x = rng.range(0, width);
    y = rng.range(0, height);
    const awayFromCenter = Math.hypot(x - width / 2, y - height / 2) >= 200;
    const awayFromShips = !avoidShips || [...match.ships.values()].every((ship) => (
      !ship.alive || Math.hypot(x - ship.x, y - ship.y) >= 200
    ));
    if (awayFromCenter && awayFromShips) break;
  }
  const vx = rng.range(-50, 50);
  const vy = rng.range(-50, 50);
  const sizeIndex = Math.floor(rng.range(0, ASTEROID_SIZES.length));
  const size = ASTEROID_SIZES[sizeIndex];
  return {
    id: match.nextEntityId++,
    kind: 'asteroid',
    ownerId: 0,
    inputSeq: 0,
    x,
    y,
    vx,
    vy,
    angle: 0,
    angularVel: (rng.random() - 0.2) * 0.1,
    hp: size.hp,
    radius: size.radius,
    scoreValue: size.score,
    sizeIndex,
    alive: true,
  };
}

function createPickup(match, x, y, type) {
  return {
    id: match.nextEntityId++,
    kind: 'pickup',
    ownerId: 0,
    inputSeq: 0,
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    hp: 0,
    radius: 12,
    ttl: 15,
    type,
    alive: true,
  };
}

function spawnPickup(match, type) {
  const { rng, width, height } = match;
  let x = width / 2;
  let y = height / 2;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    x = rng.range(60, width - 60);
    y = rng.range(60, height - 60);
    if ([...match.ships.values()].every((ship) => (
      !ship.alive || Math.hypot(x - ship.x, y - ship.y) >= 100
    ))) break;
  }
  match.pickups.push(createPickup(match, x, y, type));
}

export function addPlayer(match, playerId) {
  const slot = match.ships.size;
  const ship = {
    id: match.nextEntityId++,
    kind: 'ship',
    ownerId: playerId,
    inputSeq: 0,
    x: match.width * (slot % 2 === 0 ? 0.25 : 0.75),
    y: match.height * (slot < 2 ? 0.5 : 0.25 + 0.5 * (slot % 2)),
    vx: 0,
    vy: 0,
    angle: slot % 2 === 0 ? 0 : Math.PI,
    hp: 100,
    radius: 15,
    cooldown: 0,
    shield: 0,
    rapidFire: 0,
    score: 0,
    respawnTimer: 0,
    alive: true,
    thrust: false,
  };
  ship.spawnX = ship.x;
  ship.spawnY = ship.y;
  ship.spawnAngle = ship.angle;
  match.ships.set(playerId, ship);
  return ship;
}

export function integrateShip(ship, input, dt = FIXED_DT, width, height) {
  const next = { ...ship };
  next.angle += (input.turn || 0) * 4 * dt;
  next.angle = ((next.angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  next.thrust = Boolean(input.thrust);
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
  if (Number.isFinite(width) && width > 0) next.x = (next.x + width) % width;
  if (Number.isFinite(height) && height > 0) next.y = (next.y + height) % height;
  next.cooldown = Math.max(0, next.cooldown - dt);
  next.shield = Math.max(0, (next.shield || 0) - dt);
  next.rapidFire = Math.max(0, (next.rapidFire || 0) - dt);
  return next;
}

export function createBullet(ship, id, inputSeq) {
  return {
    id,
    kind: 'bullet',
    ownerId: ship.ownerId,
    inputSeq,
    x: ship.x + Math.cos(ship.angle) * ship.radius,
    y: ship.y + Math.sin(ship.angle) * ship.radius,
    vx: ship.vx + Math.cos(ship.angle) * 600,
    vy: ship.vy + Math.sin(ship.angle) * 600,
    angle: ship.angle,
    hp: 0,
    radius: 3,
    ttl: 2,
    alive: true,
  };
}

export function stepMatch(match, inputs, dt = FIXED_DT) {
  match.tick += 1;
  const newBullets = [];

  for (const [playerId, ship] of match.ships) {
    if (!ship.alive) {
      ship.respawnTimer += dt;
      if (ship.respawnTimer >= 2) {
        ship.alive = true;
        ship.hp = 100;
        ship.x = ship.spawnX;
        ship.y = ship.spawnY;
        ship.vx = 0;
        ship.vy = 0;
        ship.angle = ship.spawnAngle;
        ship.cooldown = 0;
        ship.respawnTimer = 0;
      }
      continue;
    }
    const command = inputs.get(playerId) || { turn: 0, thrust: false, fire: false, seq: 0 };
    const moved = integrateShip(ship, command, dt, match.width, match.height);
    Object.assign(ship, moved);
    if (command.fire && ship.cooldown <= 0) {
      ship.cooldown = ship.rapidFire > 0 ? 0.05 : 0.2;
      newBullets.push(createBullet(ship, match.nextEntityId++, command.seq));
    }
  }

  for (const asteroid of match.asteroids) {
    if (!asteroid.alive) continue;
    asteroid.x += asteroid.vx * dt;
    asteroid.y += asteroid.vy * dt;
    asteroid.angle = wrapAngle(asteroid.angle + asteroid.angularVel * dt);
    if (asteroid.x - asteroid.radius < 0) {
      asteroid.x = asteroid.radius;
      asteroid.vx = Math.abs(asteroid.vx);
    }
    if (asteroid.x + asteroid.radius > match.width) {
      asteroid.x = match.width - asteroid.radius;
      asteroid.vx = -Math.abs(asteroid.vx);
    }
    if (asteroid.y - asteroid.radius < 0) {
      asteroid.y = asteroid.radius;
      asteroid.vy = Math.abs(asteroid.vy);
    }
    if (asteroid.y + asteroid.radius > match.height) {
      asteroid.y = match.height - asteroid.radius;
      asteroid.vy = -Math.abs(asteroid.vy);
    }
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
    if (!bullet.alive) continue;
  }

  for (const ship of match.ships.values()) {
    if (!ship.alive) continue;
    for (const pickup of match.pickups) {
      if (!pickup.alive) continue;
      if (Math.hypot(ship.x - pickup.x, ship.y - pickup.y) <= ship.radius + pickup.radius) {
        if (pickup.type === 'shield') ship.shield = 5;
        else ship.rapidFire = 5;
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
    if (!ship.alive) {
      ship.respawnTimer = 0;
    }
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
  } else {
    match.asteroidSpawnTimer = 0;
  }
  if (match.pickups.length < MAX_PICKUPS) {
    match.pickupSpawnTimer += dt;
    if (match.pickupSpawnTimer >= RESPAWN_INTERVAL) {
      spawnPickup(match, match.nextPickupType);
      match.nextPickupType = match.nextPickupType === 'shield' ? 'rapid_fire' : 'shield';
      match.pickupSpawnTimer = 0;
    }
  } else {
    match.pickupSpawnTimer = 0;
  }
  match.bullets = match.bullets.filter((bullet) => bullet.alive);
}

export function snapshotEntities(match) {
  return [
    ...match.ships.values(),
    ...match.asteroids,
    ...match.pickups,
    ...match.bullets,
  ].map(({ id, kind, ownerId, inputSeq = 0, x, y, vx, vy, angle, hp, radius, alive, thrust, cooldown = 0, shield = 0, rapidFire = 0, score = 0, type }) => ({
    id, kind, ownerId, inputSeq, x, y, vx, vy, angle, hp, radius, alive, thrust: Boolean(thrust), cooldown, shield, rapidFire, score, type,
  }));
}

export function encodeInput(input) {
  const buffer = new ArrayBuffer(INPUT_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, MESSAGE_INPUT);
  view.setUint8(1, PROTOCOL_VERSION);
  view.setUint32(2, input.seq >>> 0, true);
  view.setUint32(6, input.tick >>> 0, true);
  const flags = (input.thrust ? 1 : 0) | (input.fire ? 2 : 0);
  view.setUint8(10, flags);
  view.setInt8(11, Math.max(-1, Math.min(1, Math.trunc(input.turn || 0))));
  return buffer;
}

export function decodeInput(data) {
  const view = asDataView(data);
  if (view.byteLength !== INPUT_BYTES || view.getUint8(0) !== MESSAGE_INPUT || view.getUint8(1) !== PROTOCOL_VERSION) {
    throw new Error('Invalid input packet');
  }
  const flags = view.getUint8(10);
  return {
    seq: view.getUint32(2, true),
    tick: view.getUint32(6, true),
    thrust: Boolean(flags & 1),
    fire: Boolean(flags & 2),
    turn: view.getInt8(11),
  };
}

export function encodeSnapshot(snapshot) {
  const entities = snapshot.entities || [];
  const buffer = new ArrayBuffer(SNAPSHOT_HEADER_BYTES + entities.length * ENTITY_BYTES);
  const view = new DataView(buffer);
  view.setUint8(0, MESSAGE_SNAPSHOT);
  view.setUint8(1, PROTOCOL_VERSION);
  view.setUint32(2, snapshot.tick >>> 0, true);
  view.setUint32(6, snapshot.ack >>> 0, true);
  view.setUint16(10, entities.length, true);
  let offset = SNAPSHOT_HEADER_BYTES;
  for (const entity of entities) {
    const kind = KIND_CODES[entity.kind];
    if (!kind) throw new Error(`Unsupported entity kind: ${entity.kind}`);
    view.setUint16(offset, entity.id, true); offset += 2;
    view.setUint8(offset++, kind);
    view.setUint16(offset, entity.ownerId, true); offset += 2;
    view.setUint32(offset, entity.inputSeq >>> 0, true); offset += 4;
    view.setFloat32(offset, entity.x, true); offset += 4;
    view.setFloat32(offset, entity.y, true); offset += 4;
    view.setFloat32(offset, entity.vx, true); offset += 4;
    view.setFloat32(offset, entity.vy, true); offset += 4;
    view.setInt16(offset, Math.round(entity.angle * 1000), true); offset += 2;
    view.setUint8(offset++, Math.max(0, Math.min(100, entity.hp || 0)));
    view.setUint8(offset++, Math.max(0, Math.min(255, entity.radius || 0)));
    view.setFloat32(offset, entity.cooldown || 0, true); offset += 4;
    view.setFloat32(offset, entity.shield || 0, true); offset += 4;
    view.setFloat32(offset, entity.rapidFire || 0, true); offset += 4;
    view.setUint16(offset, Math.max(0, Math.min(65535, entity.score || 0)), true); offset += 2;
    view.setUint8(offset++, (entity.alive === false ? 0 : 1) | (entity.thrust ? 2 : 0) | (entity.type === 'rapid_fire' ? 4 : 0));
  }
  return buffer;
}

export function decodeSnapshot(data) {
  const view = asDataView(data);
  if (view.byteLength < SNAPSHOT_HEADER_BYTES || view.getUint8(0) !== MESSAGE_SNAPSHOT || view.getUint8(1) !== PROTOCOL_VERSION) {
    throw new Error('Invalid snapshot packet');
  }
  const count = view.getUint16(10, true);
  if (view.byteLength !== SNAPSHOT_HEADER_BYTES + count * ENTITY_BYTES) throw new Error('Invalid snapshot length');
  const entities = [];
  let offset = SNAPSHOT_HEADER_BYTES;
  for (let index = 0; index < count; index += 1) {
    const id = view.getUint16(offset, true); offset += 2;
    const kind = CODE_KINDS[view.getUint8(offset++)];
    if (!kind) throw new Error('Unknown entity kind');
    const ownerId = view.getUint16(offset, true); offset += 2;
    const inputSeq = view.getUint32(offset, true); offset += 4;
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
    entities.push({
      id, kind, ownerId, inputSeq, x, y, vx, vy, angle, hp, radius, cooldown, shield, rapidFire, score,
      alive: Boolean(flags & 1),
      thrust: Boolean(flags & 2),
      type: kind === 'pickup' ? (flags & 4 ? 'rapid_fire' : 'shield') : undefined,
    });
  }
  return {
    tick: view.getUint32(2, true),
    ack: view.getUint32(6, true),
    entities,
  };
}

function asDataView(data) {
  if (data instanceof DataView) return data;
  if (data instanceof ArrayBuffer) return new DataView(data);
  if (ArrayBuffer.isView(data)) return new DataView(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError('Expected an ArrayBuffer or view');
}

function wrapAngle(angle) {
  return ((angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}