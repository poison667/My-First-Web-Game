// ---------------------------------------------------------------------------
// Vehicle catalogue.
//
// Every entry is a physical specification in SI units — the simulation in
// entities/Vehicle.js derives all behaviour from these numbers, so a bus feels
// like a bus (heavy, slow, huge turning circle) and a sport bike feels like a
// sport bike (light, violent acceleration, twitchy) without any special cases.
//
//   mass          kg (kerb weight)
//   power         kW at the wheels
//   peakTorque    Nm at the crank (shapes low-end punch)
//   redline       rpm
//   gears         gearbox ratios, low to high
//   finalDrive    differential ratio
//   wheelRadius   m
//   drag          Cd * frontal area (m^2) -> aero drag = 0.5*rho*dragArea*v^2
//   rollResist    rolling resistance coefficient
//   brakeForce    N of braking the pads can apply (all axles)
//   handbrake     N applied to the rear axle only (locks it -> slides)
//   grip          tyre friction coefficient (dry tarmac)
//   weightFront   static front axle weight distribution (0..1)
//   wheelbase     m between axles
//   track         m between left/right wheels
//   steerAngle    rad of lock at the front wheels
//   steerSpeed    rad/s the wheels rotate toward the target angle
//   limiter       km/h electronic speed limiter (0 = none)
//   drive         'fwd' | 'rwd' | 'awd'
//   fuelType      'petrol' | 'diesel' | 'electric'
//   fuelCapacity  litres, or kWh for electric
//   fuelBurn      litres/hour at FULL load (kWh/hour for electric)
//   idleBurn      litres/hour at idle
//   armour        damage resistance multiplier (higher = tougher shell)
//   seats, price, class, body (mesh builder), colours
// ---------------------------------------------------------------------------

const PETROL = 'petrol', DIESEL = 'diesel', ELECTRIC = 'electric';

