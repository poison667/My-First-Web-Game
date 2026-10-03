// ---------------------------------------------------------------------------
// Headless boot test: loads index.html in jsdom, boots the real Game with a
// stubbed renderer and drives it with synthetic keyboard/mouse events, so the
// whole wiring (input -> player -> camera -> HUD) is exercised without a GPU.
//
//   npm run test:boot          (skips cleanly when jsdom is not installed)
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let JSDOM;
try { ({ JSDOM } = await import('jsdom')); }
catch {
  console.log('\nBoot test skipped: run `npm install --no-save jsdom` to enable it.\n');
  process.exit(0);
}

let passed = 0, failed = 0;
const results = [];
function test(name, fn) {
  try { fn(); passed++; results.push(`  ✓ ${name}`); }
  catch (e) { failed++; results.push(`  ✗ ${name}\n      ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

// --- virtual clock ---------------------------------------------------------
let NOW = 1000;
const advance = (ms) => { NOW += ms; };

// --- DOM -------------------------------------------------------------------
const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
  url: 'http://localhost:8080/',
  pretendToBeVisual: false,
});
const { window } = dom;

// 2D canvas stub (jsdom has no canvas backend)
const ctx2d = new Proxy({}, {
  get: (_t, k) => {
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'canvas') return { width: 180, height: 180 };
    if (k === 'createLinearGradient' || k === 'createRadialGradient') {
      return () => ({ addColorStop: () => {} });
    }
    return () => {};
  },
  set: () => true,
});
window.HTMLCanvasElement.prototype.getContext = function (type) { return type === '2d' ? ctx2d : null; };

const rafQueue = [];
window.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
window.cancelAnimationFrame = () => {};
Object.defineProperty(window, 'performance', { value: { now: () => NOW }, configurable: true });
for (const [k, v] of Object.entries({ innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1 })) {
  Object.defineProperty(window, k, { value: v, configurable: true });
}
Object.defineProperty(window, 'AudioContext', { value: undefined, configurable: true });  // silent audio
window.HTMLElement.prototype.requestPointerLock = function () {
  Object.defineProperty(window.document, 'pointerLockElement', { value: this, configurable: true });
  window.document.dispatchEvent(new window.Event('pointerlockchange'));
};
window.document.exitPointerLock = function () {
  Object.defineProperty(window.document, 'pointerLockElement', { value: null, configurable: true });
  window.document.dispatchEvent(new window.Event('pointerlockchange'));
};

for (const k of ['window', 'document', 'navigator', 'location', 'localStorage', 'Event',
  'KeyboardEvent', 'MouseEvent', 'WheelEvent', 'HTMLElement', 'HTMLCanvasElement',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'Image']) {
  Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
}
Object.defineProperty(globalThis, 'performance', { value: { now: () => NOW }, configurable: true });

// --- boot ------------------------------------------------------------------
const { Game } = await import('../src/Game.js');

class HeadlessGame extends Game {
  _createRenderer() {
    this.drawCalls = 0;
    const self = this;
    return {
      setSize() {}, setPixelRatio() {}, dispose() {},
      render() { self.drawCalls++; },
      shadowMap: { enabled: false, type: 0 },
      domElement: self.canvas,
      outputColorSpace: '', toneMapping: 0, toneMappingExposure: 1,
      info: { render: {} },
    };
  }
}

const canvas = window.document.getElementById('game');
const game = new HeadlessGame(canvas);
window.localStorage.clear();
await game.init();

const SPAWN = game.player.pos.clone();

/** Yaw with the most clear space ahead of `pos` (so sprint tests can run). */
function clearestHeading(pos) {
  let best = 0, bestDist = -1;
  for (let i = 0; i < 24; i++) {
    const yaw = (i / 24) * Math.PI * 2;
    const hit = game.world.raycast({ x: pos.x, y: 1.0, z: pos.z },
      { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }, 40);
    const d = hit ? hit.dist : 40;
    if (d > bestDist) { bestDist = d; best = yaw; }
  }
  return { yaw: best, dist: bestDist };
}

/** Pump N animation frames at 60 Hz of virtual time. */
function frames(n = 1) {
  for (let i = 0; i < n; i++) {
    const cb = rafQueue.shift();
    if (!cb) throw new Error('the game stopped requesting frames');
    advance(1000 / 60);
    cb(NOW);
  }
}
const key = (type, code, extra = {}) => window.document.dispatchEvent(
  new window.KeyboardEvent(type, { code, bubbles: true, ...extra }));
const mouse = (type, button = 0) => window.document.dispatchEvent(
  new window.MouseEvent(type, { button, bubbles: true }));

console.log('\nHeadless boot');

test('the game boots and renders frames', () => {
  frames(5);
  assert(game.drawCalls >= 5, `rendered ${game.drawCalls} frames`);
  assert(game.player && game.world && game.weapons, 'core systems exist');
  assert(game.world.boxes.length > 80, 'collision world populated');
});

test('pointer lock engages on click and the HUD reflects it', () => {
  canvas.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  canvas.requestPointerLock();
  frames(2);
  assert(game.input.locked, 'input is locked after the click');
});

test('holding W moves the player and updates the stance readout', () => {
  const start = game.player.pos.clone();
  key('keydown', 'KeyW');
  frames(60);
  const moved = game.player.pos.distanceTo(start);
  assert(moved > 2, `player moved ${moved.toFixed(2)}m`);
  const stance = window.document.getElementById('stance').textContent;
  assert(/JOG|RUN|WALK/i.test(stance), `stance readout says "${stance}"`);
});

test('shift sprints and drains stamina', () => {
  const before = game.state.stamina;
  key('keydown', 'ShiftLeft');
  frames(90);
  assert(game.player.sprinting, 'sprinting');
  assert(game.state.stamina < before, 'stamina drained');
  const stance = window.document.getElementById('stance').textContent;
  assert(/SPRINT/i.test(stance), `stance readout says "${stance}"`);
  key('keyup', 'ShiftLeft');
  frames(2);
});

test('crouch changes the capsule and the readout', () => {
  key('keydown', 'ControlLeft');
  frames(30);
  assert(game.player.stance === 'crouch', 'crouched');
  assert(/CROUCH/i.test(window.document.getElementById('stance').textContent), 'readout');
  key('keyup', 'ControlLeft');
  frames(30);
  assert(game.player.stance === 'stand', 'stood back up');
});

test('sprint + crouch slides, and the HUD says so', () => {
  // Reset to the spawn and face the longest clear stretch of road.
  const lane = clearestHeading(SPAWN);
  assert(lane.dist > 12, `found ${lane.dist.toFixed(1)}m of clear road`);
  game.player.setPosition(SPAWN.x, SPAWN.y, SPAWN.z, lane.yaw);
  game.camCtrl.yaw = game.camCtrl.yawTarget = lane.yaw;
  game.state.stamina = game.state.maxStamina;   // the earlier sprints drained it
  frames(2);
  key('keydown', 'ShiftLeft');
  frames(90);                                   // get back up to sprint speed
  assert(game.player.sprinting, 'sprinting before the slide');
  assert(game.player.speed > 5.4, `at slide speed (${game.player.speed.toFixed(2)} m/s)`);
  key('keydown', 'ControlLeft');
  frames(2);
  assert(game.player.motion === 'slide',
    `motion is ${game.player.motion} (speed ${game.player.speed.toFixed(2)}, stamina ${game.state.stamina.toFixed(0)})`);
  assert(/SLID/i.test(window.document.getElementById('stance').textContent), 'stance readout');
  key('keyup', 'ControlLeft');
  key('keyup', 'ShiftLeft');
  for (let i = 0; i < 180 && game.player.motion === 'slide'; i++) frames(1);
  assert(game.player.motion === 'ground', 'slide resolved back to normal movement');
  assert(game.player.stance === 'stand', 'stood back up');
  frames(40);
});

test('space jumps', () => {
  key('keydown', 'Space');
  frames(6);
  assert(!game.player.grounded, 'airborne');
  key('keyup', 'Space');
  frames(90);
  assert(game.player.grounded, 'landed again');
  key('keyup', 'KeyW');
  frames(10);
});

test('the camera follows behind the player', () => {
  const p = game.player.pos, c = game.camera.position;
  const d = Math.hypot(c.x - p.x, c.z - p.z);
  assert(d > 1.5 && d < 12, `camera is ${d.toFixed(2)}m from the player`);
  assert(c.y > p.y, 'camera sits above the player');
});

test('mouse look turns the camera', () => {
  const yaw0 = game.camCtrl.yaw;
  for (let i = 0; i < 10; i++) {
    const e = new window.MouseEvent('mousemove', { bubbles: true });
    Object.defineProperty(e, 'movementX', { value: 20 });
    Object.defineProperty(e, 'movementY', { value: 0 });
    window.document.dispatchEvent(e);
    frames(1);
  }
  assert(Math.abs(game.camCtrl.yaw - yaw0) > 0.05, 'camera yaw changed');
});

test('Q swaps the camera shoulder', () => {
  const side = game.camCtrl.shoulder ?? game.settings.shoulderSide;
  key('keydown', 'KeyQ'); frames(2); key('keyup', 'KeyQ'); frames(20);
  const after = game.camCtrl.shoulder ?? game.settings.shoulderSide;
  assert(after !== side, 'shoulder side flipped');
});

test('melee swings and the animation plays out', () => {
  key('keydown', 'KeyF'); frames(2); key('keyup', 'KeyF');
  assert(game.player.attack.active, 'attack started');
  frames(60);
  assert(!game.player.attack.active, 'attack finished');
});

test('drawing a firearm updates the weapon HUD and the crosshair', () => {
  game.state.inventory.pistol = 1;
  game.state.ammo.mag = 0; game.state.ammo.reserve = 0;   // a fresh purchase
  game.state.equipWeapon('pistol');
  game.weapons.sync();
  assert(game.state.ammo.mag > 0, 'a bought firearm comes with a loaded magazine');
  game._syncWeaponVisual();
  key('keydown', 'KeyG'); frames(2); key('keyup', 'KeyG'); frames(10);
  assert(game.weapons.drawn, 'weapon drawn');
  const hud = window.document.getElementById('weapon-hud');
  assert(!hud.classList.contains('hidden'), 'weapon HUD is visible');
  assert(/9mm/.test(hud.textContent), `HUD reads "${hud.textContent}"`);
  const cross = window.document.getElementById('crosshair');
  assert(!cross.classList.contains('hidden'), 'crosshair visible with a drawn weapon');
});

test('aiming narrows the crosshair and raises the vignette', () => {
  mouse('mousedown', 2);
  frames(40);
  assert(game.player.aiming, 'player is aiming');
  const gap = parseFloat(window.document.getElementById('crosshair').style.getPropertyValue('--gap'));
  assert(gap >= 0 && gap < 20, `aim crosshair gap is ${gap}`);
  assert(parseFloat(window.document.getElementById('vignette').style.opacity) > 0.1, 'aim vignette');
  mouse('mouseup', 2);
  frames(20);
});

test('firing consumes ammo and reloading refills the magazine', () => {
  const mag0 = game.state.ammo.mag;
  mouse('mousedown', 0); frames(3); mouse('mouseup', 0); frames(6);
  assert(game.state.ammo.mag === mag0 - 1, `fired one round (${mag0} -> ${game.state.ammo.mag})`);
  game.state.ammo.mag = 2;
  key('keydown', 'KeyR'); frames(2); key('keyup', 'KeyR');
  frames(150);
  assert(game.state.ammo.mag > 2, `reloaded to ${game.state.ammo.mag}`);
  key('keydown', 'KeyG'); frames(2); key('keyup', 'KeyG'); frames(5);
});

test('the pause menu opens, renders tabs and closes', () => {
  key('keydown', 'Escape'); frames(2); key('keyup', 'Escape'); frames(4);
  assert(game.ui.menuOpen, 'menu open');
  assert(!window.document.getElementById('menu').classList.contains('hidden'), 'menu visible');
  for (const tab of ['inventory', 'missions', 'map', 'settings', 'main']) {
    game.ui.openMenu(tab);
    assert(window.document.getElementById('menu-content').innerHTML.length > 20, `${tab} tab rendered`);
  }
  key('keydown', 'Escape'); frames(2); key('keyup', 'Escape'); frames(4);
  assert(!game.ui.menuOpen, 'menu closed');
});

test('settings from the menu reach the controller', () => {
  game.applySettings({ sensitivity: 1.7, invertY: true, toggleCrouch: true, shoulderSide: -1 });
  frames(2);
  assert(game.settings.sensitivity === 1.7 && game.player.settings.sensitivity === 1.7, 'player sees the new sensitivity');
  assert(game.input.settings.invertY === true, 'input sees invert Y');
  game.applySettings({ toggleCrouch: false, invertY: false, sensitivity: 1 });
});

test('vehicles can be entered and driven, then exited', () => {
  const v = game.vehicles[0];
  game._enterVehicle(v);
  frames(10);
  assert(game.player.inVehicle === v, 'in the car');
  assert(/Get out/.test(window.document.getElementById('interact-prompt').textContent),
    'driving shows the vehicle prompt, not world prompts');
  key('keydown', 'KeyW');
  frames(120);
  assert(Math.abs(v.speed) > 1, `car is moving at ${v.speed.toFixed(2)} m/s`);
  assert(v.rpm > 0 && v.engineOn, 'the engine is running under load');
  key('keyup', 'KeyW');

  // You cannot step out of a moving car, so brake to a stop first.
  game._exitVehicle();
  assert(game.player.inVehicle === v, 'bailing out at speed is refused');
  key('keydown', 'KeyS');
  for (let i = 0; i < 600 && v.speed > 0.4; i++) frames(1);   // hold the brake
  key('keyup', 'KeyS');                                        // ...then let it go,
  frames(30);                                                  // or it reverses away
  assert(Math.abs(v.speed) < 1, `braked to a stop (${v.speed.toFixed(2)} m/s)`);

  game._exitVehicle();
  frames(10);
  assert(!game.player.inVehicle, 'back on foot');
  assert(game.world.isFree(game.player.pos.x, game.player.pos.y + 0.1, game.player.pos.z, 0.3, 1.5),
    'the player was dropped somewhere legal');
});

test('entering a building teleports inside and the exit works', () => {
  const door = game.builder.doors.find(d => d.kind === 'enter');
  game._enterInterior(door);
  for (let i = 0; i < 90; i++) frames(1);
  assert(game.insideInterior === door.interior, `inside ${door.interior}`);
  const exit = game.builder.doors.find(d => d.kind === 'exit' && d.exit);
  game._exitInterior(exit);
  for (let i = 0; i < 90; i++) frames(1);
  assert(!game.insideInterior, 'back outside');
});

test('contextual prompts appear next to interactables', () => {
  const npc = game.npcMgr.all.find(n => !n.isEnemy);
  const back = game.player.pos.clone();
  game.player.setPosition(npc.pos.x, 0, npc.pos.z + 1.6, Math.PI);
  game.camCtrl.yaw = game.camCtrl.yawTarget = Math.PI;
  frames(6);
  const prompt = window.document.getElementById('interact-prompt');
  assert(!prompt.classList.contains('hidden'), 'a prompt is visible near an NPC');
  assert(/E/.test(prompt.textContent), `prompt reads "${prompt.textContent}"`);
  game.player.setPosition(back.x, back.y, back.z, game.player.rot);
  frames(2);
});

test('ladders are offered and can be climbed from the prompt', () => {
  const l = game.world.ladders[0];
  const bx = l.x - Math.sin(l.yaw) * 0.6, bz = l.z - Math.cos(l.yaw) * 0.6;
  game.player.setPosition(bx, l.bottom, bz, l.yaw);
  game.camCtrl.yaw = game.camCtrl.yawTarget = l.yaw;
  frames(6);
  const prompt = window.document.getElementById('interact-prompt').textContent;
  assert(/climb|ladder/i.test(prompt), `ladder prompt reads "${prompt}"`);
  key('keydown', 'KeyE'); frames(2); key('keyup', 'KeyE'); frames(4);
  assert(game.player.motion === 'ladder', 'attached to the ladder');
  key('keydown', 'KeyW');
  for (let i = 0; i < 60 * 8 && game.player.motion !== 'ground'; i++) frames(1);
  key('keyup', 'KeyW');
  frames(30);
  assert(game.player.pos.y > l.top - 1.2, `climbed to y=${game.player.pos.y.toFixed(2)} (top ${l.top})`);
});

test('the fleet is parked around town, out of the walls and ready to drive', () => {
  const fleet = game.vehicleMgr.vehicles;
  assert(fleet.length >= 20, `only ${fleet.length} vehicles spawned`);
  const classes = new Set(fleet.map(v => v.class));
  for (const c of ['car', 'motorcycle', 'truck', 'van', 'bus', 'emergency']) {
    assert(classes.has(c), `the town has no ${c}`);
  }
  // nothing should be parked inside a building
  for (const v of fleet) {
    const boxes = game.world.query(v.pos.x - 4, v.pos.z - 4, v.pos.x + 4, v.pos.z + 4, []);
    for (const b of boxes) {
      if (b.maxY < v.def.wheelRadius || b.minY > v.def.wheelRadius + v.def.height) continue;
      const inside = v.pos.x > b.minX && v.pos.x < b.maxX && v.pos.z > b.minZ && v.pos.z < b.maxZ;
      assert(!inside, `${v.type} is parked inside a building at ${v.pos.x.toFixed(0)}, ${v.pos.z.toFixed(0)}`);
    }
  }
});

test('different vehicle classes feel genuinely different to drive', () => {
  // Put each one on the same clear stretch of road facing the same way, so the
  // only thing that differs between the runs is the vehicle itself.
  const lane = clearestHeading(SPAWN);
  const run = (type) => {
    const v = game.vehicleMgr.spawn(type,
      SPAWN.x + Math.sin(lane.yaw) * 5, SPAWN.z + Math.cos(lane.yaw) * 5, lane.yaw);
    assert(v, `could not spawn a ${type}`);
    game.player.setPosition(v.pos.x, 0, v.pos.z, lane.yaw);
    game._enterVehicle(v);
    frames(5);
    v.fuel = v.fuelCapacity;
    key('keydown', 'KeyW');
    frames(300);                       // 5 seconds flat out
    const speed = v.speedKmh();
    key('keyup', 'KeyW');
    key('keydown', 'KeyS');
    for (let i = 0; i < 900 && v.speed > 0.4; i++) frames(1);
    key('keyup', 'KeyS');
    frames(20);
    game._exitVehicle();
    frames(5);
    assert(!game.player.inVehicle, `could not get out of the ${type}`);
    assert(v.health > 90, `the ${type} crashed during its run (${v.health.toFixed(0)}% body)`);
    // take the test vehicle back out of the world
    v.remove();
    game.vehicleMgr.vehicles.splice(game.vehicleMgr.vehicles.indexOf(v), 1);
    return speed;
  };
  const sports = run('sports');
  const bus = run('citybus');
  assert(sports > bus * 1.8, `after 5 s: sports ${sports.toFixed(0)} km/h vs bus ${bus.toFixed(0)} km/h`);
});

test('the instrument cluster appears while driving and reads out the vehicle', () => {
  const doc = window.document;
  const hud = doc.getElementById('vehicle-hud');
  assert(hud.classList.contains('hidden'), 'the cluster is visible on foot');

  const v = game.vehicleMgr.vehicles.find(x => x.type === 'pickup');
  game.player.setPosition(v.pos.x, 0, v.pos.z + 3, Math.PI);
  game._enterVehicle(v);
  v.fuel = v.fuelCapacity * 0.5;
  frames(5);
  assert(!hud.classList.contains('hidden'), 'the cluster stayed hidden while driving');

  // the performance card is dealt on entry and lists measured figures
  const card = doc.getElementById('vehicle-card');
  assert(!card.classList.contains('hidden'), 'no performance card on entry');
  assert(doc.getElementById('vc-name').textContent === v.name, 'the card names the wrong vehicle');
  assert(doc.getElementById('vc-bars').children.length >= 5, 'the card has no stat bars');
  assert(/km\/h/.test(doc.getElementById('vc-figures').textContent), 'the card lists no figures');

  assert(doc.getElementById('vh-name').textContent === v.name, 'the cluster shows the wrong vehicle');

  key('keydown', 'KeyW');
  frames(240);
  key('keyup', 'KeyW');
  const shown = parseInt(doc.getElementById('vh-speed').textContent, 10);
  assert(Math.abs(shown - v.speedKmh()) < 2, `speedo reads ${shown} but the truck is doing ${v.speedKmh().toFixed(0)}`);
  assert(doc.getElementById('vh-gear').textContent !== 'N', 'the gear readout never left neutral');
  const fuelWidth = parseFloat(doc.getElementById('vh-fuel').style.width);
  assert(fuelWidth > 30 && fuelWidth < 70, `fuel gauge reads ${fuelWidth}% on a half tank`);

  key('keydown', 'KeyS');
  for (let i = 0; i < 900 && v.speed > 0.4; i++) frames(1);
  key('keyup', 'KeyS');
  frames(20);
  game._exitVehicle();
  frames(5);
  assert(hud.classList.contains('hidden'), 'the cluster stayed up after getting out');
});

test('fuel is consumed while driving and can be bought at a pump', () => {
  const v = game.vehicleMgr.vehicles.find(x => x.def.fuelType === 'petrol' && x.class === 'car');
  game.player.setPosition(v.pos.x, 0, v.pos.z + 3, Math.PI);
  game._enterVehicle(v);
  v.fuel = 20;
  frames(5);
  key('keydown', 'KeyW');
  frames(420);
  key('keyup', 'KeyW');
  assert(v.fuel < 20, `fuel did not drop (still ${v.fuel.toFixed(2)} L)`);

  // park on the forecourt and fill up
  const station = game.vehicleMgr.nearestStation(v.pos, v);
  assert(station, 'no pump sells petrol');
  v.pos.set(station.pos.x + 1, 0, station.pos.z + 1);
  v.speed = 0; v.vel.set(0, 0, 0);
  game.state.money = 500;
  const before = v.fuel;
  game._refuelVehicle(v, station);
  assert(v.fuel > before, 'refuelling added nothing');
  assert(game.state.money < 500, 'the fuel was free');

  game._exitVehicle();
  frames(5);
});

test('stealing a police car raises the wanted level', () => {
  const wantedBefore = game.state.wanted;
  const cop = game.vehicleMgr.vehicles.find(x => x.class === 'emergency');
  game.player.setPosition(cop.pos.x, 0, cop.pos.z + 3, Math.PI);
  game._enterVehicle(cop);
  frames(5);
  assert(game.state.wanted > wantedBefore, 'nobody noticed the stolen emergency vehicle');
  cop.speed = 0; cop.vel.set(0, 0, 0);
  game._exitVehicle();
  frames(5);
  game.state.setWanted(0);
  game.npcMgr.clearEnemies();
  game.cops = [];
});

test('vehicle condition survives a save and load', () => {
  const v = game.vehicleMgr.vehicles[2];
  v.fuel = 9.5; v.health = 55; v.pos.set(40, 0, -20);
  game.save();
  v.fuel = 60; v.health = 100; v.pos.set(0, 0, 0);
  game.load(true);
  frames(2);
  assert(Math.abs(v.fuel - 9.5) < 0.01, `fuel came back as ${v.fuel}`);
  assert(Math.abs(v.health - 55) < 0.01, `health came back as ${v.health}`);
  // it is restored to (40, -20) and then pushed clear of anything it overlaps
  assert(Math.abs(v.pos.x - 40) < 10 && Math.abs(v.pos.z + 20) < 10,
    `position came back as ${v.pos.x.toFixed(1)}, ${v.pos.z.toFixed(1)}`);
});

test('save and load round-trip through localStorage', () => {
  game.state.money = 4242;
  game.save();
  game.state.money = 0;
  game.load(true);
  frames(2);
  assert(game.state.money === 4242, `money restored: ${game.state.money}`);
});

test('nothing threw during ~20 seconds of simulated play', () => {
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.message));
  key('keydown', 'KeyW'); key('keydown', 'ShiftLeft');
  frames(600);
  key('keyup', 'KeyW'); key('keyup', 'ShiftLeft');
  frames(60);
  assert(errors.length === 0, errors.join('; '));
  assert(Number.isFinite(game.player.pos.x) && Number.isFinite(game.player.pos.y), 'player position is finite');
  assert(game.drawCalls > 1000, `rendered ${game.drawCalls} frames in total`);
});

console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
