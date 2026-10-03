import * as THREE from 'three';
import {
  VEHICLES, GRAVITY, AIR_DENSITY,
  engineTorque, rpmForSpeed, speedForRpm, tractionShare, topSpeed, burnRateAt,
} from '../data/vehicles.js';
import { buildVehicleBody, LIGHT_COLOURS } from './VehicleMeshes.js';

// ---------------------------------------------------------------------------
// Drivable vehicle.
//
// The handling is a classic bicycle model: the two wheels on each axle are
// lumped together, each axle develops a lateral force from its slip angle, and
// the resulting forces move the body and spin it about its yaw axis. On top of
// that sit the systems that make different vehicles feel different:
//
//   * a real gearbox (ratios, torque curve, auto/manual shifting, clutch slip)
//   * a friction circle per axle, so you cannot brake and corner at full force
//   * longitudinal load transfer, so braking adds front grip and lifts the rear
//   * a handbrake that kills rear grip -> the rear steps out
//   * fuel burned against actual engine load, with regen for electrics
//   * damage that degrades the engine, steering and fuel tank independently
//   * oriented-box collisions with impulse response, scrape and yaw spin
//
// Nothing here is special-cased per vehicle: a bus understeers and a sport bike
// is twitchy purely because of the numbers in data/vehicles.js.
// ---------------------------------------------------------------------------

const MIN_DT = 1 / 240;
const KINEMATIC_SPEED = 2.4;     // below this the slip model is blended out

export class Vehicle {
  /**
   * @param {THREE.Scene} scene
   * @param {number} x @param {number} z
   * @param {string|number} type   catalogue id, or a colour for a plain sedan
   * @param {object} opts          {rot, colour, fuel, plate, id}
   */
  constructor(scene, x, z, type = 'sedan', opts = {}) {
    // back-compat: old call signature was (scene, x, z, colour)
    let colour = opts.colour;
    if (typeof type === 'number') { colour = type; type = 'sedan'; }

    const def = VEHICLES[type] || VEHICLES.sedan;
    this.scene = scene;
    this.type = VEHICLES[type] ? type : 'sedan';
    this.def = def;
    this.id = opts.id || `${this.type}-${Math.floor(Math.random() * 1e6)}`;
    this.name = def.name;
    this.class = def.class;

    if (colour == null) colour = def.colours[Math.floor(Math.random() * def.colours.length)];
    this.colour = colour;

    // ---- transform & motion state ----------------------------------------
    this.pos = new THREE.Vector3(x, 0, z);
    this.rot = opts.rot ?? 0;
    this.vel = new THREE.Vector3(0, 0, 0);   // world-space velocity (XZ)
    this.yawRate = 0;
    this.speed = 0;                          // signed forward speed (m/s)
    this.lateralSpeed = 0;
    this.slipAngle = 0;
    this.steerAngle = 0;                     // current road-wheel angle (rad)
    this.wheelSpin = 0;                      // 0..1 how much the tyres are lit up
    this.skid = 0;

    // ---- drivetrain -------------------------------------------------------
    this.engineOn = false;
    this.gear = 1;                           // 0 = reverse, 1..n forward
    this.gearCount = def.gears.length;
    this.rpm = 0;
    this.idleRpm = def.fuelType === 'electric' ? 0 : Math.round(def.redline * 0.12);
    this.shiftTimer = 0;
    this.shiftTime = def.fuelType === 'electric' ? 0 : (def.mass > 5000 ? 0.65 : 0.26);
    this.clutch = 1;
    this.automatic = true;
    this.throttle = 0;
    this.brake = 0;
    this.handbrakeOn = false;

    // ---- consumables & condition -----------------------------------------
    this.fuelCapacity = def.fuelCapacity;
    this.fuel = opts.fuel != null ? opts.fuel : def.fuelCapacity * (0.35 + Math.random() * 0.6);
    this.health = opts.health != null ? opts.health : 100;
    this.engineHealth = 100;
    this.tankHealth = 100;
    this.steeringBias = 0;                   // damaged steering pulls to one side
    this.destroyed = false;
    this.burning = 0;

    // ---- equipment --------------------------------------------------------
    this.lightsOn = false;
    this.sirenOn = false;
    this.hornTimer = 0;
    this.occupied = false;
    this.locked = !!opts.locked;
    this.beaconPhase = 0;

    // ---- derived geometry -------------------------------------------------
    this.halfWidth = def.width / 2;
    this.halfLength = def.length / 2;
    this.height = def.height;
    this.cgToFront = def.wheelbase * (1 - def.weightFront);
    this.cgToRear = def.wheelbase * def.weightFront;
    this.inertia = def.mass * (def.length * def.length + def.width * def.width) / 12 * 1.12;
    this.maxSpeed = topSpeed(def);
    this.reverseSpeed = Math.min(12, this.maxSpeed * 0.25);

    // cornering stiffness per axle (N/rad), scaled with the axle load
    const frontLoad = def.mass * GRAVITY * def.weightFront;
    const rearLoad = def.mass * GRAVITY * (1 - def.weightFront);
    const stiffness = def.class === 'motorcycle' ? 7.5 : 9.5;
    this.caFront = frontLoad * stiffness * def.grip;
    this.caRear = rearLoad * stiffness * def.grip;

    // ---- presentation -----------------------------------------------------
    this.group = new THREE.Group();
    this.body = new THREE.Group();          // pitch/roll shell
    this.group.add(this.body);
    const parts = buildVehicleBody(def, colour);
    this.body.add(parts.group);
    this.parts = parts;
    this.wheels = parts.wheels;
    this.headlights = parts.headlights;
    this.taillights = parts.taillights;
    this.beacons = parts.beacons;
    this.leanGroup = parts.leanGroup || null;
    this.leanMax = def.lean || 0;
    this.smoke = null;

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.rot;
    if (scene) scene.add(this.group);

    // ---- callbacks --------------------------------------------------------
    this.onImpact = null;                   // (impactSpeed, vehicle) => void
    this.onEvent = null;                    // (name, data) => void
    this.engineTick = 0;
  }

  // ---------------------------------------------------------------- helpers