export const VEHICLES = {
  // ---------------------------------------------------------------- cars ---
  hatchback: {
    name: 'Kessler Nib', class: 'car', body: 'hatchback',
    mass: 1180, power: 68, peakTorque: 145, redline: 6200,
    gears: [3.55, 2.05, 1.38, 1.03, 0.82], finalDrive: 4.05, wheelRadius: 0.30,
    drag: 0.72, rollResist: 0.014, brakeForce: 13600, handbrake: 4600,
    grip: 1.02, weightFront: 0.61, wheelbase: 2.48, track: 1.52,
    length: 3.95, width: 1.70, height: 1.48,
    steerAngle: 0.58, steerSpeed: 3.0, limiter: 185, drive: 'fwd',
    fuelType: PETROL, fuelCapacity: 45, fuelBurn: 22, idleBurn: 0.8,
    armour: 1.0, seats: 5, price: 3200,
    colours: [0x9fb4c7, 0xcfd3d6, 0x6d8f5e, 0xb44c4c, 0xe0d7a8],
    desc: 'Cheap, light and honest. Front-wheel drive, nothing to prove.',
  },
  sedan: {
    name: 'Vanguard Crestline', class: 'car', body: 'sedan',
    mass: 1480, power: 110, peakTorque: 230, redline: 6000,
    gears: [3.42, 2.01, 1.40, 1.00, 0.78, 0.64], finalDrive: 3.73, wheelRadius: 0.33,
    drag: 0.76, rollResist: 0.013, brakeForce: 17700, handbrake: 6600,
    grip: 1.06, weightFront: 0.57, wheelbase: 2.82, track: 1.58,
    length: 4.78, width: 1.82, height: 1.46,
    steerAngle: 0.54, steerSpeed: 2.8, limiter: 210, drive: 'rwd',
    fuelType: PETROL, fuelCapacity: 60, fuelBurn: 36, idleBurn: 1.0,
    armour: 1.15, seats: 5, price: 6400,
    colours: [0x2d3a4a, 0x8d9299, 0x3f5f45, 0x6b2f2f, 0xe8e8ea],
    desc: 'Comfortable family saloon. Smooth, stable, forgettable.',
  },
  sports: {
    name: 'Mirado GT', class: 'car', body: 'sports',
    mass: 1320, power: 240, peakTorque: 420, redline: 7600,
    gears: [3.21, 2.19, 1.60, 1.24, 1.00, 0.84], finalDrive: 3.55, wheelRadius: 0.34,
    drag: 0.74, rollResist: 0.012, brakeForce: 20500, handbrake: 8900,
    grip: 1.32, weightFront: 0.48, wheelbase: 2.56, track: 1.66,
    length: 4.42, width: 1.92, height: 1.24,
    steerAngle: 0.50, steerSpeed: 3.6, limiter: 280, drive: 'rwd',
    fuelType: PETROL, fuelCapacity: 62, fuelBurn: 80, idleBurn: 1.6,
    armour: 0.85, seats: 2, price: 28000,
    colours: [0xd81f26, 0xf0c419, 0x1b1b1f, 0x2763c4, 0xe9eef2],
    desc: 'Mid-weight rear-drive coupe. Quick, loud, happy to swap ends.',
  },
  muscle: {
    name: 'Bruckner Vandal', class: 'car', body: 'muscle',
    mass: 1680, power: 225, peakTorque: 540, redline: 6000,
    gears: [2.97, 1.78, 1.30, 1.00, 0.74], finalDrive: 3.90, wheelRadius: 0.36,
    drag: 0.88, rollResist: 0.014, brakeForce: 20300, handbrake: 8500,
    grip: 1.12, weightFront: 0.54, wheelbase: 2.74, track: 1.62,
    length: 4.94, width: 1.94, height: 1.36,
    steerAngle: 0.48, steerSpeed: 2.6, limiter: 250, drive: 'rwd',
    fuelType: PETROL, fuelCapacity: 70, fuelBurn: 78, idleBurn: 1.8,
    armour: 1.25, seats: 4, price: 17500,
    colours: [0x1f1f24, 0xbf5a1f, 0x7a1f2b, 0x235c3f, 0xdedad2],
    desc: 'Torque first, grip later. Lights up the rears in three gears.',
  },
  taxi: {
    name: 'Crestline Cab', class: 'car', body: 'taxi',
    mass: 1560, power: 104, peakTorque: 225, redline: 5800,
    gears: [3.42, 2.01, 1.40, 1.00, 0.78], finalDrive: 3.73, wheelRadius: 0.33,
    drag: 0.78, rollResist: 0.014, brakeForce: 16800, handbrake: 6400,
    grip: 1.00, weightFront: 0.58, wheelbase: 2.82, track: 1.58,
    length: 4.80, width: 1.84, height: 1.50,
    steerAngle: 0.54, steerSpeed: 2.8, limiter: 180, drive: 'rwd',
    fuelType: PETROL, fuelCapacity: 60, fuelBurn: 34, idleBurn: 1.1,
    armour: 1.1, seats: 5, price: 5200,
    colours: [0xf2b705],
    desc: 'Three hundred thousand miles and still rattling to work.',
  },
  ev_compact: {
    name: 'Volt Nimbus E', class: 'car', body: 'hatchback',
    mass: 1510, power: 150, peakTorque: 310, redline: 12000,
    gears: [9.0], finalDrive: 1.0, wheelRadius: 0.32,
    drag: 0.58, rollResist: 0.011, brakeForce: 17600, handbrake: 7680,
    grip: 1.08, weightFront: 0.52, wheelbase: 2.70, track: 1.56,
    length: 4.26, width: 1.78, height: 1.56,
    steerAngle: 0.56, steerSpeed: 3.2, limiter: 160, drive: 'fwd',
    fuelType: ELECTRIC, fuelCapacity: 54, fuelBurn: 150, idleBurn: 0.4, regen: 0.30,
    armour: 1.05, seats: 5, price: 21000,
    colours: [0xe9f1f5, 0x2f6f8f, 0x8fbf6a, 0x3a3f49],
    desc: 'Single-speed electric. Instant torque, silent, and it brakes itself.',
  },

  // --------------------------------------------------------- motorcycles ---
  motorcycle: {
    name: 'Shrike 900R', class: 'motorcycle', body: 'motorcycle',
    mass: 205, power: 92, peakTorque: 96, redline: 11500,
    gears: [2.85, 2.05, 1.65, 1.40, 1.22, 1.08], finalDrive: 4.60, wheelRadius: 0.31,
    drag: 0.52, rollResist: 0.016, brakeForce: 2100, handbrake: 1230,
    grip: 1.22, weightFront: 0.50, wheelbase: 1.42, track: 0.40,
    length: 2.08, width: 0.74, height: 1.14,
    steerAngle: 0.62, steerSpeed: 4.6, limiter: 250, drive: 'rwd',
    fuelType: PETROL, fuelCapacity: 17, fuelBurn: 30, idleBurn: 0.7,
    armour: 0.35, seats: 2, price: 9800, lean: 0.62,
    colours: [0x1d2b53, 0xd02c2c, 0x16161a, 0x2f9e44],
    desc: 'Nothing between you and the tarmac. Fits where cars cannot.',
  },
  scooter: {
    name: 'Pico 125', class: 'motorcycle', body: 'scooter',
    mass: 118, power: 8.5, peakTorque: 11, redline: 8500,
    gears: [8.5], finalDrive: 1.0, wheelRadius: 0.22,
    drag: 0.56, rollResist: 0.019, brakeForce: 900, handbrake: 600,
    grip: 0.96, weightFront: 0.46, wheelbase: 1.28, track: 0.36,
    length: 1.84, width: 0.70, height: 1.18,
    steerAngle: 0.70, steerSpeed: 5.0, limiter: 85, drive: 'rwd',
    fuelType: PETROL, fuelCapacity: 6, fuelBurn: 3.0, idleBurn: 0.3,
    armour: 0.3, seats: 2, price: 1400, lean: 0.40,
    colours: [0x6fc2d0, 0xf0f0f0, 0xe07a3a, 0x94618e],
    desc: 'Twist and go. Slow, cheap, and impossible to stop quickly.',
  },

  // -------------------------------------------------- trucks, vans, buses ---
  pickup: {
    name: 'Ridgeback 2500', class: 'truck', body: 'pickup',
    mass: 2420, power: 170, peakTorque: 620, redline: 4600,
    gears: [3.97, 2.32, 1.52, 1.14, 0.86, 0.69], finalDrive: 3.73, wheelRadius: 0.41,
    drag: 1.38, rollResist: 0.016, brakeForce: 22100, handbrake: 9770,
    grip: 0.98, weightFront: 0.58, wheelbase: 3.56, track: 1.74,
    length: 5.86, width: 2.03, height: 1.92,
    steerAngle: 0.46, steerSpeed: 2.4, limiter: 175, drive: 'awd',
    fuelType: DIESEL, fuelCapacity: 98, fuelBurn: 48, idleBurn: 1.6,
    armour: 1.6, seats: 5, price: 12800,
    colours: [0x2b4257, 0x8a8f94, 0x6b3a1f, 0xbfc3c6, 0x2f4f36],
    desc: 'Four-wheel drive workhorse. Shrugs off kerbs and fences.',
  },
  van: {
    name: 'Carrier 3000', class: 'van', body: 'van',
    mass: 2150, power: 103, peakTorque: 340, redline: 4200,
    gears: [4.12, 2.33, 1.44, 1.00, 0.79], finalDrive: 4.10, wheelRadius: 0.36,
    drag: 1.55, rollResist: 0.017, brakeForce: 17460, handbrake: 7760,
    grip: 0.92, weightFront: 0.60, wheelbase: 3.20, track: 1.70,
    length: 5.40, width: 2.00, height: 2.44,
    steerAngle: 0.48, steerSpeed: 2.3, limiter: 160, drive: 'fwd',
    fuelType: DIESEL, fuelCapacity: 75, fuelBurn: 29, idleBurn: 1.2,
    armour: 1.35, seats: 3, price: 7600,
    colours: [0xe9e9e9, 0x3f5fa8, 0x8c8f93, 0xd8762f],
    desc: 'Tall, slab-sided panel van. Leans like a sailboat in corners.',
  },
  boxtruck: {
    name: 'Haulmaster 7T', class: 'truck', body: 'boxtruck',
    mass: 7400, power: 180, peakTorque: 900, redline: 2800,
    gears: [6.55, 3.92, 2.40, 1.48, 1.00, 0.78], finalDrive: 4.56, wheelRadius: 0.48,
    drag: 3.60, rollResist: 0.019, brakeForce: 44950, handbrake: 28700,
    grip: 0.86, weightFront: 0.54, wheelbase: 4.60, track: 1.96,
    length: 8.20, width: 2.40, height: 3.30,
    steerAngle: 0.42, steerSpeed: 1.8, limiter: 120, drive: 'rwd',
    fuelType: DIESEL, fuelCapacity: 150, fuelBurn: 50, idleBurn: 2.4,
    armour: 2.4, seats: 3, price: 24000,
    colours: [0xdedede, 0x2f6f4f, 0x9a3b3b, 0x3a4a5a],
    desc: 'Seven tonnes of delivery truck. Plan your braking a week ahead.',
  },
  citybus: {
    name: 'Brackenridge Transit', class: 'bus', body: 'citybus',
    mass: 12800, power: 220, peakTorque: 1200, redline: 2400,
    gears: [3.49, 1.86, 1.41, 1.00, 0.75], finalDrive: 5.63, wheelRadius: 0.52,
    drag: 4.80, rollResist: 0.020, brakeForce: 75950, handbrake: 61200,
    grip: 0.84, weightFront: 0.42, wheelbase: 5.90, track: 2.10,
    length: 11.60, width: 2.55, height: 3.20,
    steerAngle: 0.46, steerSpeed: 1.6, limiter: 100, drive: 'rwd',
    fuelType: DIESEL, fuelCapacity: 250, fuelBurn: 62, idleBurn: 3.2,
    armour: 2.8, seats: 38, price: 42000,
    colours: [0x3f7fbf, 0xdfe3e6],
    desc: 'City bus. Immovable object, barely movable object.',
  },
  schoolbus: {
    name: 'District 12 Schoolbus', class: 'bus', body: 'schoolbus',
    mass: 10600, power: 190, peakTorque: 1050, redline: 2600,
    gears: [4.10, 2.30, 1.52, 1.00, 0.76], finalDrive: 5.29, wheelRadius: 0.50,
    drag: 4.40, rollResist: 0.020, brakeForce: 63640, handbrake: 48600,
    grip: 0.85, weightFront: 0.45, wheelbase: 5.40, track: 2.05,
    length: 10.60, width: 2.44, height: 3.05,
    steerAngle: 0.46, steerSpeed: 1.7, limiter: 105, drive: 'rwd',
    fuelType: DIESEL, fuelCapacity: 220, fuelBurn: 53, idleBurn: 2.8,
    armour: 2.6, seats: 44, price: 31000,
    colours: [0xf5b800],
    desc: 'Smells of vinyl and detention. Surprisingly hard to kill.',
  },

  // ---------------------------------------------------- emergency service ---
  police: {
    name: 'Vanguard Interceptor', class: 'emergency', body: 'police',
    mass: 1790, power: 230, peakTorque: 560, redline: 6600,
    gears: [3.42, 2.01, 1.40, 1.00, 0.78, 0.64], finalDrive: 3.90, wheelRadius: 0.34,
    drag: 0.82, rollResist: 0.013, brakeForce: 24630, handbrake: 9640,
    grip: 1.22, weightFront: 0.55, wheelbase: 2.90, track: 1.64,
    length: 5.02, width: 1.92, height: 1.50,
    steerAngle: 0.52, steerSpeed: 3.2, limiter: 240, drive: 'awd',
    fuelType: PETROL, fuelCapacity: 68, fuelBurn: 76, idleBurn: 1.4,
    armour: 1.5, seats: 4, price: 0, siren: 'police',
    colours: [0x1b2436],
    desc: 'Pursuit-rated interceptor. Taking one is its own kind of crime.',
  },
  ambulance: {
    name: 'County Medical 4', class: 'emergency', body: 'ambulance',
    mass: 3650, power: 160, peakTorque: 520, redline: 4000,
    gears: [4.12, 2.33, 1.44, 1.00, 0.79], finalDrive: 4.30, wheelRadius: 0.40,
    drag: 2.30, rollResist: 0.018, brakeForce: 28600, handbrake: 14800,
    grip: 0.94, weightFront: 0.56, wheelbase: 3.70, track: 1.86,
    length: 6.40, width: 2.26, height: 2.80,
    steerAngle: 0.46, steerSpeed: 2.1, limiter: 150, drive: 'rwd',
    fuelType: DIESEL, fuelCapacity: 110, fuelBurn: 45, idleBurn: 1.8,
    armour: 1.9, seats: 4, price: 0, siren: 'ambulance', heals: 35,
    colours: [0xf2f4f6],
    desc: 'Box ambulance. The cabinets in the back are worth a look.',
  },
  firetruck: {
    name: 'Station 3 Pumper', class: 'emergency', body: 'firetruck',
    mass: 14500, power: 280, peakTorque: 1500, redline: 2300,
    gears: [5.60, 3.10, 1.90, 1.26, 1.00, 0.80], finalDrive: 5.00, wheelRadius: 0.56,
    drag: 4.20, rollResist: 0.021, brakeForce: 87600, handbrake: 66300,
    grip: 0.88, weightFront: 0.47, wheelbase: 5.20, track: 2.20,
    length: 9.80, width: 2.60, height: 3.40,
    steerAngle: 0.44, steerSpeed: 1.6, limiter: 110, drive: 'awd',
    fuelType: DIESEL, fuelCapacity: 300, fuelBurn: 78, idleBurn: 3.6,
    armour: 3.2, seats: 6, price: 0, siren: 'fire',
    colours: [0xc0392b],
    desc: 'Fourteen and a half tonnes with a siren. Nothing stops it politely.',
  },
};

