// ---------------------------------------------------------------------------
// Headless tests for the player controller, collision world and interaction
// system. Three.js runs fine in Node as long as we never create a renderer.
//
//   npm test
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CONFIG } from '../src/config.js';
import { CollisionWorld, makeBox } from '../src/systems/Physics.js';
import { Player } from '../src/entities/Player.js';
import { InteractionSystem } from '../src/systems/Interaction.js';
import { CameraController } from '../src/systems/CameraController.js';
import { GameState } from '../src/systems/GameState.js';

let passed = 0, failed = 0;
const results = [];

function test(name, fn) {
  try { fn(); passed++; results.push(`  ✓ ${name}`); }
  catch (e) { failed++; results.push(`  ✗ ${name}\n      ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function near(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error(`${msg || 'expected'} ${a.toFixed(3)} ≈ ${b.toFixed(3)} (±${tol})`);
}

// --- harness ---------------------------------------------------------------
class FakeInput {
  constructor() { this.held = {}; this.edges = {}; this.move = { x: 0, z: 0 }; this.look = { dx: 0, dy: 0 }; this.locked = true; }
  hold(action, v = true) { this.held[action] = v; if (v) this.edges[action] = true; }
  tap(action) { this.edges[action] = true; }
  down(a) { return !!this.held[a]; }
  pressed(a) { if (this.edges[a]) { this.edges[a] = false; return true; } return false; }
  released() { return false; }
  pressedCode() { return false; }
}

function makeWorld(boxes = []) {
  const w = new CollisionWorld(boxes);
  return w;
}

function makePlayer(world, opts = {}) {
  const scene = new THREE.Scene();
  const state = new GameState();
  const events = [];
  const p = new Player(scene, state, {
    world,
    settings: { ...CONFIG.defaultSettings, ...(opts.settings || {}) },
    onEvent: (type, data) => events.push({ type, data }),
  });
  p.setPosition(opts.x ?? 0, opts.y ?? 0, opts.z ?? 0, opts.rot ?? 0);
  p.events = events;
  return p;
}

/** Run the controller for `seconds` at a fixed 60 Hz.
 *  Default camera yaw is PI so that "W" drives the player toward -Z. */
function sim(player, input, seconds, camYaw = Math.PI, dt = 1 / 60) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    player.update(dt, { input, camYaw, camPitch: 0, blockInput: false, canAim: false });
  }
}

const FWD = { x: 0, z: -1 };   // "W" in input space

// ---------------------------------------------------------------------------
console.log('\nPlayer controller');

test('accelerates to jog speed and stops crisply', () => {
  const p = makePlayer(makeWorld());
  const input = new FakeInput();
  input.move = { ...FWD };
  sim(p, input, 1.0);
  near(p.speed, CONFIG.player.jogSpeed, 0.25, 'jog speed');
  input.move = { x: 0, z: 0 };
  sim(p, input, 0.35);
  assert(p.speed < 0.2, `should stop quickly, speed=${p.speed.toFixed(2)}`);
});

test('sprint is faster than jog and drains stamina', () => {
  const p = makePlayer(makeWorld());
  const input = new FakeInput();
  input.move = { ...FWD };
  input.hold('sprint');
  const before = p.state.stamina;
  sim(p, input, 1.5);
  assert(p.sprinting, 'should be sprinting');
  assert(p.speed > CONFIG.player.jogSpeed + 1, `sprint speed ${p.speed.toFixed(2)}`);
  assert(p.state.stamina < before - 10, 'stamina should drain');
});

test('walk modifier is slower than jog', () => {
  const p = makePlayer(makeWorld());
  const input = new FakeInput();
  input.move = { ...FWD };
  input.hold('walk');
  sim(p, input, 1.0);
  near(p.speed, CONFIG.player.walkSpeed, 0.3, 'walk speed');
});

test('exhaustion blocks sprinting until stamina recovers', () => {
  const p = makePlayer(makeWorld());
  const input = new FakeInput();
  input.move = { ...FWD };
  input.hold('sprint');
  p.state.stamina = 1;
  sim(p, input, 0.6);
  assert(!p.sprinting, 'should not sprint while exhausted');
  assert(p.speed <= CONFIG.player.jogSpeed + 0.4, 'falls back to jogging');
});

test('crouch lowers the capsule and the speed', () => {
  const p = makePlayer(makeWorld());
  const input = new FakeInput();
  input.move = { ...FWD };
  input.hold('crouch');
  sim(p, input, 1.0);
  assert(p.stance === 'crouch', 'stance');
  near(p.height, CONFIG.player.crouchHeight, 0.02, 'capsule height');
  assert(p.speed < CONFIG.player.jogSpeed * 0.6, `crouch speed ${p.speed.toFixed(2)}`);
});

test('cannot stand up under a low ceiling', () => {
  // A slab hanging from 1.35 to 1.8 over the strip z = [-6,-2]
  const world = makeWorld([makeBox(0, -4, 6, 4, { minY: 1.35, maxY: 1.8 })]);
  const p = makePlayer(world);
  const input = new FakeInput();
  input.hold('crouch');
  input.move = { ...FWD };
  sim(p, input, 2.0);                      // crouch-walk under the slab
  assert(p.pos.z < -2.8, `moved under the slab, z=${p.pos.z.toFixed(2)}`);
  assert(p.stance === 'crouch', 'crouched');
  input.hold('crouch', false);
  input.move = { x: 0, z: 0 };
  sim(p, input, 0.6);
  assert(p.stance === 'crouch', 'still crouched because of the ceiling');
  // step back out and the player stands up again
  input.move = { x: 0, z: 1 };
  sim(p, input, 1.6);
  assert(p.stance === 'stand', 'stands once clear of the slab');
});

test('a player spawned inside geometry is pushed out', () => {
  const world = makeWorld([makeBox(0, 0, 4, 4, { maxY: 3 })]);
  const p = makePlayer(world);
  sim(p, new FakeInput(), 0.2);
  assert(Math.hypot(p.pos.x, p.pos.z) > 2.0, `depenetrated to ${p.pos.x.toFixed(2)},${p.pos.z.toFixed(2)}`);
});

test('jump leaves the ground and lands again', () => {
  const p = makePlayer(makeWorld());
  const input = new FakeInput();
  input.hold('jump');
  input.tap('jump');
  sim(p, input, 0.2);
  assert(!p.grounded && p.pos.y > 0.3, `airborne, y=${p.pos.y.toFixed(2)}`);
  input.hold('jump', false);
  sim(p, input, 1.5);
  assert(p.grounded, 'landed');
  near(p.pos.y, 0, 0.01, 'back on the ground');
  assert(p.events.some(e => e.type === 'jump'), 'jump event');
  assert(p.events.some(e => e.type === 'land'), 'land event');
});

test('holding jump goes higher than tapping it', () => {
  const run = (hold) => {
    const p = makePlayer(makeWorld());
    const input = new FakeInput();
    input.hold('jump'); input.tap('jump');
    let apex = 0;
    for (let i = 0; i < 70; i++) {
      if (!hold && i === 4) input.hold('jump', false);
      p.update(1 / 60, { input, camYaw: 0, camPitch: 0 });
      apex = Math.max(apex, p.pos.y);
    }
    return apex;
  };
  const high = run(true), low = run(false);
  assert(high > low + 0.25, `variable height: ${high.toFixed(2)} vs ${low.toFixed(2)}`);
});

test('coyote time allows a jump just after walking off a ledge', () => {
  const world = makeWorld([makeBox(0, 0, 4, 4, { maxY: 2 })]);
  const p = makePlayer(world, { y: 2, z: 1.2 });
  const input = new FakeInput();
  input.move = { ...FWD };                // camYaw 0 -> "W" drives toward +Z, off the edge
  let frames = 0;
  while (p.grounded && frames++ < 240) p.update(1 / 60, { input, camYaw: 0, camPitch: 0 });
  assert(!p.grounded, 'walked off the ledge');
  assert(p.coyoteT > 0, `coyote window open (${p.coyoteT.toFixed(3)}s)`);
  input.hold('jump'); input.tap('jump');
  p.update(1 / 60, { input, camYaw: 0, camPitch: 0 });
  assert(p.vel.y > 3, `jumped after leaving the ledge (vy=${p.vel.y.toFixed(2)})`);
  // ...but not after the window has closed
  const q = makePlayer(world, { y: 2, z: 1.2 });
  const qi = new FakeInput();
  qi.move = { ...FWD };
  sim(q, qi, 0.6, 0);
  qi.hold('jump'); qi.tap('jump');
  q.update(1 / 60, { input: qi, camYaw: 0, camPitch: 0 });
  assert(q.vel.y < 0, 'no late double jump');
});

test('jump input is buffered just before landing', () => {
  const p = makePlayer(makeWorld(), { y: 1.2 });
  const input = new FakeInput();
  sim(p, input, 0.25);                     // falling
  assert(!p.grounded, 'in the air');
  input.hold('jump'); input.tap('jump');   // pressed slightly early
  p.update(1 / 60, { input, camYaw: 0, camPitch: 0 });
  sim(p, input, 0.12);
  assert(p.vel.y > 2 || !p.grounded, 'buffered jump fired on landing');
});

console.log('\nSlide');

/** Sprint forward until at full speed, then tap crouch. */
function sprintThenSlide(world, seconds = 1.4) {
  const p = makePlayer(world);
  const input = new FakeInput();
  input.move = { ...FWD };
  input.hold('sprint');
  sim(p, input, seconds);
  input.tap('crouch');
  input.hold('crouch');
  p.update(1 / 60, { input, camYaw: Math.PI, camPitch: 0 });
  return { p, input };
}

test('crouching at sprint speed starts a slide', () => {
  const { p } = sprintThenSlide(makeWorld());
  assert(p.motion === 'slide', `motion is ${p.motion}`);
  assert(p.speed > CONFIG.player.sprintSpeed * 0.9, `keeps momentum (${p.speed.toFixed(2)} m/s)`);
  assert(p.describeState() === 'SLIDING', 'HUD readout');
  assert(Math.abs(p.height - CONFIG.player.crouchHeight) < 0.3, 'capsule drops immediately');
});

test('a slide decays, covers ground and ends on its own', () => {
  const { p, input } = sprintThenSlide(makeWorld());
  const z0 = p.pos.z;
  input.hold('crouch', false);
  let t = 0;
  while (p.motion === 'slide' && t < 3) { p.update(1 / 60, { input, camYaw: Math.PI, camPitch: 0 }); t += 1 / 60; }
  const travelled = z0 - p.pos.z;
  assert(p.motion === 'ground', `slide ended (motion ${p.motion})`);
  assert(t < 1.2, `slide lasted ${t.toFixed(2)}s`);
  assert(travelled > 2.5 && travelled < 7.5, `slid ${travelled.toFixed(2)}m`);
  sim(p, input, 0.3);
  assert(p.stance === 'stand', 'stands back up when the key is released');
});

test('crouching from a standstill does not slide', () => {
  const p = makePlayer(makeWorld());
  const input = new FakeInput();
  input.tap('crouch');
  input.hold('crouch');
  sim(p, input, 0.3);
  assert(p.motion === 'ground' && p.stance === 'crouch', `plain crouch (${p.motion}/${p.stance})`);
});

/** Sprint forward until the player passes `z`, then return the rig. */
function sprintTo(world, z) {
  const p = makePlayer(world);
  const input = new FakeInput();
  input.move = { ...FWD };
  input.hold('sprint');
  for (let f = 0; f < 60 * 10 && p.pos.z > z; f++) {
    p.update(1 / 60, { input, camYaw: Math.PI, camPitch: 0 });
  }
  return { p, input };
}

test('a slide fits under a gap a standing player cannot pass', () => {
  // A pipe from 1.30 to 2.60 across the corridor at z = [-16,-14]
  const world = makeWorld([makeBox(0, -15, 10, 2, { minY: 1.3, maxY: 2.6 })]);

  const standing = sprintTo(world, -40).p;        // runs until it is stopped
  assert(standing.pos.z > -14.1, `standing player is stopped by the pipe (z=${standing.pos.z.toFixed(2)})`);

  const { p, input } = sprintTo(world, -11);      // at full speed, 3m short
  assert(p.speed > CONFIG.player.slideMinSpeed, 'arrives at sprint speed');
  input.tap('crouch'); input.hold('crouch');
  sim(p, input, 1.6);
  assert(p.pos.z < -15, `slid under the pipe to z=${p.pos.z.toFixed(2)}`);
});

test('a slide that ends under a ceiling stays crouched', () => {
  const world = makeWorld([makeBox(0, -16, 12, 12, { minY: 1.3, maxY: 2.6 })]);
  const { p, input } = sprintTo(world, -8);
  input.tap('crouch');
  sim(p, input, 2.0);
  assert(p.motion === 'ground', 'slide finished');
  assert(p.pos.z < -10.5, `ended up under the slab (z=${p.pos.z.toFixed(2)})`);
  assert(p.stance === 'crouch', 'no headroom, so the player stays down');
});

test('slides cannot be chained back to back', () => {
  const { p, input } = sprintThenSlide(makeWorld());
  input.hold('crouch', false);
  while (p.motion === 'slide') p.update(1 / 60, { input, camYaw: Math.PI, camPitch: 0 });
  assert(p.slideCooldownT > 0, 'a cooldown starts when the slide ends');

  // Even at full speed the next slide is refused until the cooldown expires.
  p.vel.set(0, 0, -CONFIG.player.sprintSpeed); p.speed = CONFIG.player.sprintSpeed;
  input.tap('crouch'); input.hold('crouch');
  p.update(1 / 60, { input, camYaw: Math.PI, camPitch: 0 });
  assert(p.motion !== 'slide', 'cooldown blocks an instant second slide');

  input.hold('crouch', false);
  sim(p, input, CONFIG.player.slideCooldown + 0.1);
  p.vel.set(0, 0, -CONFIG.player.sprintSpeed); p.speed = CONFIG.player.sprintSpeed;
  p.stance = 'stand'; p.state.stamina = 100;
  input.tap('crouch'); input.hold('crouch');
  p.update(1 / 60, { input, camYaw: Math.PI, camPitch: 0 });
  assert(p.motion === 'slide', 'slides again once the cooldown has passed');
});

test('jumping out of a slide launches the player', () => {
  const { p, input } = sprintThenSlide(makeWorld());
  sim(p, input, 0.25);
  input.hold('crouch', false);
  input.tap('jump'); input.hold('jump');
  sim(p, input, 0.2);
  assert(p.vel.y > 2.5 || !p.grounded, `slide-jump fired (vy=${p.vel.y.toFixed(2)})`);
});

test('sliding costs stamina and emits start/end events', () => {
  const p0 = makePlayer(makeWorld());
  const { p, input } = sprintThenSlide(makeWorld());
  assert(p.events.some(e => e.type === 'slide-start'), 'slide-start');
  input.hold('crouch', false);
  sim(p, input, 1.6);
  assert(p.events.some(e => e.type === 'slide-end'), 'slide-end');
  assert(p.state.stamina < p0.state.stamina, 'stamina spent');
});

console.log('\nCollision');

test('walls block movement', () => {
  const world = makeWorld([makeBox(0, -3, 8, 1, { maxY: 4 })]);
  const p = makePlayer(world);
  const input = new FakeInput();
  input.move = { ...FWD };
  sim(p, input, 2.0);
  assert(p.pos.z > -2.6, `stopped by the wall, z=${p.pos.z.toFixed(2)}`);
});

test('player slides along an angled wall instead of sticking', () => {
  const world = makeWorld([makeBox(0, -3, 8, 1, { maxY: 4 })]);
  const p = makePlayer(world);
  const input = new FakeInput();
  input.move = { x: 0.7, z: -0.7 };        // diagonally into the wall (toward -Z, +X at yaw PI => -X)
  sim(p, input, 1.5);
  assert(p.pos.x > 2, `slid sideways, x=${p.pos.x.toFixed(2)}`);
});

test('small kerbs are stepped over automatically', () => {
  const world = makeWorld([makeBox(0, -4, 8, 6, { maxY: 0.3 })]);
  const p = makePlayer(world);
  const input = new FakeInput();
  input.move = { ...FWD };
  sim(p, input, 1.2);
  assert(p.pos.z < -2.5, `walked over the kerb, z=${p.pos.z.toFixed(2)}`);
  near(p.pos.y, 0.3, 0.05, 'standing on top of the kerb');
});

test('boxes provide standing support', () => {
  const world = makeWorld([makeBox(0, 0, 4, 4, { maxY: 1.5 })]);
  const p = makePlayer(world, { y: 4 });
  const input = new FakeInput();
  sim(p, input, 1.2);
  assert(p.grounded, 'landed on the box');
  near(p.pos.y, 1.5, 0.02, 'standing on the box top');
});

console.log('\nParkour');

test('vaults over a low thin wall', () => {
  const world = makeWorld([makeBox(0, -3, 8, 0.5, { maxY: 1.0 })]);
  const p = makePlayer(world);
  const input = new FakeInput();
  input.move = { ...FWD };
  sim(p, input, 0.5);
  input.hold('jump'); input.tap('jump');
  sim(p, input, 1.4);
  assert(p.events.some(e => e.type === 'vault'), 'vault triggered');
  assert(p.pos.z < -3.4, `landed past the wall, z=${p.pos.z.toFixed(2)}`);
  near(p.pos.y, 0, 0.05, 'back on the ground');
});

test('mantles onto a tall crate', () => {
  const world = makeWorld([makeBox(0, -3, 4, 4, { maxY: 2.0 })]);
  const p = makePlayer(world);
  const input = new FakeInput();
  input.move = { ...FWD };
  sim(p, input, 0.5);
  input.hold('jump'); input.tap('jump');
  sim(p, input, 1.6);
  assert(p.events.some(e => e.type === 'mantle'), 'mantle triggered');
  near(p.pos.y, 2.0, 0.08, 'standing on top of the crate');
});

test('does not climb a building-height wall', () => {
  const world = makeWorld([makeBox(0, -3, 10, 2, { maxY: 9, climb: false, vault: false })]);
  const p = makePlayer(world);
  const input = new FakeInput();
  input.move = { ...FWD };
  sim(p, input, 0.6);
  input.hold('jump'); input.tap('jump');
  sim(p, input, 1.2);
  assert(!p.events.some(e => e.type === 'mantle' || e.type === 'vault'), 'no climb');
  assert(p.pos.y < 1.0, 'stayed on the ground');
});

test('auto-vault triggers when sprinting into low cover', () => {
  const world = makeWorld([makeBox(0, -6, 10, 0.5, { maxY: 0.95 })]);
  const p = makePlayer(world, { settings: { autoVault: true } });
  const input = new FakeInput();
  input.move = { ...FWD };
  input.hold('sprint');
  sim(p, input, 2.2);
  assert(p.events.some(e => e.type === 'vault'), 'auto-vaulted while sprinting');
});

test('ladder climbing raises the player and tops out', () => {
  const world = makeWorld([makeBox(0, -3, 6, 2, { maxY: 5 })]);
  world.addLadder({ x: 0, z: -2.0, yaw: Math.PI, bottom: 0, top: 5 });
  const p = makePlayer(world);
  const input = new FakeInput();
  p.startLadder(world.ladders[0]);
  assert(p.motion === 'ladder', 'attached to the ladder');
  input.move = { ...FWD };                 // W climbs
  sim(p, input, 1.0);
  assert(p.pos.y > 1.5, `climbing, y=${p.pos.y.toFixed(2)}`);
  for (let i = 0; i < 60 * 5 && p.motion !== 'ground'; i++) {
    p.update(1 / 60, { input, camYaw: Math.PI, camPitch: 0 });
  }
  input.move = { x: 0, z: 0 };             // let go once on the roof
  sim(p, input, 0.2);
  assert(p.motion === 'ground', 'left the ladder at the top');
  assert(p.pos.y > 4.5, `topped out onto the roof, y=${p.pos.y.toFixed(2)}`);
  assert(p.events.some(e => e.type === 'mantle'), 'auto-mantled over the lip');
});

console.log('\nCombat');

test('melee combo advances and strikes exactly once per swing', () => {
  const p = makePlayer(makeWorld());
  const input = new FakeInput();
  assert(p.meleeAttack(), 'first swing starts');
  const first = p.attack.type;
  sim(p, input, 0.5);
  const strikes = p.events.filter(e => e.type === 'melee-strike');
  assert(strikes.length === 1, `one strike, got ${strikes.length}`);
  assert(p.meleeAttack(), 'combo continues');
  assert(p.attack.type !== first, 'next combo step differs');
});

test('attacking costs stamina and lunges forward', () => {
  const p = makePlayer(makeWorld());
  const before = p.state.stamina;
  p.meleeAttack();
  assert(p.state.stamina < before, 'stamina spent');
  assert(Math.hypot(p.vel.x, p.vel.z) > 0.2, 'lunge impulse applied');
});

test('aiming forces strafe facing and slows the player', () => {
  const p = makePlayer(makeWorld());
  const input = new FakeInput();
  input.move = { ...FWD };
  input.hold('aim');
  const camYaw = Math.PI / 2;
  for (let i = 0; i < 90; i++) p.update(1 / 60, { input, camYaw, camPitch: 0, canAim: true });
  assert(p.aiming, 'aiming');
  near(p.rot, camYaw, 0.08, 'body faces the camera while aiming');
  assert(p.speed < CONFIG.player.jogSpeed * 0.8, `aim walk speed ${p.speed.toFixed(2)}`);
});

console.log('\nCamera & interaction');

test('camera-relative movement maps W to the camera forward vector', () => {
  const cam = new CameraController(new THREE.PerspectiveCamera(), { ...CONFIG.defaultSettings });
  cam.yaw = Math.PI / 2;                    // camera looks toward +X
  const mv = cam.moveRelative({ x: 0, z: -1 });
  near(mv.x, 1, 0.001, 'W moves along +X');
  near(mv.z, 0, 0.001, 'no Z drift');
  const strafe = cam.moveRelative({ x: 1, z: 0 });
  near(strafe.z, 1, 0.001, 'D moves to the screen right (+Z here)');
});

test('player yaw follows the camera-relative direction', () => {
  const p = makePlayer(makeWorld());
  const input = new FakeInput();
  input.move = { ...FWD };
  sim(p, input, 1.2, Math.PI / 2);          // camera facing +X
  near(p.rot, Math.PI / 2, 0.12, 'body turned to face travel direction');
  assert(p.pos.x > 2, `moved along +X, x=${p.pos.x.toFixed(2)}`);
});

test('camera arm retracts when geometry is behind the player', () => {
  const world = makeWorld([makeBox(0, 3, 12, 1, { maxY: 6 })]);
  const cam = new CameraController(new THREE.PerspectiveCamera(), { ...CONFIG.defaultSettings });
  cam.yaw = cam.yawTarget = Math.PI;        // looking -Z, so the arm swings toward +Z
  const target = new THREE.Vector3(0, 0, 0);
  cam.snap(target);
  for (let i = 0; i < 40; i++) cam.update(1 / 60, { target, world, mode: 'normal' });
  assert(cam.armLength < CONFIG.camera.distance - 0.5, `arm pulled in to ${cam.armLength.toFixed(2)}`);
});

test('interaction picks the candidate the player faces', () => {
  const I = new InteractionSystem();
  let picked = null;
  I.addProvider((ctx, out) => {
    out.push({ pos: new THREE.Vector3(0, 0, 2), label: 'behind', action: () => (picked = 'behind') });
    out.push({ pos: new THREE.Vector3(0, 0, -2), label: 'ahead', action: () => (picked = 'ahead') });
  });
  const player = { pos: new THREE.Vector3(0, 0, 0), rot: Math.PI };   // facing -Z
  const best = I.update({ player, camYaw: Math.PI, blocked: false });
  assert(best && best.label === 'ahead', `picked ${best && best.label}`);
  best.action();
  assert(picked === 'ahead', 'action ran');
  assert(I.prompt().includes('ahead'), 'prompt text');
});

test('interaction prompts use the right key label', () => {
  const I = new InteractionSystem();
  I.addProvider((ctx, out) => out.push({ pos: new THREE.Vector3(0, 0, -1), label: 'Get in the car', key: 'vehicle', keyLabel: 'V' }));
  const player = { pos: new THREE.Vector3(), rot: Math.PI };
  I.update({ player, camYaw: 0, blocked: false });
  assert(I.prompt().startsWith('<b>V</b>'), I.prompt());
});

console.log('\nWorld queries');

test('ray casts hit boxes and the ground plane', () => {
  const world = makeWorld([makeBox(0, -5, 4, 4, { maxY: 3 })]);
  const hit = world.raycast({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 20);
  assert(hit && Math.abs(hit.dist - 3) < 0.01, `box hit at ${hit && hit.dist}`);
  const down = world.raycast({ x: 20, y: 5, z: 20 }, { x: 0, y: -1, z: 0 }, 20);
  assert(down && Math.abs(down.y) < 0.01, 'ground plane hit');
});

test('ground query honours step tolerance', () => {
  const world = makeWorld([makeBox(0, 0, 4, 4, { maxY: 1.5 })]);
  assert(world.groundAt(0, 0, 0, 0.36, 0.45).y === 0, 'high box is not support from the floor');
  assert(world.groundAt(0, 0, 2, 0.36, 0.45).y === 1.5, 'box is support from above');
});

// ---------------------------------------------------------------------------
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