  forward() { return { x: Math.sin(this.rot), z: Math.cos(this.rot) }; }
  right() { return { x: -Math.cos(this.rot), z: Math.sin(this.rot) }; }

  speedKmh() { return Math.abs(this.speed) * 3.6; }
  fuelFraction() { return Math.max(0, Math.min(1, this.fuel / this.fuelCapacity)); }
  rpmFraction() { return Math.max(0, Math.min(1.05, this.rpm / this.def.redline)); }
  isElectric() { return this.def.fuelType === 'electric'; }
  hasFuel() { return this.fuel > 0.02; }

  /** Label for the HUD gear readout. */
  gearLabel() {
    if (!this.engineOn) return '—';
    if (this.isElectric()) return this.speed < -0.2 ? 'R' : 'D';
    if (this.gear === 0) return 'R';
    if (Math.abs(this.speed) < 0.3 && this.throttle < 0.05) return 'N';
    return String(this.gear);
  }

  /** Where the driver sits (world space). */
  seatPosition() {
    const f = this.forward(), r = this.right();
    const sideways = this.class === 'motorcycle' ? 0 : -this.def.width * 0.26;
    const back = this.class === 'motorcycle' ? -0.1 : this.def.length * 0.04;
    return new THREE.Vector3(
      this.pos.x + f.x * back + r.x * sideways,
      this.pos.y + this.def.wheelRadius + this.def.height * (this.class === 'motorcycle' ? 0.48 : 0.42),
      this.pos.z + f.z * back + r.z * sideways,
    );
  }

  /** Candidate spots to stand when leaving, nearest side first. */
  exitSpots() {
    const r = this.right(), f = this.forward();
    const side = this.def.width / 2 + 0.9;
    const end = this.def.length / 2 + 1.1;
    return [
      new THREE.Vector3(this.pos.x - r.x * side, this.pos.y, this.pos.z - r.z * side),
      new THREE.Vector3(this.pos.x + r.x * side, this.pos.y, this.pos.z + r.z * side),
      new THREE.Vector3(this.pos.x - r.x * side - f.x * 1.6, this.pos.y, this.pos.z - r.z * side - f.z * 1.6),
      new THREE.Vector3(this.pos.x + r.x * side + f.x * 1.6, this.pos.y, this.pos.z + r.z * side + f.z * 1.6),
      new THREE.Vector3(this.pos.x - f.x * end, this.pos.y, this.pos.z - f.z * end),
      new THREE.Vector3(this.pos.x + f.x * end, this.pos.y, this.pos.z + f.z * end),
    ];
  }

  /** World-space corners of the footprint, front-left first, clockwise. */
  corners(out = []) {
    const f = this.forward(), r = this.right();
    const hl = this.halfLength, hw = this.halfWidth;
    const pts = [[hl, -hw], [hl, hw], [-hl, hw], [-hl, -hw]];
    out.length = 0;
    for (const [along, across] of pts) {
      out.push({
        x: this.pos.x + f.x * along + r.x * across,
        z: this.pos.z + f.z * along + r.z * across,
      });
    }
    return out;
  }

  setLights(on) {
    if (this.lightsOn === on) return;
    this.lightsOn = on;
    const hex = on ? LIGHT_COLOURS.LIGHT_ON : LIGHT_COLOURS.LIGHT_OFF;
    for (const l of this.headlights) l.material.color.setHex(hex);
    this._emit('lights', { on });
  }

  setSiren(on) {
    if (!this.def.siren || this.sirenOn === on) return;
    this.sirenOn = on;
    this._emit('siren', { on, kind: this.def.siren });
  }

  honk() {
    if (this.hornTimer > 0) return;
    this.hornTimer = 0.45;
    this._emit('horn', { pitch: this.def.mass > 4000 ? 0.45 : 1 });
  }

  startEngine() {
    if (this.engineOn || this.destroyed) return false;
    if (!this.hasFuel()) { this._emit('no-fuel'); return false; }
    if (this.engineHealth <= 0) { this._emit('engine-dead'); return false; }
    this.engineOn = true;
    this.rpm = this.idleRpm;
    this._emit('engine-start');
    return true;
  }

  stopEngine() {
    if (!this.engineOn) return;
    this.engineOn = false;
    this.rpm = 0;
    this._emit('engine-stop');
  }

  /** Add fuel (litres / kWh). Returns the amount actually taken. */
  refuel(amount) {
    const take = Math.max(0, Math.min(amount, this.fuelCapacity - this.fuel));
    this.fuel += take;
    if (take > 0) this._emit('refuel', { amount: take });
    return take;
  }

  /** Repair body and components. */
  repair(amount = 100) {
    this.health = Math.min(100, this.health + amount);
    this.engineHealth = Math.min(100, this.engineHealth + amount);
    this.tankHealth = Math.min(100, this.tankHealth + amount);
    this.steeringBias *= Math.max(0, 1 - amount / 100);
    this.burning = 0;
    if (this.health > 10) this.destroyed = false;
    this._refreshDamageVisuals();
  }

  _emit(name, data) { if (this.onEvent) this.onEvent(name, data, this); }

  // ------------------------------------------------------------------ update

  /**
   * @param {number} dt
   * @param {object} input   Input instance (only read while occupied)
   * @param {object} world   Physics instance for collisions
   * @param {object} opts    {blocked, others:[Vehicle], surface}
   */
  update(dt, input, world, opts = {}) {
    dt = Math.max(MIN_DT, Math.min(dt, 0.05));
    if (this.hornTimer > 0) this.hornTimer -= dt;

    if (this.occupied && input && !opts.blocked) this._readInput(input, dt);
    else this._coastInput(dt);

    this._updateDrivetrain(dt);
    this._integrate(dt, opts.surface || 1);
    this._collide(world, opts.others, dt);
    this._consume(dt);
    this._updateVisuals(dt);
  }