// Spawn plan: where the town's fleet is parked. `at` is a LOCATIONS key.
export const VEHICLE_SPAWNS = [
  { type: 'hatchback', at: 'home', dx: 8, dz: 12, rot: 0 },
  { type: 'sedan', at: 'residential', dx: 6, dz: -4, rot: Math.PI / 2 },
  { type: 'hatchback', at: 'house4', dx: 7, dz: 3, rot: Math.PI },
  { type: 'ev_compact', at: 'friend_house', dx: 7, dz: -3, rot: 0 },
  { type: 'sports', at: 'downtown', dx: 0, dz: 14, rot: Math.PI },
  { type: 'muscle', at: 'arcade', dx: 10, dz: 6, rot: Math.PI / 2 },
  { type: 'taxi', at: 'diner', dx: -10, dz: 8, rot: Math.PI },
  { type: 'taxi', at: 'bank', dx: 12, dz: 6, rot: 0 },
  { type: 'motorcycle', at: 'skatepark', dx: 10, dz: -6, rot: Math.PI / 2 },
  { type: 'motorcycle', at: 'alley_east', dx: 2, dz: 6, rot: 0 },
  { type: 'scooter', at: 'general_store', dx: -8, dz: 8, rot: Math.PI },
  { type: 'scooter', at: 'school_gate', dx: 12, dz: 4, rot: Math.PI / 2 },
  { type: 'pickup', at: 'hardware', dx: 10, dz: 8, rot: 0 },
  { type: 'pickup', at: 'docks', dx: -12, dz: -8, rot: Math.PI / 2 },
  { type: 'van', at: 'warehouse', dx: -14, dz: -16, rot: 0 },
  { type: 'van', at: 'depot', dx: 12, dz: 8, rot: Math.PI },
  { type: 'boxtruck', at: 'depot', dx: -14, dz: 10, rot: Math.PI / 2 },
  { type: 'boxtruck', at: 'warehouse', dx: 16, dz: 10, rot: Math.PI },
  { type: 'citybus', at: 'bus_stop', dx: 0, dz: 10, rot: 0 },
  { type: 'schoolbus', at: 'school_gate', dx: -14, dz: 10, rot: Math.PI / 2 },
  { type: 'police', at: 'townhall', dx: 10, dz: 12, rot: Math.PI },
  { type: 'police', at: 'downtown', dx: -14, dz: -6, rot: 0 },
  { type: 'ambulance', at: 'park', dx: 16, dz: -10, rot: Math.PI / 2 },
  { type: 'firetruck', at: 'depot', dx: 0, dz: -14, rot: 0 },
];

