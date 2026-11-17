import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addPlayer,
  createMatch,
  decodeInput,
  decodeSnapshot,
  encodeInput,
  encodeSnapshot,
  entityId,
  ClientInputMessageSchema,
  parseClientMessage,
  playerId,
  sequence,
  snapshotEntities,
  ServerMessageSchema,
  ServerSnapshotMessageSchema,
  stepMatch,
  tick,
  type AsteroidState,
  type InputCommand,
  type PickupSnapshot,
  type PickupState,
  type PlayerId,
} from './network.js';

function asteroid(id: number, x: number, y: number, hp: number, radius: number): AsteroidState {
  return {
    id: entityId(id), kind: 'asteroid', ownerId: playerId(0), inputSeq: sequence(0),
    x, y, vx: 0, vy: 0, angle: 0, angularVel: 0, hp, radius,
    scoreValue: radius === 15 ? 30 : radius === 25 ? 20 : 10,
    sizeIndex: radius === 15 ? 2 : radius === 25 ? 1 : 0, alive: true,
  };
}

function pickup(id: number, x: number, y: number, type: PickupState['type']): PickupState {
  return {
    id: entityId(id), kind: 'pickup', ownerId: playerId(0), inputSeq: sequence(0),
    x, y, vx: 0, vy: 0, angle: 0, hp: 0, radius: 12, ttl: 15, type, alive: true,
  };
}

function input(seq: number, fire = false, turn: -1 | 0 | 1 = 0, thrust = false): InputCommand {
  return { seq: sequence(seq), thrust, turn, fire };
}

const p1: PlayerId = playerId(1);
const p2: PlayerId = playerId(2);

test('input binary codec preserves sequence and controls', () => {
  const command: InputCommand = { seq: sequence(23), tick: tick(17), thrust: true, turn: -1, fire: true };
  assert.deepEqual(decodeInput(encodeInput(command)), command);
});

test('match creates the same seeded field of twelve asteroids', () => {
  const first = createMatch(1280, 720, 42);
  const second = createMatch(1280, 720, 42);
  assert.equal(first.asteroids.length, 12);
  assert.deepEqual(first.asteroids, second.asteroids);
  assert.ok(first.asteroids.every((item) => [15, 25, 40].includes(item.radius)));
});

test('match replenishes asteroids and pickups deterministically', () => {
  function runMatch() {
    const match = createMatch(1280, 720, 42);
    match.asteroids.pop();
    match.pickups.pop();
    for (let count = 1; count <= 151; count += 1) stepMatch(match, new Map());
    return snapshotEntities(match);
  }
  const first = runMatch();
  assert.equal(first.filter((entity) => entity.kind === 'asteroid').length, 12);
  assert.equal(first.filter((entity) => entity.kind === 'pickup').length, 2);
  assert.deepEqual(first, runMatch());
});

test('authoritative bullets damage asteroids', () => {
  const match = createMatch(1280, 720, 42);
  const ship = addPlayer(match, p1);
  ship.x = 100;
  ship.y = 360;
  ship.angle = 0;
  match.asteroids = [asteroid(100, 160, 360, 100, 40)];
  stepMatch(match, new Map([[p1, input(1, true)]]));
  assert.equal(match.asteroids[0]?.hp, 75);
  assert.equal(match.bullets.length, 0);
});

test('destroying an asteroid awards its score to the shooter', () => {
  const match = createMatch(1280, 720, 42);
  const ship = addPlayer(match, p1);
  ship.x = 100;
  ship.y = 360;
  ship.angle = 0;
  match.asteroids = [asteroid(100, 160, 360, 30, 15)];
  for (let count = 1; count <= 9; count += 1) stepMatch(match, new Map([[p1, input(count, true)]]));
  assert.equal(match.asteroids.length, 0);
  assert.equal(ship.score, 30);
});

test('collecting a shield pickup protects the ship from asteroid collision', () => {
  const match = createMatch(1280, 720, 42);
  const ship = addPlayer(match, p1);
  match.asteroids = [asteroid(100, ship.x + ship.radius + 1, ship.y, 100, 40)];
  match.pickups = [pickup(101, ship.x, ship.y, 'shield')];
  stepMatch(match, new Map());
  assert.equal(ship.hp, 100);
  assert.ok(ship.shield > 0);
});

test('players cooperate: bullets do not damage another ship', () => {
  const match = createMatch(1280, 720, 42);
  const shooter = addPlayer(match, p1);
  const partner = addPlayer(match, p2);
  shooter.x = 100;
  shooter.y = 360;
  shooter.angle = 0;
  partner.x = 160;
  partner.y = 360;
  match.asteroids = [];
  match.pickups = [];
  for (let count = 1; count <= 3; count += 1) {
    stepMatch(match, new Map([
      [p1, input(count, count === 1)],
      [p2, input(count)],
    ]));
  }
  assert.equal(partner.hp, 100);
});