  _readInput(input, dt) {
    const move = input.move || { x: 0, z: 0 };
    const demand = -(move.z || 0);           // W = +1
    const steerIn = -(move.x || 0);          // A = +1 (left)

    // Throttle / brake resolve against the direction of travel, so "S" brakes
    // when rolling forward and only reverses once stopped.
    const movingForward = this.speed > 0.6;
    const movingBack = this.speed < -0.6;
    if (demand > 0.02) {
      this.throttle = movingBack ? 0 : demand;
      this.brake = movingBack ? demand : 0;
    } else if (demand < -0.02) {
      this.throttle = movingForward ? 0 : -demand;
      this.brake = movingForward ? -demand : 0;
    } else {
      this.throttle = 0;
      this.brake = 0;
    }
    this.reverseRequest = demand < -0.02 && !movingForward;
    this.steerInput = steerIn;
    this.handbrakeOn = !!input.down('jump');

    if (input.pressed && input.pressed('horn')) this.honk();
    if (input.pressed && input.pressed('headlights')) this.setLights(!this.lightsOn);
    if (input.pressed && input.pressed('siren')) this.setSiren(!this.sirenOn);
    if (input.pressed && input.pressed('gearUp')) this._manualShift(1);
    if (input.pressed && input.pressed('gearDown')) this._manualShift(-1);
  }

  _coastInput() {
    this.throttle = 0;
    this.brake = 0;
    this.steerInput = 0;
    this.reverseRequest = false;
    this.handbrakeOn = !this.occupied && Math.abs(this.speed) < 0.4;
  }

  _manualShift(dir) {
    if (this.isElectric()) return;
    this.automatic = false;
    const next = Math.max(0, Math.min(this.gearCount, this.gear + dir));
    if (next !== this.gear) {
      this.gear = next;
      this.shiftTimer = this.shiftTime;
      this._emit('gear-change', { gear: this.gear });
    }
  }

  // ------------------------------------------------------------ drivetrain

  _updateDrivetrain(dt) {
    const def = this.def;

    if (this.occupied && !this.engineOn && this.throttle > 0.05) this.startEngine();
    if (this.engineOn && (!this.hasFuel() || this.engineHealth <= 0)) {
      this.engineOn = false;
      this.rpm = 0;
      this._emit(this.hasFuel() ? 'engine-dead' : 'out-of-fuel');
    }

    if (this.shiftTimer > 0) this.shiftTimer -= dt;

    // reverse engages only from a near stop
    if (this.reverseRequest && this.speed > -0.2 && this.speed < 0.6 && this.gear !== 0) {
      this.gear = 0;
      this._emit('gear-change', { gear: 0 });
    } else if (!this.reverseRequest && this.gear === 0 && this.speed >= -0.2 && this.throttle > 0.02) {
      this.gear = 1;
    }

    // engine speed follows the wheels through the current ratio
    const gearIdx = this.gear === 0 ? 0 : this.gear - 1;
    let wheelRpm = rpmForSpeed(def, gearIdx, this.speed);
    if (this.isElectric()) {
      this.rpm = Math.min(def.redline, wheelRpm);
      this.clutch = 1;
    } else if (this.engineOn) {
      // Launching: the clutch slips, so the engine sits at a raised "launch"
      // speed while the wheels catch up. A slipping clutch (or a torque
      // converter) MULTIPLIES torque, it does not divide it — that extra bite
      // off the line is what gets a heavy vehicle rolling at all.
      const idle = this.idleRpm;
      const launchRpm = idle + this.throttle * (def.redline * 0.45 - idle);
      const slipping = wheelRpm < launchRpm;
      this.clutch = slipping ? 1 + 0.65 * (1 - wheelRpm / Math.max(1, launchRpm)) : 1;
      const target = slipping ? launchRpm : wheelRpm;
      const blend = Math.min(1, (target > this.rpm ? 14 : 7) * dt);
      this.rpm += (Math.min(def.redline * 1.02, Math.max(idle, target)) - this.rpm) * blend;
      if (this.rpm > def.redline) this.rpm = def.redline;
    } else {
      this.rpm = Math.max(0, this.rpm - 2600 * dt);
      this.clutch = 0;
    }

    if (this.automatic && !this.isElectric() && this.engineOn && this.gear > 0 && this.shiftTimer <= 0) {
      this._autoShift(wheelRpm);
    }
  }

  _autoShift(wheelRpm) {
    const def = this.def;
    // sporty vehicles hold gears longer; heavy diesels shift early
    const sporty = def.power / def.mass > 0.09;
    const up = def.redline * (sporty ? 0.93 : 0.74) * (0.72 + this.throttle * 0.28);
    const down = def.redline * (sporty ? 0.42 : 0.34);
    if (this.gear < this.gearCount && this.rpm > up) {
      this.gear++;
      this.shiftTimer = this.shiftTime;
      this._emit('gear-change', { gear: this.gear, up: true });
    } else if (this.gear > 1) {
      const lowerRpm = rpmForSpeed(def, this.gear - 2, this.speed);
      if (wheelRpm < down && lowerRpm < def.redline * 0.95) {
        this.gear--;
        this.shiftTimer = this.shiftTime * 0.6;
        this._emit('gear-change', { gear: this.gear, up: false });
      }
    }
  }

  /** Longitudinal force the engine can put on the road right now (N). */
  _driveForce() {
    if (!this.engineOn || this.shiftTimer > 0) return 0;
    const def = this.def;
    const gearIdx = this.gear === 0 ? 0 : this.gear - 1;
    const ratio = def.gears[gearIdx] * def.finalDrive;
    const healthMul = 0.35 + 0.65 * (this.engineHealth / 100);
    let force = engineTorque(def, Math.max(this.rpm, def.redline * 0.1)) * ratio / def.wheelRadius;
    force = Math.min(force, (def.power * 1000 * healthMul) / Math.max(1.5, Math.abs(this.speed)));
    force *= this.throttle * this.clutch * healthMul;
    // electric motors fall off past their power band instead of a rev limiter
    if (this.isElectric() && this.rpm > def.redline * 0.8) force *= Math.max(0.1, 1 - (this.rpm / def.redline - 0.8) * 3);
    return this.gear === 0 ? -force * 0.72 : force;
  }

  // -------------------------------------------------------------- integrate