// Fuel pumps / chargers. `price` is per litre or per kWh.
export const FUEL_STATIONS = [
  { at: 'gas_station', dx: -6, dz: 0, kinds: ['petrol', 'diesel'], price: 1.9, name: 'Brackenridge Fuel' },
  { at: 'gas_station', dx: -6, dz: 8, kinds: ['electric'], price: 0.9, name: 'Fast Charger' },
  { at: 'depot', dx: 6, dz: -6, kinds: ['diesel'], price: 1.7, name: 'Depot Diesel' },
];

export const GRAVITY = 9.81;
export const AIR_DENSITY = 1.225;

/** Simple torque curve: rises to a mid-range peak, falls away to the redline. */
export function engineTorque(def, rpm) {
  const r = Math.max(0.08, Math.min(1.08, rpm / def.redline));
  const curve = 1 - 1.65 * Math.pow(r - 0.62, 2) - 0.22 * Math.pow(Math.max(0, r - 0.92) * 6, 2);
  return def.peakTorque * Math.max(0.18, curve);
}

/**
 * Peak engine force at the wheels in a given gear, ignoring traction.
 * Torque through the gearing can't exceed the engine's power ceiling, so the
 * result is clamped to P/v once the vehicle is actually moving.
 */
export function tractiveForce(def, gearIndex, rpm, v = 0) {
  const ratio = (def.gears[gearIndex] ?? def.gears[0]) * def.finalDrive;
  const geared = engineTorque(def, rpm) * ratio / def.wheelRadius;
  const powerLimit = (def.power * 1000) / Math.max(1.5, Math.abs(v));
  return Math.min(geared, powerLimit);
}