test('snapshot codec preserves entity state within quantization precision', () => {
  const match = createMatch(1280, 720, 42);
  addPlayer(match, p1);
  stepMatch(match, new Map([[p1, { ...input(1, true, -1, true), tick: tick(1) }]]));
  const original = { tick: match.tick, ack: sequence(1), entities: snapshotEntities(match) };
  const decoded = decodeSnapshot(encodeSnapshot(original));
  assert.equal(decoded.tick, original.tick);
  assert.equal(decoded.ack, original.ack);
  assert.equal(decoded.entities.length, original.entities.length);
  assert.equal(decoded.entities[0]?.ownerId, original.entities[0]?.ownerId);
  assert.equal(decoded.entities[0]?.alive, true);
  assert.ok(Math.abs((decoded.entities[0]?.angle ?? 0) - (original.entities[0]?.angle ?? 0)) <= 0.001);
  assert.ok(Math.abs((decoded.entities[0]?.x ?? 0) - (original.entities[0]?.x ?? 0)) < 0.001);
  assert.equal(decoded.entities[0]?.thrust, true);
  const rapidPickup = decoded.entities.find(
    (entity): entity is PickupSnapshot => entity.kind === 'pickup' && entity.type === 'rapid_fire',
  );
  assert.equal(rapidPickup?.type, 'rapid_fire');
});

test('same ship state and input produce the same result', () => {
  function runMatch() {
    const match = createMatch(1280, 720, 42);
    addPlayer(match, p1);
    addPlayer(match, p2);
    for (let count = 1; count <= 100; count += 1) {
      stepMatch(match, new Map([
        [p1, input(count, count % 8 === 0, count % 20 < 10 ? 1 : -1, true)],
        [p2, input(count, count % 11 === 0, -1, count % 2 === 0)],
      ]));
    }
    return snapshotEntities(match);
  }
  assert.deepEqual(runMatch(), runMatch());
});

test('binary decoders reject malformed packet lengths, versions, flags, and kinds', () => {
  assert.throws(() => decodeInput(new ArrayBuffer(4)), /Invalid input packet/);
  assert.throws(() => decodeSnapshot(new ArrayBuffer(12)), /Invalid snapshot packet/);
  const wrongVersion = encodeInput(input(1));
  new DataView(wrongVersion).setUint8(1, 0);
  assert.throws(() => decodeInput(wrongVersion), /Invalid input packet/);
  const invalidFlags = encodeInput(input(1));
  new DataView(invalidFlags).setUint8(10, 0x80);
  assert.throws(() => decodeInput(invalidFlags), /Invalid input packet/);
  const invalidKind = encodeSnapshot({ tick: tick(0), ack: sequence(0), entities: snapshotEntities(createMatch(1280, 720, 3)) });
  new DataView(invalidKind).setUint8(14, 255);
  assert.throws(() => decodeSnapshot(invalidKind), /Unknown entity kind/);
  const invalidRadius = encodeSnapshot({
    tick: tick(0),
    ack: sequence(0),
    entities: snapshotEntities(createMatch(1280, 720, 3)),
  });
  new DataView(invalidRadius).setUint8(40, 250);
  assert.throws(() => decodeSnapshot(invalidRadius), /Invalid snapshot fields/);
  const invalidEntityFlags = encodeSnapshot({
    tick: tick(0),
    ack: sequence(0),
    entities: snapshotEntities(createMatch(1280, 720, 3)),
  });
  new DataView(invalidEntityFlags).setUint8(55, 8);
  assert.throws(() => decodeSnapshot(invalidEntityFlags), /Invalid snapshot fields/);
});

test('client JSON messages are validated and branded', () => {
  assert.equal(ClientInputMessageSchema.parse({
    type: 'input', seq: 4, thrust: true, turn: 1, fire: false,
  }).seq, 4);
  const parsed = parseClientMessage({
    type: 'input', seq: 4, tick: 3, thrust: true, turn: -1, fire: false,
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.type, 'input');
    if (parsed.data.type === 'input') {
      assert.equal(parsed.data.seq, sequence(4));
      assert.equal(parsed.data.tick, tick(3));
    }
  }
  const invalid = parseClientMessage({ type: 'input', seq: -1, thrust: true, turn: 8, fire: false });
  assert.equal(invalid.success, false);
  if (!invalid.success) assert.ok(invalid.error instanceof Error);
});

test('server JSON message schemas validate all public message forms', () => {
  const match = createMatch(1280, 720, 5);
  const snapshot = {
    type: 'snapshot',
    tick: 0,
    ack: 0,
    entities: snapshotEntities(match),
  };
  assert.equal(ServerSnapshotMessageSchema.safeParse(snapshot).success, true);
  assert.equal(ServerMessageSchema.safeParse({
    type: 'joined', roomId: 'arena', playerId: 1, seed: 5,
    width: 1280, height: 720, tickRate: 30, codec: 'binary',
  }).success, true);
  assert.equal(ServerMessageSchema.safeParse({
    type: 'chat', playerName: 'Pilot', text: 'Ready!',
  }).success, true);
  assert.equal(ServerMessageSchema.safeParse({ type: 'pong', sentAt: 12 }).success, true);
  assert.equal(ServerSnapshotMessageSchema.safeParse({ ...snapshot, entities: [{ kind: 'unknown' }] }).success, false);
});

test('brand constructors enforce protocol ranges', () => {
  assert.equal(entityId(1), 1);
  assert.equal(playerId(0xffff), 0xffff);
  assert.equal(tick(0xffffffff), 0xffffffff);
  assert.equal(sequence(0xffffffff), 0xffffffff);
  assert.throws(() => entityId(0));
  assert.throws(() => entityId(0x10000));
  assert.throws(() => playerId(-1));
  assert.throws(() => tick(0x100000000));
  assert.throws(() => sequence(1.5));
});