  _integrate(dt, surface) {
    const def = this.def;
    const f = this.forward(), r = this.right();

    // world velocity -> body frame
    let vLong = this.vel.x * f.x + this.vel.z * f.z;
    let vLat = this.vel.x * r.x + this.vel.z * r.z;
    const speedAbs = Math.hypot(vLong, vLat);

    // --- steering ----------------------------------------------------------
    // Lock shrinks with speed so the car is agile when parking and calm at pace.
    const speedN = Math.min(1, speedAbs / Math.max(8, this.maxSpeed));
    const lockScale = 1 - 0.68 * Math.pow(speedN, 0.75);
    const damaged = this.steeringBias * (1 - this.health / 100);
    const targetAngle = (this.steerInput * lockScale + damaged) * def.steerAngle;
    const rate = def.steerSpeed * (this.occupied ? 1 : 2.5) * def.steerAngle;
    const delta = targetAngle - this.steerAngle;
    this.steerAngle += Math.max(-rate * dt, Math.min(rate * dt, delta));
    if (!this.occupied) this.steerAngle *= Math.max(0, 1 - 3 * dt);

    // --- longitudinal forces ----------------------------------------------
    const grip = def.grip * surface;
    const weight = def.mass * GRAVITY;
    const drive = this._driveForce();

    let brakeF = 0;
    if (this.brake > 0.02) brakeF = def.brakeForce * this.brake;
    // the handbrake clamps the rear axle: it slows you down AND costs rear grip
    if (this.handbrakeOn) brakeF += def.handbrake;
    if (!this.occupied && Math.abs(vLong) > 0.05) brakeF = Math.max(brakeF, def.brakeForce * 0.08);
    // engine braking + regen on a closed throttle
    if (this.engineOn && this.throttle < 0.05 && Math.abs(vLong) > 0.4) {
      brakeF += this.isElectric() ? def.mass * 1.4 * (def.regen || 0.25) : def.mass * 0.55;
    }
    const rollFade = Math.min(1, Math.abs(vLong) / 0.7);   // no static push at rest
    const resist = 0.5 * AIR_DENSITY * def.drag * vLong * Math.abs(vLong) +
      def.rollResist * weight * Math.sign(vLong || 1) * rollFade;

    // --- load transfer ------------------------------------------------------
    // Accelerating shifts weight back, braking shifts it forward. The heights
    // involved are approximated by a third of the body height.
    const cgHeight = def.height * 0.38;
    const longAccelEst = (drive - brakeF * Math.sign(vLong || 1) - resist) / def.mass;
    const transfer = Math.max(-0.42, Math.min(0.42, (longAccelEst * cgHeight) / (def.wheelbase * GRAVITY)));
    const loadFront = Math.max(0.08, def.weightFront - transfer) * weight;
    const loadRear = Math.max(0.08, (1 - def.weightFront) - transfer * -1) * weight;

    // --- lateral forces (bicycle model) ------------------------------------
    const vLongSafe = Math.max(1.2, Math.abs(vLong)) * Math.sign(vLong || 1);
    const aFront = Math.atan2(vLat + this.yawRate * this.cgToFront, Math.abs(vLongSafe)) - this.steerAngle * Math.sign(vLongSafe);
    const aRear = Math.atan2(vLat - this.yawRate * this.cgToRear, Math.abs(vLongSafe));

    let fyFront = -this.caFront * clampAngle(aFront) * (loadFront / (def.weightFront * weight));
    let fyRear = -this.caRear * clampAngle(aRear) * (loadRear / ((1 - def.weightFront) * weight));

    // friction circle: longitudinal effort eats into cornering capability
    const share = tractionShare(def);
    const driveAtFront = def.drive === 'fwd' ? 1 : def.drive === 'awd' ? def.weightFront : 0;
    const longFront = Math.abs(drive * driveAtFront) + brakeF * 0.66;
    const longRear = Math.abs(drive * (1 - driveAtFront)) + brakeF * 0.34 + (this.handbrakeOn ? def.handbrake : 0);
    const maxFront = grip * loadFront;
    const maxRear = grip * loadRear * (this.handbrakeOn ? 0.32 : 1);
    fyFront = circleClamp(fyFront, maxFront, longFront);
    fyRear = circleClamp(fyRear, maxRear, longRear);

    // wheelspin: demanded drive beyond what the driven axle can hold
    const tractionLimit = grip * weight * share;
    const over = Math.abs(drive) / Math.max(1, tractionLimit);
    this.wheelSpin += (Math.max(0, Math.min(1, (over - 0.9) * 2.2)) - this.wheelSpin) * Math.min(1, 8 * dt);
    const driveApplied = Math.sign(drive) * Math.min(Math.abs(drive), tractionLimit * (1 + 0.08));

    // --- accelerations ------------------------------------------------------
    let aLong = (driveApplied - resist) / def.mass;
    if (brakeF > 0) {
      const maxBrakeDecel = Math.min(def.brakeForce, grip * weight) / def.mass;
      const applied = Math.min(brakeF / def.mass, maxBrakeDecel);
      if (Math.abs(vLong) > applied * dt) aLong -= applied * Math.sign(vLong);
      else { vLong = 0; aLong = Math.max(0, aLong); }
    }
    const aLat = (fyFront * Math.cos(this.steerAngle) + fyRear) / def.mass - this.yawRate * vLong;
    const yawTorque = fyFront * Math.cos(this.steerAngle) * this.cgToFront - fyRear * this.cgToRear;

    vLong += aLong * dt;
    vLat += aLat * dt;
    this.yawRate += (yawTorque / this.inertia) * dt;

    // Below walking pace the slip model has nothing to work with, so blend to
    // a kinematic steer. This is what keeps parking manoeuvres stable.
    const blend = Math.min(1, Math.abs(vLong) / KINEMATIC_SPEED);
    if (blend < 1) {
      const kinematicYaw = (vLong / def.wheelbase) * Math.tan(this.steerAngle);
      this.yawRate = this.yawRate * blend + kinematicYaw * (1 - blend);
      vLat *= blend * 0.85;
    }
    // yaw damping keeps heavy vehicles from oscillating
    this.yawRate *= Math.max(0, 1 - (def.mass > 4000 ? 2.4 : 1.1) * dt);

    // speed limiter and reverse cap
    const cap = def.limiter ? def.limiter / 3.6 : Infinity;
    if (vLong > cap) vLong = cap;
    if (vLong < -this.reverseSpeed) vLong = -this.reverseSpeed;
    if (Math.abs(vLong) < 0.02 && this.throttle < 0.02) vLong = 0;
    if (this.handbrakeOn && Math.abs(vLong) < 0.6) { vLong = 0; vLat *= 0.2; }

    // --- write back ---------------------------------------------------------
    this.rot += this.yawRate * dt;
    const nf = this.forward(), nr = this.right();
    this.vel.x = nf.x * vLong + nr.x * vLat;
    this.vel.z = nf.z * vLong + nr.z * vLat;
    this.speed = vLong;
    this.lateralSpeed = vLat;
    this.slipAngle = Math.abs(vLong) > 1 ? Math.atan2(vLat, Math.abs(vLong)) : 0;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    const skidTarget = Math.min(1, Math.abs(this.slipAngle) * 2.4 + this.wheelSpin * 0.8 +
      (this.handbrakeOn && Math.abs(vLong) > 3 ? 0.7 : 0));
    this.skid += (skidTarget - this.skid) * Math.min(1, 9 * dt);
    if (this.skid > 0.45 && this._skidCooldown == null) {
      this._skidCooldown = 0.35;
      this._emit('skid', { amount: this.skid });
    }
    if (this._skidCooldown != null) {
      this._skidCooldown -= dt;
      if (this._skidCooldown <= 0) this._skidCooldown = this.skid > 0.45 ? 0.35 : null;
    }
  }