/** Road speed (m/s) for an engine speed in a gear. */
export function speedForRpm(def, gearIndex, rpm) {
  const ratio = (def.gears[gearIndex] ?? def.gears[0]) * def.finalDrive;
  return (rpm * 2 * Math.PI / 60) * def.wheelRadius / ratio;
}

/** Engine speed for a road speed in a gear. */
export function rpmForSpeed(def, gearIndex, speed) {
  const ratio = (def.gears[gearIndex] ?? def.gears[0]) * def.finalDrive;
  return Math.abs(speed) / def.wheelRadius * ratio * 60 / (2 * Math.PI);
}

/** Force resisting motion at speed v: aerodynamic drag + rolling resistance. */
export function resistanceAt(def, v) {
  return 0.5 * AIR_DENSITY * def.drag * v * v + def.rollResist * def.mass * GRAVITY;
}

/** Fraction of weight over the driven wheels (sets the traction limit). */
export function tractionShare(def) {
  if (def.drive === 'awd') return 1;
  return def.drive === 'fwd' ? def.weightFront : 1 - def.weightFront;
}

/**
 * Theoretical top speed: where drive force equals resistance, searched over
 * the top two gears and clamped by the electronic limiter.
 */
export function topSpeed(def) {
  let best = 0;
  // Search every gear, not just the tall ones: an under-geared vehicle reaches
  // its highest speed in a middle gear, because the taller ratios cannot
  // overcome drag at all.
  for (let g = 0; g < def.gears.length; g++) {
    for (let v = 4; v < 140; v += 0.25) {
      const rpm = rpmForSpeed(def, g, v);
      if (rpm > def.redline) break;
      if (tractiveForce(def, g, rpm, v) <= resistanceAt(def, v)) break;
      best = Math.max(best, v);
    }
  }
  return def.limiter ? Math.min(best, def.limiter / 3.6) : best;
}

