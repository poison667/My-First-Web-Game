// ---------------------------------------------------------------------------
// Vehicle system tests.
//
// These drive the real simulation rather than inspecting fields: a vehicle is
// spawned, the controls are held, and the resulting motion is measured. The
// point is to prove that the physics produces believable, *distinct* behaviour
// per vehicle class — a bus must not handle like a sport bike.
//
//   npm run test:vehicles
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import {
  VEHICLES, VEHICLE_IDS, VEHICLE_SPAWNS, FUEL_STATIONS,
  engineTorque, rpmForSpeed, speedForRpm, topSpeed, turningCircle, tractionShare,
} from '../src/data/vehicles.js';
import { Vehicle, obbAabbOverlap, obbObbOverlap } from '../src/entities/Vehicle.js';
import { VehicleManager } from '../src/systems/VehicleManager.js';
import { CollisionWorld } from '../src/systems/Physics.js';
import { CONFIG } from '../src/config.js';

let passed = 0, failed = 0;
const results = [];
function test(name, fn) {
  try { fn(); passed++; results.push(`  ✓ ${name}`); }
  catch (e) { failed++; results.push(`  ✗ ${name}\n      ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function close(a, b, tol, m) {
  if (Math.abs(a - b) > tol) throw new Error(`${m || 'value'}: ${a.toFixed(2)} vs ${b.toFixed(2)} (tol ${tol})`);
}

// --- harness ---------------------------------------------------------------

const EMPTY_WORLD = { query: () => [] };

/** Minimal stand-in for the Input class. */
function stick(x = 0, z = 0, held = {}, edges = {}) {
  return {
    move: { x, z },
    down: (a) => !!held[a],
    pressed: (a) => { const v = !!edges[a]; edges[a] = false; return v; },
  };
}

function make(type, opts = {}) {
  const v = new Vehicle(null, 0, 0, type, { fuel: VEHICLES[type].fuelCapacity, ...opts });
  v.occupied = true;
  v.startEngine();
  return v;
}

/** Run `seconds` of simulation with a fixed control input. */
function drive(v, input, seconds, world = EMPTY_WORLD, opts = {}) {
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) v.update(dt, input, world, opts);
  return v;
}

/** Accelerate flat out until `predicate` is true (or time runs out). */
function driveUntil(v, input, predicate, maxSeconds = 90, world = EMPTY_WORLD) {
  const dt = 1 / 60;
  let t = 0;
  while (t < maxSeconds) {
    v.update(dt, input, world, {});
    t += dt;
    if (predicate(v, t)) return t;
  }
  return null;
}

// ===========================================================================
// Catalogue
// ===========================================================================

test('the catalogue covers every requested vehicle category', () => {
  const classes = new Set(VEHICLE_IDS.map((id) => VEHICLES[id].class));
  for (const c of ['car', 'motorcycle', 'truck', 'van', 'bus', 'emergency']) {
    assert(classes.has(c), `no ${c} in the catalogue`);
  }
  const bodies = new Set(VEHICLE_IDS.map((id) => VEHICLES[id].body));
  assert(bodies.size >= 12, `only ${bodies.size} distinct body styles`);
  assert(VEHICLE_IDS.length >= 16, `only ${VEHICLE_IDS.length} vehicles`);
});

test('every spec is physically complete and self-consistent', () => {
  const required = ['mass', 'power', 'peakTorque', 'redline', 'gears', 'finalDrive', 'wheelRadius',
    'drag', 'rollResist', 'brakeForce', 'handbrake', 'grip', 'weightFront', 'wheelbase', 'track',
    'length', 'width', 'height', 'steerAngle', 'steerSpeed', 'drive', 'fuelType', 'fuelCapacity',
    'fuelBurn', 'idleBurn', 'armour', 'seats', 'class', 'body', 'colours', 'desc', 'name'];
  for (const id of VEHICLE_IDS) {
    const d = VEHICLES[id];
    for (const k of required) assert(d[k] !== undefined, `${id} is missing ${k}`);
    assert(d.gears.length >= 1, `${id} has no gear ratios`);
    for (let i = 1; i < d.gears.length; i++) {
      assert(d.gears[i] < d.gears[i - 1], `${id} gear ${i + 1} is not taller than gear ${i}`);
    }
    assert(d.weightFront > 0.2 && d.weightFront < 0.8, `${id} weight distribution is absurd`);
    assert(d.wheelbase < d.length, `${id} wheelbase is longer than the vehicle`);
    assert(d.track < d.width, `${id} track is wider than the vehicle`);
    assert(['fwd', 'rwd', 'awd'].includes(d.drive), `${id} has a bad drive layout`);
    assert(['petrol', 'diesel', 'electric'].includes(d.fuelType), `${id} has a bad fuel type`);
    assert(d.fuelBurn > d.idleBurn, `${id} burns less at full load than at idle`);
    assert(d.colours.length > 0, `${id} has no paint`);
  }
});

test('the torque curve peaks in the mid range and never goes negative', () => {
  for (const id of VEHICLE_IDS) {
    const d = VEHICLES[id];
    let peak = 0, peakAt = 0;
    for (let rpm = 0; rpm <= d.redline; rpm += d.redline / 100) {
      const t = engineTorque(d, rpm);
      assert(t > 0, `${id} makes no torque at ${rpm.toFixed(0)} rpm`);
      if (t > peak) { peak = t; peakAt = rpm; }
    }
    const frac = peakAt / d.redline;
    assert(frac > 0.4 && frac < 0.85, `${id} peak torque at ${(frac * 100).toFixed(0)}% of the redline`);
    close(peak, d.peakTorque, d.peakTorque * 0.02, `${id} peak torque`);
  }
});

test('gearing maths round-trips between road speed and engine speed', () => {
  for (const id of VEHICLE_IDS) {
    const d = VEHICLES[id];
    for (let g = 0; g < d.gears.length; g++) {
      const v = 14;
      const rpm = rpmForSpeed(d, g, v);
      close(speedForRpm(d, g, rpm), v, 1e-6, `${id} gear ${g + 1} round-trip`);
    }
    // a taller gear must mean fewer revs at the same road speed
    for (let g = 1; g < d.gears.length; g++) {
      assert(rpmForSpeed(d, g, 20) < rpmForSpeed(d, g - 1, 20), `${id} gear ${g + 1} revs higher than ${g}`);
    }
  }
});

test('every vehicle spawn points at a real location and a real type', () => {
  for (const s of VEHICLE_SPAWNS) assert(VEHICLES[s.type], `spawn references unknown type ${s.type}`);
  for (const s of FUEL_STATIONS) {
    assert(s.kinds.length > 0, `${s.name} sells nothing`);
    for (const k of s.kinds) assert(['petrol', 'diesel', 'electric'].includes(k), `bad fuel kind ${k}`);
  }
  // every fuel type in the catalogue must be purchasable somewhere
  const sold = new Set(FUEL_STATIONS.flatMap((s) => s.kinds));
  for (const id of VEHICLE_IDS) {
    assert(sold.has(VEHICLES[id].fuelType), `nowhere sells ${VEHICLES[id].fuelType} for the ${id}`);
  }
});

// ===========================================================================
// Acceleration, top speed, braking
// ===========================================================================

test('every vehicle pulls away from rest under throttle', () => {
  for (const id of VEHICLE_IDS) {
    const v = make(id);
    drive(v, stick(0, -1), 3);
    assert(v.speed > 1.0, `${id} only reached ${v.speed.toFixed(2)} m/s after 3 s`);
    assert(v.pos.z > 1.0, `${id} did not actually move (z = ${v.pos.z.toFixed(2)})`);
  }
});

test('top speed settles near the specification and respects the limiter', () => {
  for (const id of VEHICLE_IDS) {
    const v = make(id);
    drive(v, stick(0, -1), 120);
    const kmh = v.speed * 3.6;
    const spec = topSpeed(VEHICLES[id]) * 3.6;
    assert(kmh <= spec * 1.05 + 2, `${id} exceeded its spec top speed: ${kmh.toFixed(0)} > ${spec.toFixed(0)}`);
    assert(kmh > spec * 0.80, `${id} fell well short of its top speed: ${kmh.toFixed(0)} vs ${spec.toFixed(0)}`);
    if (VEHICLES[id].limiter) {
      assert(kmh <= VEHICLES[id].limiter + 1, `${id} blew through its ${VEHICLES[id].limiter} km/h limiter`);
    }
  }
});

test('acceleration ranks the fleet the way the spec sheet does', () => {
  const t = {};
  for (const id of ['sports', 'police', 'muscle', 'sedan', 'hatchback', 'van', 'citybus']) {
    const v = make(id);
    t[id] = driveUntil(v, stick(0, -1), (veh) => veh.speed * 3.6 >= 80, 120);
    assert(t[id] != null, `${id} never reached 80 km/h`);
  }
  assert(t.sports < t.muscle, `sports (${t.sports.toFixed(1)}s) should beat the muscle car (${t.muscle.toFixed(1)}s)`);
  assert(t.muscle < t.sedan, 'the muscle car should beat the saloon');
  assert(t.sedan < t.van, 'the saloon should beat the van');
  assert(t.van < t.citybus, 'the van should beat the bus');
  assert(t.police < t.sedan, 'the interceptor should beat the civilian saloon it is based on');
  assert(t.citybus > t.sports * 4, 'a bus should be dramatically slower than a sports car');
});

test('a scooter cannot reach motorway speed but a superbike can', () => {
  const scooter = make('scooter');
  drive(scooter, stick(0, -1), 90);
  assert(scooter.speed * 3.6 < 95, `the scooter hit ${(scooter.speed * 3.6).toFixed(0)} km/h`);

  const bike = make('motorcycle');
  const t = driveUntil(bike, stick(0, -1), (v) => v.speed * 3.6 >= 160, 60);
  assert(t != null && t < 15, `the superbike took ${t} s to reach 160 km/h`);
});

test('braking distance scales with mass and matches the friction limit', () => {
  const measured = {};
  for (const id of ['sports', 'hatchback', 'van', 'boxtruck', 'citybus']) {
    const v = make(id);
    const from = 100 / 3.6;
    v.speed = from; v.vel.set(0, 0, from); v.rot = 0;
    let dist = 0;
    const dt = 1 / 120;
    for (let i = 0; i < 6000 && v.speed > 0.2; i++) {
      v.update(dt, stick(0, 1), EMPTY_WORLD, {});
      dist += Math.max(0, v.speed) * dt;
    }
    measured[id] = dist;
    // physics floor: you cannot stop shorter than the tyres allow
    const floor = (from * from) / (2 * VEHICLES[id].grip * 9.81) * 0.9;
    assert(dist > floor, `${id} stopped in ${dist.toFixed(1)} m, shorter than the ${floor.toFixed(1)} m grip limit`);
    assert(dist < 120, `${id} needed ${dist.toFixed(0)} m to stop`);
  }
  assert(measured.sports < measured.hatchback, 'the sports car should out-brake the hatchback');
  assert(measured.hatchback < measured.van, 'the hatchback should out-brake the van');
  assert(measured.van < measured.boxtruck, 'the van should out-brake the box truck');
  assert(measured.boxtruck < measured.citybus + 6, 'the truck should not need far more room than the bus');
});

test('the handbrake stops a rolling vehicle and locks a parked one', () => {
  const v = make('sedan');
  drive(v, stick(0, -1), 6);
  const before = v.speed;
  assert(before > 8, 'did not get up to speed');
  drive(v, stick(0, 0, { jump: true }), 6);
  assert(Math.abs(v.speed) < 1.0, `handbrake left it rolling at ${v.speed.toFixed(2)} m/s`);
});

// ===========================================================================
// Steering and handling character
// ===========================================================================

test('full lock at parking speed traces the specified turning circle', () => {
  for (const id of ['hatchback', 'sedan', 'citybus', 'scooter']) {
    const v = make(id);
    const dt = 1 / 120;
    const hold = () => stick(-1, v.speed < 2.2 ? -0.35 : 0);
    for (let i = 0; i < 480; i++) v.update(dt, hold(), EMPTY_WORLD, {});
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let turned = 0, prev = v.rot;
    for (let i = 0; i < 12000 && turned < Math.PI * 2; i++) {
      v.update(dt, hold(), EMPTY_WORLD, {});
      let d = v.rot - prev;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      turned += Math.abs(d); prev = v.rot;
      minX = Math.min(minX, v.pos.x); maxX = Math.max(maxX, v.pos.x);
      minZ = Math.min(minZ, v.pos.z); maxZ = Math.max(maxZ, v.pos.z);
    }
    assert(turned >= Math.PI * 2 - 0.2, `${id} never completed a full circle`);
    const diameter = Math.max(maxX - minX, maxZ - minZ);
    const spec = turningCircle(VEHICLES[id]);
    assert(diameter > spec * 0.6 && diameter < spec * 1.6,
      `${id} circle was ${diameter.toFixed(1)} m against a spec of ${spec.toFixed(1)} m`);
  }
});

test('big vehicles need far more room to turn than small ones', () => {
  const circles = {};
  for (const id of ['scooter', 'motorcycle', 'hatchback', 'citybus', 'firetruck']) {
    circles[id] = turningCircle(VEHICLES[id]);
  }
  assert(circles.scooter < circles.hatchback, 'a scooter should turn tighter than a car');
  assert(circles.hatchback < circles.citybus, 'a hatchback should turn tighter than a bus');
  assert(circles.citybus > 20, 'a bus should need a lot of road');
  assert(circles.motorcycle < 8, 'a motorcycle should turn on a coin');
});

test('steering lock tightens with speed so the car stays stable', () => {
  const slow = make('sedan');
  drive(slow, stick(0, -0.3), 2);
  drive(slow, stick(-1, 0), 1.0);
  const slowAngle = Math.abs(slow.steerAngle);

  const fast = make('sedan');
  drive(fast, stick(0, -1), 20);
  drive(fast, stick(-1, 0), 1.0);
  const fastAngle = Math.abs(fast.steerAngle);

  assert(fastAngle < slowAngle * 0.7,
    `lock barely changed with speed (${slowAngle.toFixed(3)} slow vs ${fastAngle.toFixed(3)} fast)`);
});

test('the handbrake breaks rear traction and swings the back out', () => {
  const v = make('muscle');
  drive(v, stick(0, -1), 8);
  const straight = make('muscle');
  drive(straight, stick(0, -1), 8);

  drive(v, stick(-0.9, 0, { jump: true }), 1.4);
  drive(straight, stick(-0.9, 0), 1.4);

  assert(Math.abs(v.slipAngle) > Math.abs(straight.slipAngle) * 1.5,
    `handbrake slip ${v.slipAngle.toFixed(3)} vs grip-driving ${straight.slipAngle.toFixed(3)}`);
  assert(v.skid > 0.3, `tyres never let go (skid ${v.skid.toFixed(2)})`);
});

test('a heavy vehicle resists direction changes more than a light one', () => {
  const rates = {};
  for (const id of ['motorcycle', 'hatchback', 'citybus']) {
    const v = make(id);
    driveUntil(v, stick(0, -1), (veh) => veh.speed > 11, 60);
    drive(v, stick(-1, 0), 1.0);
    rates[id] = Math.abs(v.yawRate);
  }
  assert(rates.motorcycle > rates.hatchback, 'a bike should change direction faster than a car');
  assert(rates.hatchback > rates.citybus, 'a car should change direction faster than a bus');
});

test('vehicles track straight when the wheel is centred', () => {
  for (const id of ['sedan', 'pickup', 'citybus']) {
    const v = make(id);
    v.rot = 0;
    drive(v, stick(0, -1), 15);
    assert(Math.abs(v.pos.x) < 0.5, `${id} wandered ${v.pos.x.toFixed(2)} m sideways`);
    assert(Math.abs(v.rot) < 0.05, `${id} drifted ${v.rot.toFixed(3)} rad off course`);
  }
});

// ===========================================================================
// Gearbox
// ===========================================================================

test('the automatic gearbox works up through the ratios and back down', () => {
  const v = make('sedan');
  const seen = new Set();
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 40; i++) { v.update(dt, stick(0, -1), EMPTY_WORLD, {}); seen.add(v.gear); }
  assert(v.gear >= VEHICLES.sedan.gears.length - 1, `only reached gear ${v.gear}`);
  assert(seen.size >= 4, `only used ${seen.size} gears on the way up`);
  assert(v.rpm <= VEHICLES.sedan.redline + 1, 'the engine went past the redline');

  // slow down and it must come back down the box
  for (let i = 0; i < 60 * 14; i++) v.update(dt, stick(0, 1), EMPTY_WORLD, {});
  assert(v.gear < 3, `still in gear ${v.gear} after braking to ${(v.speed * 3.6).toFixed(0)} km/h`);
});

test('an electric vehicle has one ratio and no shifting', () => {
  const v = make('ev_compact');
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 25; i++) v.update(dt, stick(0, -1), EMPTY_WORLD, {});
  assert(v.gearCount === 1, 'the EV has a gearbox');
  assert(v.gear === 1, `the EV changed to gear ${v.gear}`);
  assert(v.gearLabel() === 'D', `EV gear display reads ${v.gearLabel()}`);
});

test('manual shifting with Z and X overrides the automatic', () => {
  const v = make('sedan');
  drive(v, stick(0, -1), 6);
  const before = v.gear;
  const edges = { gearDown: true };
  v.update(1 / 60, stick(0, -1, {}, edges), EMPTY_WORLD, {});
  assert(v.gear === Math.max(0, before - 1), `Z did not change down (${before} -> ${v.gear})`);
  assert(v.automatic === false, 'the gearbox stayed in automatic');

  const up = { gearUp: true };
  const now = v.gear;
  v.update(1 / 60, stick(0, -1, {}, up), EMPTY_WORLD, {});
  assert(v.gear === now + 1, `X did not change up (${now} -> ${v.gear})`);
});

test('reverse engages from a standstill and is speed-limited', () => {
  const v = make('hatchback');
  drive(v, stick(0, 1), 8);
  assert(v.speed < -1, `did not reverse (${v.speed.toFixed(2)} m/s)`);
  assert(v.gear === 0 && v.gearLabel() === 'R', `gear display reads ${v.gearLabel()}`);
  assert(Math.abs(v.speed) <= v.reverseSpeed + 0.1, `reversed at ${Math.abs(v.speed).toFixed(1)} m/s`);
  assert(Math.abs(v.speed) < 13, 'reverse is far too quick');
});

test('braking from forward motion does not instantly slam into reverse', () => {
  const v = make('sedan');
  drive(v, stick(0, -1), 6);
  assert(v.speed > 8, 'not up to speed');
  const dt = 1 / 60;
  let crossed = false;
  for (let i = 0; i < 60 * 3; i++) {
    const prev = v.speed;
    v.update(dt, stick(0, 1), EMPTY_WORLD, {});
    if (prev > 0.5 && v.speed < -0.5) crossed = true;
  }
  assert(!crossed, 'the car jumped straight from forward to reverse in one frame');
});

// ===========================================================================
// Fuel and energy
// ===========================================================================

test('fuel burns while driving, and harder under load', () => {
  Vehicle.fuelScale = 1;
  const cruising = make('sedan');
  cruising.fuel = 40;
  drive(cruising, stick(0, -0.18), 30);
  const cruiseUsed = 40 - cruising.fuel;

  const thrashing = make('sedan');
  thrashing.fuel = 40;
  drive(thrashing, stick(0, -1), 30);
  const thrashUsed = 40 - thrashing.fuel;

  assert(cruiseUsed > 0, 'cruising used no fuel at all');
  assert(thrashUsed > cruiseUsed * 1.5,
    `full throttle (${thrashUsed.toFixed(3)} L) should drink far more than cruising (${cruiseUsed.toFixed(3)} L)`);
});

test('an idling engine burns fuel slowly but does burn it', () => {
  Vehicle.fuelScale = 1;
  const v = make('sedan');
  v.fuel = 30;
  drive(v, stick(0, 0), 60);
  const used = 30 - v.fuel;
  assert(used > 0.001, 'idling burned nothing');
  assert(used < VEHICLES.sedan.idleBurn * 1.2 / 60 + 0.05, `idling burned ${used.toFixed(3)} L in a minute`);
});

test('running dry stops the engine and the vehicle coasts to a halt', () => {
  Vehicle.fuelScale = 1;
  const v = make('hatchback');
  const events = [];
  v.onEvent = (n) => events.push(n);
  drive(v, stick(0, -1), 10);
  v.fuel = 0.001;
  drive(v, stick(0, -1), 2);
  assert(!v.engineOn, 'the engine kept running on an empty tank');
  assert(events.includes('out-of-fuel'), `events were ${events.join()}`);
  assert(v._driveForce() === 0, 'a dead engine still made power');
  const before = v.speed;
  drive(v, stick(0, -1), 8);
  assert(v.speed < before, 'the vehicle did not slow down with the engine off');
});

test('refuelling tops the tank back up and never overfills', () => {
  const v = make('van');
  v.fuel = 10;
  const taken = v.refuel(1000);
  assert(Math.abs(v.fuel - v.fuelCapacity) < 1e-6, `tank holds ${v.fuel} of ${v.fuelCapacity}`);
  assert(Math.abs(taken - (v.fuelCapacity - 10)) < 1e-6, `took ${taken} litres`);
  assert(v.refuel(50) === 0, 'a full tank accepted more fuel');
});

test('an electric vehicle recovers energy under regenerative braking', () => {
  Vehicle.fuelScale = 1;
  const v = make('ev_compact');
  drive(v, stick(0, -1), 12);
  const charge = v.fuel;
  const speedBefore = v.speed;
  drive(v, stick(0, 0), 4);        // lift off: regen should put charge back
  assert(v.speed < speedBefore, 'lifting off did not slow the EV');
  assert(v.fuel > charge, `charge fell from ${charge.toFixed(3)} to ${v.fuel.toFixed(3)} while regenerating`);
  assert(VEHICLES.ev_compact.regen > 0, 'the EV has no regen figure');
});

test('a damaged tank leaks fuel', () => {
  Vehicle.fuelScale = 1;
  const v = make('sedan');
  v.stopEngine();
  v.fuel = 40;
  v.tankHealth = 10;
  drive(v, stick(0, 0), 30);
  assert(v.fuel < 40, 'a holed tank did not leak');
});

test('the global fuel scale makes a tank a real constraint without faking the model', () => {
  assert(CONFIG.vehicle.fuelScale > 1, 'fuel scaling is not configured');
  Vehicle.fuelScale = CONFIG.vehicle.fuelScale;
  const v = make('hatchback');
  drive(v, stick(0, -1), 120);
  const used = v.fuelCapacity - v.fuel;
  assert(used > 1, `two minutes flat out used only ${used.toFixed(2)} L`);
  assert(v.fuel > 0, 'a full tank did not survive two minutes');
  Vehicle.fuelScale = 1;
});

// ===========================================================================
// Collisions and damage
// ===========================================================================

function wallWorld(box) {
  const boxes = [box];
  return { query: (minX, minZ, maxX, maxZ, out = []) => { out.length = 0; out.push(...boxes); return out; } };
}

test('a vehicle is stopped by a wall instead of driving through it', () => {
  const wall = { minX: -20, maxX: 20, minZ: 30, maxZ: 32, minY: 0, maxY: 4 };
  const v = make('sedan');
  v.rot = 0;
  drive(v, stick(0, -1), 12, wallWorld(wall));
  assert(v.pos.z + v.halfLength <= wall.minZ + 0.35,
    `the car ended at z=${v.pos.z.toFixed(2)} and is inside the wall at z=${wall.minZ}`);
  assert(v.health < 100, 'hitting a wall did no damage');
});

test('hitting a wall head-on damages the engine, not the fuel tank', () => {
  const wall = { minX: -20, maxX: 20, minZ: 26, maxZ: 28, minY: 0, maxY: 4 };
  const v = make('sedan');
  v.rot = 0;
  drive(v, stick(0, -1), 10, wallWorld(wall));
  assert(v.engineHealth < 100, 'a head-on crash left the engine untouched');
  assert(v.engineHealth < v.tankHealth, 'a front impact should hurt the engine more than the tank');
});

test('impact damage scales with speed and is softened by armour', () => {
  const makeCrash = (type, speed) => {
    const wall = { minX: -40, maxX: 40, minZ: 12, maxZ: 14, minY: 0, maxY: 4 };
    const v = make(type);
    v.rot = 0;
    v.speed = speed; v.vel.set(0, 0, speed);
    drive(v, stick(0, 0), 2.5, wallWorld(wall));
    return 100 - v.health;
  };
  const slow = makeCrash('sedan', 6);
  const fast = makeCrash('sedan', 22);
  assert(fast > slow * 2, `damage barely scaled with speed (${slow.toFixed(1)} vs ${fast.toFixed(1)})`);

  const soft = makeCrash('motorcycle', 16);
  const tough = makeCrash('firetruck', 16);
  assert(soft > tough, `a bike (${soft.toFixed(1)}) should suffer more than a fire truck (${tough.toFixed(1)})`);
});

test('enough abuse writes a vehicle off and kills the engine', () => {
  const wall = { minX: -40, maxX: 40, minZ: 14, maxZ: 16, minY: 0, maxY: 4 };
  const v = make('hatchback');
  const events = [];
  v.onEvent = (n) => events.push(n);
  for (let i = 0; i < 14 && !v.destroyed; i++) {
    v.pos.set(0, 0, 0); v.rot = 0;
    v.speed = 26; v.vel.set(0, 0, 26);
    drive(v, stick(0, 0), 1.5, wallWorld(wall));
  }
  assert(v.destroyed, `survived repeated 26 m/s crashes with ${v.health.toFixed(0)} health`);
  assert(!v.engineOn, 'a wrecked vehicle still has a running engine');
  assert(events.includes('destroyed'), 'no destroyed event was emitted');
});

test('a glancing blow scrapes along the wall rather than stopping dead', () => {
  const wall = { minX: 2, maxX: 40, minZ: -40, maxZ: 40, minY: 0, maxY: 4 };
  const v = make('sedan');
  v.rot = 0.08;                       // drifting gently into the wall
  v.pos.set(0.2, 0, 0);
  v.speed = 18; v.vel.set(Math.sin(v.rot) * 18, 0, Math.cos(v.rot) * 18);
  drive(v, stick(0, -0.6), 3, wallWorld(wall));
  assert(v.pos.z > 12, `scraping killed all the speed (only travelled ${v.pos.z.toFixed(1)} m)`);
  assert(v.pos.x + v.halfWidth <= wall.minX + 0.6, 'the car ended up inside the wall');
});

test('low kerbs are driven over and high overhangs are driven under', () => {
  const kerb = { minX: -20, maxX: 20, minZ: 10, maxZ: 11, minY: 0, maxY: 0.12 };
  const v = make('sedan');
  v.rot = 0;
  drive(v, stick(0, -1), 6, wallWorld(kerb));
  assert(v.pos.z > 12, `the kerb blocked the car at z=${v.pos.z.toFixed(1)}`);

  const sign = { minX: -20, maxX: 20, minZ: 10, maxZ: 11, minY: 3.0, maxY: 6 };
  const v2 = make('sedan');
  v2.rot = 0;
  drive(v2, stick(0, -1), 6, wallWorld(sign));
  assert(v2.pos.z > 12, `the overhead sign blocked the car at z=${v2.pos.z.toFixed(1)}`);

  // ...but a bus is too tall to fit under the same sign
  const bus = make('citybus');
  bus.rot = 0;
  drive(bus, stick(0, -1), 10, wallWorld(sign));
  assert(bus.pos.z < 10, `the bus (${VEHICLES.citybus.height} m tall) drove under a 3 m sign`);
});

test('the separating-axis test agrees with obvious cases', () => {
  const v = make('sedan');
  v.pos.set(0, 0, 0); v.rot = 0;
  assert(!obbAabbOverlap(v, { minX: 50, maxX: 60, minZ: 50, maxZ: 60 }), 'claimed a distant box overlapped');
  const hit = obbAabbOverlap(v, { minX: -1, maxX: 1, minZ: -1, maxZ: 1 });
  assert(hit && hit.depth > 0, 'missed a box the car is sitting on top of');

  // rotated 45 degrees, the corners reach further than the half-width
  v.rot = Math.PI / 4;
  const corner = obbAabbOverlap(v, { minX: 1.6, maxX: 2.6, minZ: 1.6, maxZ: 2.6 });
  assert(corner, 'a rotated car should clip a box its corner reaches');

  const a = make('sedan'); a.pos.set(0, 0, 0); a.rot = 0;
  const b = make('sedan'); b.pos.set(0, 0, 3); b.rot = 0;
  assert(obbObbOverlap(a, b), 'two overlapping cars were not detected');
  b.pos.set(0, 0, 12);
  assert(!obbObbOverlap(a, b), 'two separated cars were reported as touching');
});

test('a heavy vehicle shoves a light one out of the way', () => {
  const truck = make('boxtruck');
  truck.rot = 0;
  truck.speed = 14; truck.vel.set(0, 0, 14);
  const car = new Vehicle(null, 0, 8, 'hatchback', { rot: 0 });
  const startZ = car.pos.z;
  const dt = 1 / 60;
  for (let i = 0; i < 180; i++) {
    truck.update(dt, stick(0, -1), EMPTY_WORLD, { others: [car] });
    car.update(dt, null, EMPTY_WORLD, { others: [truck] });
  }
  assert(car.pos.z > startZ + 1, `the truck failed to shift the car (moved ${(car.pos.z - startZ).toFixed(2)} m)`);
  assert(car.health < 100, 'being rammed did the car no harm');
});

// ===========================================================================
// Equipment, seating and state
// ===========================================================================

test('seat and exit anchors sit on the vehicle and scale with its body', () => {
  for (const id of VEHICLE_IDS) {
    const v = make(id);
    v.pos.set(10, 0, -4);
    const seat = v.seatPosition();
    assert(Math.hypot(seat.x - 10, seat.z + 4) < VEHICLES[id].length,
      `${id} seat is outside the vehicle`);
    assert(seat.y > 0.3 && seat.y < VEHICLES[id].height + 1.2, `${id} seat height ${seat.y.toFixed(2)} is wrong`);
    const spots = v.exitSpots();
    assert(spots.length >= 4, `${id} offers only ${spots.length} exit spots`);
    for (const s of spots) {
      const d = Math.hypot(s.x - 10, s.z + 4);
      assert(d > VEHICLES[id].width / 2, `${id} exit spot is inside the body`);
      assert(d < VEHICLES[id].length + 3, `${id} exit spot is miles away`);
    }
  }
});

test('lights, siren and horn only exist where they should', () => {
  const car = make('sedan');
  assert(!car.def.siren, 'a saloon has a siren');
  car.setSiren(true);
  assert(!car.sirenOn, 'a civilian car switched on a siren');

  const police = make('police');
  const events = [];
  police.onEvent = (n, d) => events.push([n, d]);
  police.setSiren(true);
  assert(police.sirenOn, 'the police car would not switch on its siren');
  assert(events.some(([n]) => n === 'siren'), 'no siren event');
  assert(police.beacons.length > 0, 'the police car has no light bar');

  police.setLights(true);
  assert(police.lightsOn, 'headlights did not switch on');
  police.honk();
  assert(events.some(([n]) => n === 'horn'), 'the horn made no event');
});

test('the driving controls read throttle, brake, steering and handbrake', () => {
  const v = make('sedan');
  v.update(1 / 60, stick(0, -1), EMPTY_WORLD, {});
  assert(v.throttle > 0.9 && v.brake === 0, 'W did not apply throttle');
  drive(v, stick(0, -1), 4);
  v.update(1 / 60, stick(0, 1), EMPTY_WORLD, {});
  assert(v.brake > 0.9 && v.throttle === 0, 'S while moving forward did not brake');
  v.update(1 / 60, stick(-1, 0), EMPTY_WORLD, {});
  assert(v.steerInput > 0.9, 'A did not steer');
  v.update(1 / 60, stick(0, 0, { jump: true }), EMPTY_WORLD, {});
  assert(v.handbrakeOn, 'space did not pull the handbrake');
});

test('controls are ignored while the UI is blocking', () => {
  const v = make('sedan');
  drive(v, stick(0, -1), 3);
  const speed = v.speed;
  drive(v, stick(0, -1), 3, EMPTY_WORLD, { blocked: true });
  assert(v.throttle === 0, 'the throttle stayed open behind a menu');
  assert(v.speed < speed + 0.5, 'the car kept accelerating behind a menu');
});

test('an unoccupied vehicle stays parked', () => {
  const v = new Vehicle(null, 5, 5, 'sedan', { rot: 1 });
  drive(v, null, 10);
  assert(Math.abs(v.pos.x - 5) < 0.05 && Math.abs(v.pos.z - 5) < 0.05, 'a parked car rolled away');
  assert(!v.engineOn, 'a parked car had its engine running');
});

test('measured performance figures are produced for every vehicle', () => {
  for (const id of VEHICLE_IDS) {
    const s = Vehicle.measure(id);
    assert(s.topSpeedKmh > 40, `${id} measured a top speed of ${s.topSpeedKmh.toFixed(0)} km/h`);
    assert(s.brakingDistance > 5 && s.brakingDistance < 140, `${id} braking distance ${s.brakingDistance.toFixed(0)} m`);
    assert(s.rangeKm > 50, `${id} range of only ${s.rangeKm.toFixed(0)} km`);
    assert(s.zeroTo60 != null, `${id} never reached 60 km/h`);
    for (const [k, val] of Object.entries(s.bars)) {
      assert(val >= 0 && val <= 1, `${id} ${k} bar is ${val}`);
    }
  }
  // the cards must rank the fleet sensibly
  assert(Vehicle.measure('sports').bars.accel > Vehicle.measure('citybus').bars.accel, 'bus out-accelerates a sports car');
  assert(Vehicle.measure('firetruck').bars.toughness > Vehicle.measure('motorcycle').bars.toughness, 'a bike is tougher than a fire engine');
  assert(Vehicle.measure('scooter').bars.handling > Vehicle.measure('citybus').bars.handling, 'a bus handles better than a scooter');
});

test('a vehicle snapshot round-trips through save and load', () => {
  const v = make('pickup');
  drive(v, stick(0, -1), 5);
  v.health = 61; v.engineHealth = 42; v.tankHealth = 77; v.fuel = 31.5;
  const snap = v.snapshot();
  assert(snap.type === 'pickup' && snap.id === v.id, 'the snapshot lost its identity');

  const other = new Vehicle(null, 0, 0, 'pickup');
  other.restore(snap);
  close(other.fuel, 31.5, 1e-6, 'fuel');
  close(other.health, 61, 1e-6, 'health');
  close(other.engineHealth, 42, 1e-6, 'engine health');
  close(other.pos.x, v.pos.x, 1e-6, 'x');
  close(other.pos.z, v.pos.z, 1e-6, 'z');
  assert(other.speed === 0, 'a restored vehicle is already moving');
});

// ===========================================================================
// Fleet manager
// ===========================================================================

test('the manager parks the whole fleet without burying anything in a wall', () => {
  const world = new CollisionWorld();
  world.add({ minX: -6, maxX: 6, minY: 0, maxY: 8, minZ: -6, maxZ: 6 });  // a building in the way
  world.rebuild();
  const mgr = new VehicleManager(null, world);
  mgr.spawn('sedan', 0, 0, 0);                 // dropped right on top of it
  const v = mgr.vehicles[0];
  const hit = obbAabbOverlap(v, { minX: -6, maxX: 6, minZ: -6, maxZ: 6, minY: 0, maxY: 8 });
  assert(!hit, `the sedan was parked inside the building at ${v.pos.x.toFixed(1)}, ${v.pos.z.toFixed(1)}`);
});

test('the manager spawns the full town fleet across every class', () => {
  const mgr = new VehicleManager(null, null);
  mgr.spawnAll();
  assert(mgr.vehicles.length >= 20, `only ${mgr.vehicles.length} vehicles in town`);
  const classes = new Set(mgr.vehicles.map((v) => v.class));
  for (const c of ['car', 'motorcycle', 'truck', 'van', 'bus', 'emergency']) {
    assert(classes.has(c), `the town has no ${c}`);
  }
  assert(mgr.stations.length >= 2, 'nowhere to buy fuel');
  const ids = new Set(mgr.vehicles.map((v) => v.id));
  assert(ids.size === mgr.vehicles.length, 'two vehicles share an id');
});

test('nearest() finds the closest vehicle and respects the range limit', () => {
  const mgr = new VehicleManager(null, null);
  mgr.spawn('sedan', 0, 0, 0);
  mgr.spawn('citybus', 40, 0, 0);
  const near = mgr.nearest(new THREE.Vector3(2, 0, 0), 10);
  assert(near && near.type === 'sedan', 'picked the wrong vehicle');
  assert(!mgr.nearest(new THREE.Vector3(200, 0, 200), 10), 'found a vehicle 200 m away within 10 m');
  assert(mgr.within(new THREE.Vector3(0, 0, 0), 100).length === 2, 'within() missed a vehicle');
});

test('fuel stations only serve the right fuel and charge for it', () => {
  const mgr = new VehicleManager(null, null);
  mgr.spawnAll();
  const petrolCar = mgr.vehicles.find((v) => v.def.fuelType === 'petrol');
  const ev = mgr.vehicles.find((v) => v.def.fuelType === 'electric');
  assert(petrolCar && ev, 'the fleet is missing a petrol car or an EV');

  const pump = mgr.nearestStation(petrolCar.pos, petrolCar);
  assert(pump && pump.kinds.includes('petrol'), 'no petrol pump for a petrol car');
  const charger = mgr.nearestStation(ev.pos, ev);
  assert(charger && charger.kinds.includes('electric'), 'no charger for an EV');

  petrolCar.fuel = 0;
  const rich = mgr.refuel(petrolCar, pump, 10000);
  assert(rich.litres > 0 && rich.full, 'a full wallet did not fill the tank');
  close(rich.cost, rich.litres * pump.price, 1e-6, 'fuel cost');

  petrolCar.fuel = 0;
  const poor = mgr.refuel(petrolCar, pump, 5);
  assert(poor.litres > 0 && !poor.full, 'five dollars filled a whole tank');
  close(poor.cost, 5, 1e-6, 'spent everything available');
  assert(mgr.refuel(petrolCar, pump, 0).litres === 0, 'got fuel for nothing');
});

test('the manager only simulates what is near the player', () => {
  const mgr = new VehicleManager(null, null);
  const near = mgr.spawn('sedan', 0, 0, 0);
  const far = mgr.spawn('sedan', 2000, 0, 2000);
  far.speed = 10; far.vel.set(0, 0, 10);
  const farZ = far.pos.z;
  mgr.update(1 / 60, new THREE.Vector3(0, 0, 0), null, {});
  assert(far.pos.z === farZ, 'a vehicle 2 km away was still being simulated');
  assert(far.group.visible === false, 'a distant vehicle was left visible');
  assert(near.group.visible !== false, 'a nearby vehicle was hidden');
});

test('the manager forwards impacts and events to the game', () => {
  const impacts = [], events = [];
  const wall = { minX: -40, maxX: 40, minZ: 14, maxZ: 16, minY: 0, maxY: 4 };
  const mgr = new VehicleManager(null, wallWorld(wall), {
    onImpact: (f, v) => impacts.push([f, v.type]),
    onEvent: (n, d, v) => events.push([n, v.type]),
  });
  const v = mgr.spawn('sedan', 0, 0, 0);
  v.occupied = true;
  v.fuel = v.fuelCapacity;
  v.startEngine();
  mgr.update(1 / 60, v.pos, stick(0, -1), {});
  assert(events.some(([n]) => n === 'engine-start'), 'the engine start was not reported');
  for (let i = 0; i < 600; i++) mgr.update(1 / 60, v.pos, stick(0, -1), {});
  assert(impacts.length > 0, 'driving into a wall reported no impact');
  assert(events.some(([n]) => n === 'impact'), 'no impact event');
});

test('the manager restores a saved fleet', () => {
  const mgr = new VehicleManager(null, null);
  mgr.spawnAll();
  const target = mgr.vehicles[3];
  target.fuel = 7.5; target.health = 44;
  target.pos.set(123, 0, -45);
  const save = mgr.snapshot();
  assert(save.length === mgr.vehicles.length, 'the snapshot lost vehicles');

  target.fuel = 60; target.health = 100; target.pos.set(0, 0, 0);
  mgr.restore(save);
  close(target.fuel, 7.5, 1e-6, 'restored fuel');
  close(target.health, 44, 1e-6, 'restored health');
  close(target.pos.x, 123, 1e-6, 'restored x');
});

test('night lights switch on across the parked fleet', () => {
  const mgr = new VehicleManager(null, null);
  mgr.spawnAll();
  mgr.setNightLights(true);
  assert(mgr.vehicles.every((v) => v.lightsOn || v.destroyed), 'some parked vehicles stayed dark at night');
  mgr.setNightLights(false);
  assert(mgr.vehicles.every((v) => !v.lightsOn), 'lights stayed on in daylight');
});

// ===========================================================================
// Configuration
// ===========================================================================

test('the vehicle configuration block is wired up', () => {
  const c = CONFIG.vehicle;
  for (const k of ['fuelScale', 'enterRange', 'exitMaxSpeed', 'stationRange', 'hurtSpeed', 'wetGrip']) {
    assert(typeof c[k] === 'number', `CONFIG.vehicle.${k} is missing`);
  }
  assert(c.enterRange > 1 && c.enterRange < 8, 'the enter range is unreasonable');
  assert(c.wetGrip > 0 && c.wetGrip < 1, 'wet grip should reduce traction');
});

test('a wet road reduces grip and lengthens the stopping distance', () => {
  const stop = (surface) => {
    const v = make('sedan');
    v.rot = 0;
    v.speed = 25; v.vel.set(0, 0, 25);
    let dist = 0;
    const dt = 1 / 120;
    for (let i = 0; i < 4000 && v.speed > 0.2; i++) {
      v.update(dt, stick(0, 1), EMPTY_WORLD, { surface });
      dist += Math.max(0, v.speed) * dt;
    }
    return dist;
  };
  const dry = stop(1);
  const wet = stop(CONFIG.vehicle.wetGrip);
  assert(wet > dry * 1.1, `wet (${wet.toFixed(1)} m) should be much longer than dry (${dry.toFixed(1)} m)`);
});

console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