  // -------------------------------------------------------------- collision

  _collide(world, others, dt) {
    if (world) {
      for (let i = 0; i < 3; i++) {
        const hit = this._resolveWorld(world);
        if (!hit) break;
      }
    }
    if (others && others.length) this._resolveVehicles(others);
  }

  /** Oriented-box vs world AABBs. Returns true if a contact was resolved. */
  _resolveWorld(world) {
    const reach = Math.max(this.halfLength, this.halfWidth) + 0.6;
    const boxes = world.query(this.pos.x - reach, this.pos.z - reach, this.pos.x + reach, this.pos.z + reach, []);
    let best = null;
    for (const b of boxes) {
      if (b.maxY < this.def.wheelRadius * 0.85) continue;       // kerbs: ride over
      if (b.minY > this.def.wheelRadius + this.def.height) continue; // overhead: pass under
      const mtv = obbAabbOverlap(this, b);
      if (mtv && (!best || mtv.depth > best.depth)) best = mtv;
    }
    if (!best) return false;
    this._applyContact(best.nx, best.nz, best.depth, Infinity);
    return true;
  }

  /**
   * Vehicle against vehicle. Resolved as a proper two-body impulse using the
   * RELATIVE velocity along the contact normal, so a seven-tonne truck shoves
   * a parked hatchback out of the way instead of bouncing off it.
   */
  _resolveVehicles(others) {
    for (const o of others) {
      if (o === this) continue;
      const dx = o.pos.x - this.pos.x, dz = o.pos.z - this.pos.z;
      const reach = this.halfLength + o.halfLength + 0.3;
      if (dx * dx + dz * dz > reach * reach) continue;
      const mtv = obbObbOverlap(this, o);
      if (!mtv) continue;

      const ma = this.def.mass, mb = o.def.mass;
      const invA = 1 / ma, invB = 1 / mb;
      const share = invA / (invA + invB);          // the lighter one moves more

      // positional correction
      this.pos.x += mtv.nx * mtv.depth * share;
      this.pos.z += mtv.nz * mtv.depth * share;
      o.pos.x -= mtv.nx * mtv.depth * (1 - share);
      o.pos.z -= mtv.nz * mtv.depth * (1 - share);

      // relative approach speed along the normal
      const rvx = this.vel.x - o.vel.x, rvz = this.vel.z - o.vel.z;
      const vn = rvx * mtv.nx + rvz * mtv.nz;
      if (vn >= 0) continue;                        // already separating

      const restitution = 0.15;
      const j = -(1 + restitution) * vn / (invA + invB);
      this.vel.x += mtv.nx * j * invA;
      this.vel.z += mtv.nz * j * invA;
      o.vel.x -= mtv.nx * j * invB;
      o.vel.z -= mtv.nz * j * invB;

      // tangential friction between the panels
      const tx = -mtv.nz, tz = mtv.nx;
      const vt = (this.vel.x - o.vel.x) * tx + (this.vel.z - o.vel.z) * tz;
      const jt = -vt * 0.35 / (invA + invB);
      this.vel.x += tx * jt * invA;
      this.vel.z += tz * jt * invA;
      o.vel.x -= tx * jt * invB;
      o.vel.z -= tz * jt * invB;

      // spin both bodies from the glancing component
      this.yawRate = clamp(this.yawRate + vt * 0.02 * (mb / (ma + mb)), -3.2, 3.2);
      o.yawRate = clamp(o.yawRate - vt * 0.02 * (ma / (ma + mb)), -3.2, 3.2);

      // resync body-frame speeds and share the damage out by closing speed
      const fa = this.forward(), fo = o.forward();
      this.speed = this.vel.x * fa.x + this.vel.z * fa.z;
      o.speed = o.vel.x * fo.x + o.vel.z * fo.z;

      const impact = -vn;
      if (impact > 1.2) {
        this._damage(impact * (mb / (ma + mb)) * 2, { facing: fa.x * mtv.nx + fa.z * mtv.nz, other: o });
        o._damage(impact * (ma / (ma + mb)) * 2, { facing: -(fo.x * mtv.nx + fo.z * mtv.nz), other: this });
      }
    }
  }

