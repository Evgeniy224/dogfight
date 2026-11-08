import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addPlayer,
  createMatch,
  decodeInput,
  decodeSnapshot,
  encodeInput,
  encodeSnapshot,
  snapshotEntities,
  stepMatch,
} from './network.js';

test('input binary codec preserves sequence and controls', () => {
  const input = { seq: 23, tick: 17, thrust: true, turn: -1, fire: true };
  assert.deepEqual(decodeInput(encodeInput(input)), input);
});

test('match creates the same seeded field of twelve asteroids', () => {
  const first = createMatch(1280, 720, 42);
  const second = createMatch(1280, 720, 42);
  assert.equal(first.asteroids.length, 12);
  assert.deepEqual(first.asteroids, second.asteroids);
  assert.ok(first.asteroids.every((asteroid) => [15, 25, 40].includes(asteroid.radius)));
});

test('match replenishes asteroids and pickups deterministically', () => {
  function runMatch() {
    const match = createMatch(1280, 720, 42);
    match.asteroids.pop();
    match.pickups.pop();
    for (let tick = 1; tick <= 151; tick += 1) stepMatch(match, new Map());
    return snapshotEntities(match);
  }

  const first = runMatch();
  assert.equal(first.filter((entity) => entity.kind === 'asteroid').length, 12);
  assert.equal(first.filter((entity) => entity.kind === 'pickup').length, 2);
  assert.deepEqual(first, runMatch());
});

test('authoritative bullets damage asteroids', () => {
  const match = createMatch(1280, 720, 42);
  const ship = addPlayer(match, 1);
  ship.x = 100;
  ship.y = 360;
  ship.angle = 0;
  match.asteroids = [{
    id: 100,
    kind: 'asteroid',
    ownerId: 0,
    inputSeq: 0,
    x: 160,
    y: 360,
    vx: 0,
    vy: 0,
    angle: 0,
    angularVel: 0,
    hp: 100,
    radius: 40,
    alive: true,
  }];

  stepMatch(match, new Map([[1, { seq: 1, thrust: false, turn: 0, fire: true }]]));

  assert.equal(match.asteroids[0].hp, 75);
  assert.equal(match.bullets.length, 0);
});

test('destroying an asteroid awards its score to the shooter', () => {
  const match = createMatch(1280, 720, 42);
  const ship = addPlayer(match, 1);
  ship.x = 100;
  ship.y = 360;
  ship.angle = 0;
  match.asteroids = [{
    id: 100,
    kind: 'asteroid',
    ownerId: 0,
    inputSeq: 0,
    x: 160,
    y: 360,
    vx: 0,
    vy: 0,
    angle: 0,
    angularVel: 0,
    hp: 30,
    radius: 15,
    scoreValue: 30,
    alive: true,
  }];

  for (let tick = 1; tick <= 9; tick += 1) {
    stepMatch(match, new Map([[1, { seq: tick, thrust: false, turn: 0, fire: true }]]));
  }

  assert.equal(match.asteroids.length, 0);
  assert.equal(ship.score, 30);
});

test('collecting a shield pickup protects the ship from asteroid collision', () => {
  const match = createMatch(1280, 720, 42);
  const ship = addPlayer(match, 1);
  match.asteroids = [{
    id: 100,
    kind: 'asteroid',
    ownerId: 0,
    inputSeq: 0,
    x: ship.x + ship.radius + 1,
    y: ship.y,
    vx: 0,
    vy: 0,
    angle: 0,
    angularVel: 0,
    hp: 100,
    radius: 40,
    alive: true,
  }];
  match.pickups = [{
    id: 101,
    kind: 'pickup',
    ownerId: 0,
    inputSeq: 0,
    x: ship.x,
    y: ship.y,
    vx: 0,
    vy: 0,
    angle: 0,
    hp: 0,
    radius: 12,
    ttl: 15,
    type: 'shield',
    alive: true,
  }];

  stepMatch(match, new Map());

  assert.equal(ship.hp, 100);
  assert.ok(ship.shield > 0);
});

test('players cooperate: bullets do not damage another ship', () => {
  const match = createMatch(1280, 720, 42);
  const shooter = addPlayer(match, 1);
  const partner = addPlayer(match, 2);
  shooter.x = 100;
  shooter.y = 360;
  shooter.angle = 0;
  partner.x = 160;
  partner.y = 360;
  match.asteroids = [];
  match.pickups = [];

  for (let tick = 1; tick <= 3; tick += 1) {
    stepMatch(match, new Map([
      [1, { seq: tick, thrust: false, turn: 0, fire: tick === 1 }],
      [2, { seq: tick, thrust: false, turn: 0, fire: false }],
    ]));
  }

  assert.equal(partner.hp, 100);
});

test('snapshot codec preserves entity state within quantization precision', () => {
  const match = createMatch(1280, 720, 42);
  addPlayer(match, 1);
  stepMatch(match, new Map([[1, { seq: 1, tick: 1, thrust: true, turn: -1, fire: true }]]));
  const original = { tick: match.tick, ack: 1, entities: snapshotEntities(match) };
  const decoded = decodeSnapshot(encodeSnapshot(original));
  assert.equal(decoded.tick, original.tick);
  assert.equal(decoded.ack, original.ack);
  assert.equal(decoded.entities.length, original.entities.length);
  assert.equal(decoded.entities[0].ownerId, original.entities[0].ownerId);
  assert.equal(decoded.entities[0].alive, true);
  assert.ok(Math.abs(decoded.entities[0].angle - original.entities[0].angle) <= 0.001);
  assert.ok(Math.abs(decoded.entities[0].x - original.entities[0].x) < 0.001);
  assert.equal(decoded.entities[0].thrust, true);
  assert.equal(decoded.entities.find((entity) => entity.kind === 'pickup' && entity.type === 'rapid_fire')?.type, 'rapid_fire');
});

test('same ship state and input produce the same result', () => {
  function runMatch() {
    const match = createMatch(1280, 720, 42);
    addPlayer(match, 1);
    addPlayer(match, 2);
    for (let tick = 1; tick <= 100; tick += 1) {
      stepMatch(match, new Map([
        [1, { seq: tick, thrust: true, turn: tick % 20 < 10 ? 1 : -1, fire: tick % 8 === 0 }],
        [2, { seq: tick, thrust: tick % 2 === 0, turn: -1, fire: tick % 11 === 0 }],
      ]));
    }
    return snapshotEntities(match);
  }
  assert.deepEqual(runMatch(), runMatch());
});

test('binary decoders reject malformed packet lengths', () => {
  assert.throws(() => decodeInput(new ArrayBuffer(4)), /Invalid input packet/);
  assert.throws(() => decodeSnapshot(new ArrayBuffer(12)), /Invalid snapshot packet/);
});