/** Power-to-weight in kW per tonne — the headline number for the garage UI. */
export function powerToWeight(def) { return (def.power / def.mass) * 1000; }

/** Shortest possible stop from `fromSpeed` (m/s), in metres. */
export function brakingDistance(def, fromSpeed = 27.78) {
  const maxDecel = Math.min(def.brakeForce / def.mass, def.grip * GRAVITY);
  return (fromSpeed * fromSpeed) / (2 * maxDecel);
}

/** Steady-state turning circle diameter (m) at walking pace. */
export function turningCircle(def) {
  return 2 * (def.wheelbase / Math.tan(def.steerAngle)) + def.track;
}

/** Rough 0-100 km/h estimate by integrating the drivetrain, in seconds. */
export function zeroToHundred(def) {
  const target = 100 / 3.6;
  if (topSpeed(def) < target) return Infinity;
  const gripLimit = def.grip * def.mass * GRAVITY * tractionShare(def);
  let v = 0, t = 0, gear = 0;
  const dt = 0.005;
  while (v < target && t < 90) {
    let rpm = rpmForSpeed(def, gear, v);
    while (rpm > def.redline * 0.97 && gear < def.gears.length - 1) { gear++; rpm = rpmForSpeed(def, gear, v); }
    rpm = Math.max(rpm, def.redline * 0.22);
    const drive = Math.min(tractiveForce(def, gear, rpm, v), gripLimit);
    v += ((drive - resistanceAt(def, v)) / def.mass) * dt;
    t += dt;
    if (v <= 0) return Infinity;
  }
  return t < 90 ? t : Infinity;
}