  /**
   * Push out of a contact and respond to it: normal velocity is reflected with
   * restitution, tangential velocity is scrubbed by friction, and an offset
   * contact spins the vehicle.
   */
  _applyContact(nx, nz, depth, otherMass, other = null) {
    this.pos.x += nx * depth;
    this.pos.z += nz * depth;

    const vn = this.vel.x * nx + this.vel.z * nz;
    if (vn >= 0) return;                     // already separating

    const impact = -vn;
    const massFactor = otherMass === Infinity ? 1 : otherMass / (this.def.mass + otherMass);
    const restitution = other ? 0.18 : 0.12;
    const dv = -(1 + restitution) * vn * (other ? massFactor * 2 : 1);
    this.vel.x += nx * dv;
    this.vel.z += nz * dv;

    // scrape: kill some of the sliding speed along the wall
    const tx = -nz, tz = nx;
    const vt = this.vel.x * tx + this.vel.z * tz;
    const scrub = Math.min(1, 0.22 + impact * 0.03);
    this.vel.x -= tx * vt * scrub;
    this.vel.z -= tz * vt * scrub;

    // glancing blows spin the body
    const f = this.forward();
    const facing = f.x * nx + f.z * nz;
    this.yawRate += (-facing) * vt * 0.045 + (Math.random() - 0.5) * impact * 0.015;
    this.yawRate = Math.max(-3.2, Math.min(3.2, this.yawRate));

    this.speed = this.vel.x * f.x + this.vel.z * f.z;

    if (impact > 1.2) this._damage(impact, { nx, nz, facing, other });
  }

  // ----------------------------------------------------------------- damage

  _damage(impact, info = {}) {
    const def = this.def;
    // kinetic energy scaled to a 0-100 bar, softened by the shell's armour
    const energy = 0.5 * def.mass * impact * impact;
    let dmg = (energy / (def.mass * 9)) / Math.max(0.3, def.armour);
    if (info.other) dmg *= 0.75;
    dmg = Math.min(60, dmg);
    if (dmg < 0.4) return;

    this.health = Math.max(0, this.health - dmg);

    // The contact normal points away from whatever was hit, so a head-on
    // impact gives facing ~= -1 and a rear-ender gives facing ~= +1.
    const facing = info.facing ?? 0;
    if (facing < -0.5) this.engineHealth = Math.max(0, this.engineHealth - dmg * 1.3);
    else if (facing > 0.5) this.tankHealth = Math.max(0, this.tankHealth - dmg * 1.1);
    else this.steeringBias += (Math.random() - 0.5) * dmg * 0.012;
    this.steeringBias = Math.max(-0.5, Math.min(0.5, this.steeringBias));

    if (this.onImpact) this.onImpact(impact, this);
    this._emit('impact', { impact, damage: dmg, health: this.health });

    if (this.health <= 0 && !this.destroyed) {
      this.destroyed = true;
      this.engineOn = false;
      this.burning = 1;
      this._emit('destroyed', {});
    } else if (this.health < 32 && this.engineHealth < 40) {
      this.burning = Math.max(this.burning, 0.35);
    }
    this._refreshDamageVisuals();
  }

  /** Crumple the shell a little as condition drops. */
  _refreshDamageVisuals() {
    const d = 1 - this.health / 100;
    const g = this.parts.group;
    g.scale.set(1 - d * 0.05, 1 - d * 0.09, 1 - d * 0.03);
    g.rotation.z = (this.steeringBias) * 0.35;
    if (this.parts.bodyMaterial && this.parts.bodyMaterial.color) {
      const c = new THREE.Color(this.colour);
      c.multiplyScalar(1 - d * 0.45);
      this.parts.bodyMaterial.color.copy(c);
    }
  }

  // ------------------------------------------------------------- consumables

  _consume(dt) {
    const def = this.def;
    if (this.tankHealth < 45 && this.fuel > 0) {
      this.fuel = Math.max(0, this.fuel - (45 - this.tankHealth) * 0.0022 * dt * (def.fuelCapacity / 60));
    }
    if (!this.engineOn) return;

    const load = Math.max(0, Math.min(1, (Math.abs(this._driveForce()) * Math.max(1, Math.abs(this.speed))) / (def.power * 1000)));
    const revShare = this.isElectric() ? 0 : this.rpmFraction() * 0.22;
    let burn = def.idleBurn + (def.fuelBurn - def.idleBurn) * Math.min(1, load + revShare);

    // electric regen: braking puts energy back in the pack
    if (this.isElectric() && this.throttle < 0.05 && this.speed > 1) {
      const recovered = (def.regen || 0.25) * def.mass * Math.abs(this.speed) * 0.000014;
      this.fuel = Math.min(this.fuelCapacity, this.fuel + recovered * dt * 60);
    }

    const scale = Vehicle.fuelScale;
    this.fuel = Math.max(0, this.fuel - (burn / 3600) * dt * scale);
    if (this.fuel <= 0) {
      this.fuel = 0;
      this.engineOn = false;
      this._emit('out-of-fuel');
    } else if (!this._lowFuelWarned && this.fuelFraction() < 0.12) {
      this._lowFuelWarned = true;
      this._emit('low-fuel', { fraction: this.fuelFraction() });
    } else if (this.fuelFraction() > 0.2) {
      this._lowFuelWarned = false;
    }
    if (this.burning > 0) {
      this.burning = Math.min(1, this.burning + dt * 0.04);
      this.health = Math.max(0, this.health - dt * 1.6);
      this.engineHealth = Math.max(0, this.engineHealth - dt * 2.4);
    }
  }

  // -------------------------------------------------------------- animation

