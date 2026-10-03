// ---------------------------------------------------------------------------
// Integration checks against the real town geometry: every module resolves,
// the collision volumes are sane, and the player can actually move around,
// reach doors and use every ladder that was placed.
//
//   npm run test:world
// ---------------------------------------------------------------------------
// The town builder draws text labels on 2D canvases; stub just enough DOM.
globalThis.document = globalThis.document || {
  createElement: (tag) => {
    if (tag !== 'canvas') return {};
    return {
      width: 1, height: 1,
      getContext: () => new Proxy({}, {
        get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => {}),
        set: () => true,
      }),
    };
  },
};

import * as THREE from 'three';
import { CONFIG } from '../src/config.js';
import { CollisionWorld } from '../src/systems/Physics.js';
import { TownBuilder } from '../src/world/TownBuilder.js';
import { Player } from '../src/entities/Player.js';
import { GameState } from '../src/systems/GameState.js';
import { LOCATIONS } from '../src/data/world.js';

let passed = 0, failed = 0;
const results = [];
function test(name, fn) {
  try { fn(); passed++; results.push(`  ✓ ${name}`); }
  catch (e) { failed++; results.push(`  ✗ ${name}\n      ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

class FakeInput {
  constructor() { this.held = {}; this.edges = {}; this.move = { x: 0, z: 0 }; this.look = { dx: 0, dy: 0 }; }
  hold(a, v = true) { this.held[a] = v; if (v) this.edges[a] = true; }
  tap(a) { this.edges[a] = true; }
  down(a) { return !!this.held[a]; }
  pressed(a) { if (this.edges[a]) { this.edges[a] = false; return true; } return false; }
  released() { return false; }
  pressedCode() { return false; }
}

// --- build the real town once ---------------------------------------------
const scene = new THREE.Scene();
const builder = new TownBuilder(scene);
builder.build();
const world = new CollisionWorld(builder.colliders);
for (const l of builder.ladders) world.addLadder(l);

const R = CONFIG.player.radius;
const H = CONFIG.player.height;

function spawnPlayer(x, z, y = 0, rot = 0) {
  const st = new GameState();
  const events = [];
  const p = new Player(new THREE.Scene(), st, {
    world, settings: { ...CONFIG.defaultSettings },
    onEvent: (t, d) => events.push({ type: t, data: d }),
  });
  p.setPosition(x, y, z, rot);
  p.events = events;
  return p;
}

console.log('\nTown geometry');

test('the builder produces colliders and ladders', () => {
  assert(builder.colliders.length > 80, `${builder.colliders.length} colliders`);
  assert(builder.ladders.length >= 6, `${builder.ladders.length} ladders`);
  assert(builder.doors.length > 0, 'doors');
  assert(builder.interiorCenters && Object.keys(builder.interiorCenters).length > 0, 'interiors');
});

test('every collider is a well-formed box', () => {
  for (const b of builder.colliders) {
    const ok = [b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ].every(Number.isFinite);
    assert(ok, `non-finite bounds: ${JSON.stringify(b)}`);
    assert(b.maxX > b.minX && b.maxZ > b.minZ, `zero footprint: ${b.label}`);
    assert(b.maxY > b.minY, `zero height: ${b.label}`);
    assert(b.maxY - b.minY < 60 && b.maxX - b.minX < 400, `absurd size: ${b.label}`);
  }
});

test('the player spawn point is clear', () => {
  const x = LOCATIONS.home.x, z = LOCATIONS.home.z + 12;
  assert(world.isFree(x, 0, z, R, H), 'spawn is inside geometry');
  assert(world.groundAt(x, z, 0.1, R, 0.5).y < 0.3, 'spawn is on the street');
});

test('the player can run in every direction without leaving the world', () => {
  const dirs = 8;
  for (let i = 0; i < dirs; i++) {
    const a = (i / dirs) * Math.PI * 2;
    const p = spawnPlayer(LOCATIONS.home.x, LOCATIONS.home.z + 12);
    const input = new FakeInput();
    input.move = { x: Math.sin(a), z: -Math.cos(a) };
    input.hold('sprint');
    for (let f = 0; f < 60 * 4; f++) {
      p.update(1 / 60, { input, camYaw: Math.PI, camPitch: 0 });
      assert(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.y) && Number.isFinite(p.pos.z),
        `NaN position on heading ${i}`);
      assert(p.pos.y > -1.5, `fell through the floor on heading ${i} (y=${p.pos.y.toFixed(2)})`);
      assert(p.pos.y < 40, `launched into orbit on heading ${i} (y=${p.pos.y.toFixed(2)})`);
    }
    assert(world.isFree(p.pos.x, p.pos.y + 0.05, p.pos.z, R * 0.9, Math.max(0.6, p.height - 0.1)),
      `ended up stuck inside geometry on heading ${i} at ${p.pos.x.toFixed(1)},${p.pos.z.toFixed(1)}`);
  }
});

test('ladders have a clear base and a solid top', () => {
  for (const l of builder.ladders) {
    const bx = l.x - Math.sin(l.yaw) * 0.42;
    const bz = l.z - Math.cos(l.yaw) * 0.42;
    assert(world.isFree(bx, l.bottom + 0.05, bz, R * 0.8, 1.6),
      `blocked base at ${bx.toFixed(1)},${bz.toFixed(1)}`);
    const tx = l.x + Math.sin(l.yaw) * 0.7;
    const tz = l.z + Math.cos(l.yaw) * 0.7;
    const g = world.groundAt(tx, tz, l.top + 0.4, R, 0.8);
    assert(Math.abs(g.y - l.top) < 1.2,
      `no landing at the top of the ladder at ${l.x.toFixed(1)},${l.z.toFixed(1)} (top ${l.top}, found ${g.y})`);
    assert(l.top - l.bottom > 1.2, 'ladder too short to be useful');
  }
});

test('a player can climb every ladder to the top', () => {
  for (const l of builder.ladders) {
    const bx = l.x - Math.sin(l.yaw) * 0.42;
    const bz = l.z - Math.cos(l.yaw) * 0.42;
    const p = spawnPlayer(bx, bz, l.bottom);
    p.startLadder(l);
    const input = new FakeInput();
    input.move = { x: 0, z: -1 };
    for (let f = 0; f < 60 * 12 && p.motion !== 'ground'; f++) {
      p.update(1 / 60, { input, camYaw: p.rot, camPitch: 0 });
      p.state.stamina = 100;              // isolate the climb from fatigue
    }
    input.move = { x: 0, z: 0 };
    for (let f = 0; f < 30; f++) p.update(1 / 60, { input, camYaw: p.rot, camPitch: 0 });
    assert(p.pos.y > l.top - 1.0,
      `did not reach the top of the ladder at ${l.x.toFixed(1)},${l.z.toFixed(1)}: y=${p.pos.y.toFixed(2)} (top ${l.top})`);
  }
});

test('rooftop lips in the real town can be caught in mid-air', () => {
  let caught = 0, tried = 0;
  for (const l of builder.ladders) {
    const roof = world.groundAt(l.x + Math.sin(l.yaw) * 0.7, l.z + Math.cos(l.yaw) * 0.7,
      l.top + 0.5, R, 0.9);
    if (!roof.box || roof.y < 2.5) continue;                  // need a real drop below it
    tried++;
    const p = spawnPlayer(
      l.x - Math.sin(l.yaw) * 0.62, l.z - Math.cos(l.yaw) * 0.62, roof.y - 1.4, l.yaw);
    const input = new FakeInput();
    input.move = { x: 0, z: -1 };                             // press into the wall
    for (let f = 0; f < 90 && p.motion !== 'hang'; f++) {
      p.update(1 / 60, { input, camYaw: l.yaw, camPitch: 0 });
    }
    if (p.motion === 'hang') {
      caught++;
      assert(Math.abs(p.pos.y - (roof.y - CONFIG.player.hangDrop)) < 0.6,
        `hangs just under the lip at ${l.x.toFixed(1)},${l.z.toFixed(1)}`);
    }
  }
  assert(tried > 0, 'no rooftops high enough to test');
  assert(caught > 0, `caught ${caught} of ${tried} rooftop lips`);
});

test('every door has somewhere to stand in front of it', () => {
  for (const d of builder.doors) {
    let ok = false;
    for (let i = 0; i < 16 && !ok; i++) {
      const a = (i / 16) * Math.PI * 2;
      for (const r of [0.9, 1.4, 1.9]) {
        const x = d.pos.x + Math.sin(a) * r, z = d.pos.z + Math.cos(a) * r;
        const g = world.groundAt(x, z, 1.2, R, 1.4);
        if (world.isFree(x, g.y + 0.05, z, R, H) && Math.abs(g.y) < 4) { ok = true; break; }
      }
    }
    assert(ok, `no approach to the door: ${d.name} at ${d.pos.x.toFixed(1)},${d.pos.z.toFixed(1)}`);
  }
});

test('interior centres are clear', () => {
  for (const [id, c] of Object.entries(builder.interiorCenters)) {
    assert(world.isFree(c.x, 0.05, c.z, R, H), `interior ${id} is blocked at its centre`);
  }
});

test('parkour props are climbable or vaultable, not both-blocked', () => {
  const props = builder.colliders.filter(b => b.maxY > 0.5 && b.maxY < 2.6 && b.minY < 0.4);
  assert(props.length > 20, `found ${props.length} low props to parkour on`);
  const climbable = props.filter(b => b.climb !== false);
  assert(climbable.length > props.length * 0.5, 'most low props should be climbable');
});

test('vaulting over a real crate in the construction yard works', () => {
  // The site sits around (-10, 30); find a waist-high prop there.
  const near = builder.colliders
    .filter(b => b.maxY > 0.75 && b.maxY < 1.25 && b.minY < 0.1 && b.vault !== false)
    .map(b => ({ b, cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2 }))
    .filter(o => Number.isFinite(o.cx));
  assert(near.length > 0, 'no waist-high props exist anywhere in town');
  let vaulted = 0;
  for (const o of near.slice(0, 6)) {
    const p = spawnPlayer(o.cx, o.b.maxZ + 2.2 + R, 0, Math.PI);
    if (!world.isFree(p.pos.x, 0, p.pos.z, R, H)) continue;     // approach blocked, skip
    const input = new FakeInput();
    input.move = { x: 0, z: -1 };            // camYaw PI -> run toward -Z, into the prop
    input.hold('sprint');
    for (let f = 0; f < 60 * 3; f++) {
      p.update(1 / 60, { input, camYaw: Math.PI, camPitch: 0 });
      if (f === 40) { input.hold('jump'); input.tap('jump'); }
      if (f === 44) input.hold('jump', false);
    }
    if (p.events.some(e => e.type === 'vault' || e.type === 'mantle')) vaulted++;
  }
  assert(vaulted > 0, 'could not vault or mantle any waist-high prop in the town');
});

console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