/** Litres (or kWh) burned per hour cruising at `v` m/s. */
export function burnRateAt(def, v) {
  const loadKw = (resistanceAt(def, v) * v) / 1000;
  const load = Math.max(0, Math.min(1, loadKw / def.power));
  return def.idleBurn + (def.fuelBurn - def.idleBurn) * load;
}

/** Cruising range in km, computed from the power actually needed to cruise. */
export function cruiseRange(def) {
  const cruise = Math.min(25, topSpeed(def) * 0.62); // m/s, ~90 km/h cap
  const hours = def.fuelCapacity / Math.max(0.2, burnRateAt(def, cruise));
  return hours * cruise * 3.6;
}

/** Everything the UI wants to show about a vehicle. */
export function vehicleStats(id) {
  const def = VEHICLES[id];
  if (!def) return null;
  return {
    id,
    name: def.name,
    class: def.class,
    desc: def.desc,
    topSpeedKmh: topSpeed(def) * 3.6,
    zeroToHundred: zeroToHundred(def),
    powerToWeight: powerToWeight(def),
    brakingDistance: brakingDistance(def),
    turningCircle: turningCircle(def),
    mass: def.mass,
    power: def.power,
    seats: def.seats,
    fuelType: def.fuelType,
    fuelCapacity: def.fuelCapacity,
    range: cruiseRange(def),
  };
}

export const VEHICLE_IDS = Object.keys(VEHICLES);