  _updateVisuals(dt) {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.rot;

    const def = this.def;
    const speedN = Math.min(1, Math.abs(this.speed) / Math.max(6, this.maxSpeed * 0.6));

    // suspension: roll into corners, pitch under power and braking
    const latAccel = this.yawRate * this.speed;
    const rollTarget = Math.max(-0.22, Math.min(0.22, latAccel * 0.012 + this.slipAngle * 0.05));
    const pitchTarget = Math.max(-0.09, Math.min(0.09, (this.brake * 0.055 - this.throttle * 0.035 * (1 - speedN * 0.4))));
    const soft = def.mass > 3000 ? 5 : 8;
    this.body.rotation.z += (rollTarget * (def.class === 'van' || def.class === 'bus' ? 1.6 : 1) - this.body.rotation.z) * Math.min(1, soft * dt);
    this.body.rotation.x += (pitchTarget - this.body.rotation.x) * Math.min(1, soft * dt);

    // two-wheelers lean instead of rolling
    if (this.leanGroup && this.leanMax) {
      const lean = Math.max(-this.leanMax, Math.min(this.leanMax, -latAccel * 0.055 - this.steerAngle * 0.25 * (1 - speedN)));
      this.leanGroup.rotation.z += (lean - this.leanGroup.rotation.z) * Math.min(1, 7 * dt);
      this.body.rotation.z = 0;
    }

    // wheels: roll at road speed, lock under heavy braking, spin on power
    const roll = (this.speed / def.wheelRadius) * dt;
    const locked = this.brake > 0.8 && Math.abs(this.speed) > 2;
    const spinBoost = 1 + this.wheelSpin * 2.5;
    for (const w of this.wheels) {
      if (!locked) w.mesh.rotation.x += roll * (w.front ? 1 : spinBoost);
      if (w.steered) w.pivot.rotation.y = this.steerAngle;
    }
    if (this.parts.handlebars) this.parts.handlebars.rotation.y = this.steerAngle * 0.8;

    // lights
    const braking = this.brake > 0.05 || this.handbrakeOn;
    const reversing = this.speed < -0.4;
    const tailHex = braking ? LIGHT_COLOURS.TAIL_ON : (this.lightsOn ? 0xc23a2a : LIGHT_COLOURS.TAIL_OFF);
    for (const t of this.taillights) t.material.color.setHex(reversing ? 0xf2f2f2 : tailHex);

    // emergency beacons
    if (this.beacons.length) {
      this.beaconPhase += dt * 7.5;
      for (const b of this.beacons) {
        const lit = this.sirenOn && (Math.floor(this.beaconPhase + b.phase * 0.5) % 2 === 0);
        b.mesh.material.color.setHex(lit ? b.colour : mulHex(b.colour, 0.22));
      }
    }
    if (this.parts.taxiSign) {
      this.parts.taxiSign.material.color.setHex(this.occupied ? 0x3a3a3a : 0xf2d16b);
    }

    this.engineTick = this.rpmFraction();
    this._updateSmoke(dt);
  }

  _updateSmoke(dt) {
    const want = this.burning > 0 || (this.engineHealth < 45 && this.engineOn);
    if (want && !this.smoke) {
      const geo = new THREE.SphereGeometry(0.42, 6, 5);
      const mat = new THREE.MeshBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.55 });
      this.smoke = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const puff = new THREE.Mesh(geo, mat.clone());
        puff.position.set((Math.random() - 0.5) * 0.6, 0, 0);
        puff.userData.t = i / 5;
        this.smoke.add(puff);
      }
      this.smoke.position.set(0, this.def.wheelRadius + this.def.height * 0.5, this.def.length * 0.42);
      this.group.add(this.smoke);
    }
    if (!this.smoke) return;
    if (!want) {
      this.group.remove(this.smoke);
      this.smoke = null;
      return;
    }
    const intensity = this.burning > 0 ? 1 : 0.45;
    for (const puff of this.smoke.children) {
      puff.userData.t += dt * (0.5 + intensity);
      if (puff.userData.t > 1) puff.userData.t -= 1;
      const t = puff.userData.t;
      puff.position.y = t * 2.4;
      puff.scale.setScalar(0.25 + t * (0.8 + intensity));
      puff.material.opacity = (1 - t) * 0.5 * intensity;
      puff.material.color.setHex(this.burning > 0 ? (t < 0.3 ? 0xff7a2a : 0x3a3a3a) : 0x4a4a4a);
    }
  }

  /** Condition summary for the HUD / save file. */
  snapshot() {
    return {
      id: this.id, type: this.type, x: this.pos.x, z: this.pos.z, rot: this.rot,
      fuel: this.fuel, health: this.health, engineHealth: this.engineHealth,
      tankHealth: this.tankHealth, colour: this.colour,
    };
  }

  restore(s) {
    if (!s) return;
    this.pos.set(s.x ?? this.pos.x, 0, s.z ?? this.pos.z);
    this.rot = s.rot ?? this.rot;
    this.fuel = s.fuel ?? this.fuel;
    this.health = s.health ?? this.health;
    this.engineHealth = s.engineHealth ?? this.engineHealth;
    this.tankHealth = s.tankHealth ?? this.tankHealth;
    this.destroyed = this.health <= 0;
    this.vel.set(0, 0, 0);
    this.speed = 0;
    this.yawRate = 0;
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.rot;
    this._refreshDamageVisuals();
  }

  remove() { if (this.scene) this.scene.remove(this.group); }
}

/** Global fuel-burn multiplier — a full tank should last a session, not a week. */
Vehicle.fuelScale = 1;

const MEASURED = new Map();
const NO_WORLD = { query: () => [] };

/**
 * Measure what a vehicle actually does, by running it headless through this
 * very simulation. The garage shows these rather than paper figures, so the
 * numbers on the card are the numbers you feel through the wheel.
 * Cached per type; a run costs a couple of milliseconds.
 */
Vehicle.measure = function measure(type) {
  if (MEASURED.has(type)) return MEASURED.get(type);
  const def = VEHICLES[type] || VEHICLES.sedan;
  const dt = 1 / 60;
  const fresh = () => {
    const v = new Vehicle(null, 0, 0, type);
    v.occupied = true;
    v.fuel = v.fuelCapacity;
    v.startEngine();
    return v;
  };
  const stick = (x, z) => ({ move: { x, z }, down: () => false, pressed: () => false });

  // standing start
  let v = fresh();
  const flat = stick(0, -1);
  let t = 0, zeroTo100 = null, zeroTo60 = null;
  while (t < 75) {
    v.update(dt, flat, NO_WORLD, {});
    t += dt;
    if (!zeroTo60 && v.speed * 3.6 >= 60) zeroTo60 = t;
    if (v.speed * 3.6 >= 100) { zeroTo100 = t; break; }
  }
  // roll on to terminal velocity
  let last = v.speed, stable = 0;
  while (t < 240 && stable < 1.5) {
    v.update(dt, flat, NO_WORLD, {});
    t += dt;
    if (Math.abs(v.speed - last) < 0.004) stable += dt; else stable = 0;
    last = v.speed;
  }
  const topKmh = v.speed * 3.6;
  // range at a steady cruise, costed against the power that cruise actually needs
  const cruise = Math.min(25, (topKmh / 3.6) * 0.6);
  const litresPerHour = Math.max(0.2, burnRateAt(def, cruise));

  // braking from 100 km/h (or from its top speed if it cannot reach 100)
  v = fresh();
  const from = Math.min(100 / 3.6, topKmh / 3.6);
  v.speed = from; v.vel.set(0, 0, from); v.rot = 0;
  const brakePedal = stick(0, 1);
  let dist = 0; t = 0;
  while (v.speed > 0.2 && t < 40) {
    v.update(dt, brakePedal, NO_WORLD, {});
    dist += Math.max(0, v.speed) * dt;
    t += dt;
  }

  const stats = {
    id: type,
    name: def.name,
    class: def.class,
    desc: def.desc,
    zeroTo60, zeroToHundred: zeroTo100,
    topSpeedKmh: topKmh,
    brakingDistance: dist,
    brakingFrom: from * 3.6,
    turningCircle: 2 * (def.wheelbase / Math.tan(def.steerAngle)) + def.track,
    mass: def.mass,
    power: def.power,
    seats: def.seats,
    fuelType: def.fuelType,
    fuelCapacity: def.fuelCapacity,
    rangeKm: (def.fuelCapacity / litresPerHour) * cruise * 3.6,
    // 0..1 bars for the garage card
    bars: {
      speed: Math.min(1, topKmh / 290),
      accel: zeroTo100 ? Math.min(1, 8 / zeroTo100) : Math.min(1, (zeroTo60 ? 5 / zeroTo60 : 0.1)),
      braking: Math.min(1, 34 / Math.max(10, dist)),
      handling: Math.min(1, 14 / (2 * (def.wheelbase / Math.tan(def.steerAngle)) + def.track)),
      toughness: Math.min(1, def.armour / 3.2),
    },
  };
  MEASURED.set(type, stats);
  return stats;
};

// ---------------------------------------------------------------------------
// maths helpers
// ---------------------------------------------------------------------------

function clampAngle(a) { return Math.max(-0.45, Math.min(0.45, a)); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** Clamp a lateral force so lateral and longitudinal demand share one circle. */
function circleClamp(lateral, maxForce, longitudinal) {
  const avail = Math.sqrt(Math.max(0, maxForce * maxForce - longitudinal * longitudinal));
  const limit = Math.max(maxForce * 0.12, avail);
  return Math.max(-limit, Math.min(limit, lateral));
}

function mulHex(hex, f) {
  const r = Math.floor(((hex >> 16) & 255) * f);
  const g = Math.floor(((hex >> 8) & 255) * f);
  const b = Math.floor((hex & 255) * f);
  return (r << 16) | (g << 8) | b;
}

/** Project an oriented box onto an axis -> [min, max]. */
function projectOBB(cx, cz, axes, half, ax, az) {
  const centre = cx * ax + cz * az;
  let radius = 0;
  for (let i = 0; i < 2; i++) radius += Math.abs(axes[i].x * ax + axes[i].z * az) * half[i];
  return [centre - radius, centre + radius];
}

function vehicleAxes(v) {
  const f = v.forward(), r = v.right();
  return [{ x: f.x, z: f.z }, { x: r.x, z: r.z }];
}

/**
 * Separating-axis test between a vehicle footprint and a world AABB.
 * @returns {{nx:number, nz:number, depth:number}|null} push-out for the vehicle
 */
export function obbAabbOverlap(v, box) {
  const axes = vehicleAxes(v);
  const half = [v.halfLength, v.halfWidth];
  const bcx = (box.minX + box.maxX) / 2, bcz = (box.minZ + box.maxZ) / 2;
  const bhx = (box.maxX - box.minX) / 2, bhz = (box.maxZ - box.minZ) / 2;
  const candidates = [axes[0], axes[1], { x: 1, z: 0 }, { x: 0, z: 1 }];

  let bestDepth = Infinity, bestAxis = null;
  for (const ax of candidates) {
    const [aMin, aMax] = projectOBB(v.pos.x, v.pos.z, axes, half, ax.x, ax.z);
    const bCentre = bcx * ax.x + bcz * ax.z;
    const bRadius = Math.abs(ax.x) * bhx + Math.abs(ax.z) * bhz;
    const bMin = bCentre - bRadius, bMax = bCentre + bRadius;
    if (aMax <= bMin || bMax <= aMin) return null;
    const depth = Math.min(aMax - bMin, bMax - aMin);
    if (depth < bestDepth) { bestDepth = depth; bestAxis = ax; }
  }
  // point the axis away from the obstacle
  const dx = v.pos.x - bcx, dz = v.pos.z - bcz;
  const sign = (dx * bestAxis.x + dz * bestAxis.z) < 0 ? -1 : 1;
  return { nx: bestAxis.x * sign, nz: bestAxis.z * sign, depth: bestDepth };
}

/** Separating-axis test between two vehicle footprints. */
export function obbObbOverlap(a, b) {
  const axesA = vehicleAxes(a), axesB = vehicleAxes(b);
  const halfA = [a.halfLength, a.halfWidth], halfB = [b.halfLength, b.halfWidth];
  const candidates = [axesA[0], axesA[1], axesB[0], axesB[1]];
  let bestDepth = Infinity, bestAxis = null;
  for (const ax of candidates) {
    const [aMin, aMax] = projectOBB(a.pos.x, a.pos.z, axesA, halfA, ax.x, ax.z);
    const [bMin, bMax] = projectOBB(b.pos.x, b.pos.z, axesB, halfB, ax.x, ax.z);
    if (aMax <= bMin || bMax <= aMin) return null;
    const depth = Math.min(aMax - bMin, bMax - aMin);
    if (depth < bestDepth) { bestDepth = depth; bestAxis = ax; }
  }
  const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
  const sign = (dx * bestAxis.x + dz * bestAxis.z) < 0 ? -1 : 1;
  return { nx: bestAxis.x * sign, nz: bestAxis.z * sign, depth: bestDepth };
}
