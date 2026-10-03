import * as THREE from 'three';
import { CONFIG } from '../config.js';

// ---------------------------------------------------------------------------
// Third-person spring-arm camera.
//
//   pivot      a damped point tracking the player's shoulders (softer on Y so
//              stairs, step-ups and landings don't jolt the frame)
//   arm        yaw/pitch orbit with per-mode length, shoulder offset and FOV
//   collision  sphere sweep from the pivot to the desired position: retracts
//              instantly, extends slowly
//   feedback   recoil impulses, landing dips and shake impulses
//
// Yaw convention matches the player: forward = (sin yaw, 0, cos yaw).
// ---------------------------------------------------------------------------

const C = CONFIG.camera;

const MODES = {
  normal:  { dist: C.distance,        height: C.height,        shoulder: C.shoulder,     fov: C.fov,        lag: C.followLag, rotLag: C.rotateLag },
  sprint:  { dist: C.sprintDistance,  height: C.height + 0.04, shoulder: C.shoulder * 0.8, fov: C.fovSprint, lag: C.followLag * 0.8, rotLag: C.rotateLag },
  crouch:  { dist: C.crouchDistance,  height: C.crouchHeight,  shoulder: C.shoulder,     fov: C.fov - 2,    lag: C.followLag, rotLag: C.rotateLag },
  aim:     { dist: C.aimDistance,     height: C.aimHeight,     shoulder: C.aimShoulder,  fov: C.fovAim,     lag: C.followLag * 1.6, rotLag: C.rotateLag * 1.2 },
  vehicle: { dist: C.vehicleDistance, height: C.vehicleHeight, shoulder: 0,              fov: C.fovVehicle, lag: C.followLag * 0.55, rotLag: C.rotateLag * 0.7 },
  climb:   { dist: C.distance * 0.8,  height: C.height + 0.2,  shoulder: C.shoulder * 1.3, fov: C.fov + 2,  lag: C.followLag * 0.9, rotLag: C.rotateLag },
  slide:   { dist: C.slideDistance,   height: C.crouchHeight - 0.08, shoulder: C.shoulder * 0.9, fov: C.fovSprint - 1, lag: C.followLag * 0.7, rotLag: C.rotateLag * 0.9 },
};

const expSmooth = (k, dt) => 1 - Math.exp(-k * dt);

export class CameraController {
  constructor(camera, settings) {
    this.camera = camera;
    this.settings = settings;

    this.yaw = Math.PI;             // looking down -Z by default
    this.pitch = -0.16;
    this.yawTarget = this.yaw;
    this.pitchTarget = this.pitch;

    this.mode = 'normal';
    this.params = { ...MODES.normal };
    this.zoomBias = 0;              // mouse-wheel offset on the arm length
    this.shoulderSide = settings?.shoulderSide ?? 1;

    this.pivot = new THREE.Vector3();
    this.pivotTarget = new THREE.Vector3();
    this.armLength = C.distance;
    this.currentFov = C.fov;

    this.recoil = { pitch: 0, yaw: 0 };
    this.shake = { amp: 0, time: 0, freq: 24 };
    this.dip = 0;                   // vertical impulse on landing
    this.extraFov = 0;

    this._initialised = false;
    this._offset = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  /** Feed raw look deltas (mouse pixels / scaled stick units). */
  look(dx, dy, aiming = false) {
    const s = this.settings || {};
    let sens = C.sensitivity * (s.sensitivity ?? 1);
    if (aiming) sens *= (s.aimSensitivity ?? 0.6);
    this.yawTarget += dx * sens;
    this.pitchTarget -= dy * sens * (s.invertY ? -1 : 1);
    this.pitchTarget = Math.max(C.minPitch, Math.min(C.maxPitch, this.pitchTarget));
  }

  zoom(wheelSteps) {
    if (!wheelSteps) return;
    this.zoomBias = Math.max(-2.6, Math.min(4.2, this.zoomBias + wheelSteps * 0.5));
  }

  swapShoulder() {
    this.shoulderSide *= -1;
    if (this.settings) this.settings.shoulderSide = this.shoulderSide;
  }

  setMode(mode) { if (MODES[mode]) this.mode = mode; }

  addRecoil(pitch, yaw) {
    this.recoil.pitch += pitch;
    this.recoil.yaw += yaw;
  }

  addShake(amp, duration = 0.3) {
    const scale = this.settings?.cameraShake ?? 1;
    this.shake.amp = Math.max(this.shake.amp, amp * scale);
    this.shake.time = Math.max(this.shake.time, duration);
  }

  addDip(amount) { this.dip = Math.max(this.dip, amount * (this.settings?.cameraShake ?? 1)); }

  /** Jump the camera straight to its target (teleports, respawns, loads). */
  snap(targetPos) {
    this.pivotTarget.set(targetPos.x, targetPos.y + this.params.height, targetPos.z);
    this.pivot.copy(this.pivotTarget);
    this.yaw = this.yawTarget;
    this.pitch = this.pitchTarget;
    this.armLength = this.params.dist;
    this._initialised = true;
    this._place(0);
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  /**
   * @param {number} dt
   * @param {object} opts { target: Vector3 (feet), mode, world, velocity, stance }
   * @returns {number} camera yaw, for camera-relative movement
   */
  update(dt, opts = {}) {
    const target = opts.target || new THREE.Vector3();
    if (opts.mode) this.setMode(opts.mode);
    let want = MODES[this.mode] || MODES.normal;

    // Driving: frame the vehicle by its actual size and speed. A scooter sits
    // close and low, a fire truck needs the camera well back and high, and
    // everything drifts further out the faster it is going.
    if (this.mode === 'vehicle' && opts.vehicle) {
      const v = opts.vehicle;
      const size = Math.max(v.def.length, v.def.width * 1.6);
      const speedN = Math.min(1, Math.abs(v.speed) / Math.max(8, v.maxSpeed * 0.55));
      const dist = Math.max(C.vehicleMinDistance, Math.min(C.vehicleMaxDistance,
        size * C.vehicleSizeScale + 3.0 + speedN * C.vehicleSpeedPull));
      want = {
        ...want,
        dist,
        height: v.def.height * 0.75 + 1.0,
        fov: C.fovVehicle + speedN * C.vehicleFovSpeed,
      };
    }

    // ---- blend mode parameters ------------------------------------------
    const mk = expSmooth(this.mode === 'aim' ? 16 : 9, dt);
    this.params.dist += (want.dist - this.params.dist) * mk;
    this.params.height += (want.height - this.params.height) * mk;
    this.params.shoulder += (want.shoulder - this.params.shoulder) * mk;
    this.params.fov += (want.fov - this.params.fov) * mk;
    this.params.lag += (want.lag - this.params.lag) * mk;
    this.params.rotLag += (want.rotLag - this.params.rotLag) * mk;

    // ---- look smoothing + recoil ----------------------------------------
    const rk = expSmooth(this.params.rotLag, dt);
    this.yaw += (this.yawTarget - this.yaw) * rk;
    this.pitch += (this.pitchTarget - this.pitch) * rk;

    // recoil decays back into the aim point
    const recoverK = expSmooth(9, dt);
    this.recoil.pitch -= this.recoil.pitch * recoverK;
    this.recoil.yaw -= this.recoil.yaw * recoverK;

    const yaw = this.yaw + this.recoil.yaw;
    const pitch = Math.max(C.minPitch - 0.2, Math.min(C.maxPitch + 0.2, this.pitch + this.recoil.pitch));

    // ---- pivot ------------------------------------------------------------
    const vel = opts.velocity;
    let leadX = 0, leadZ = 0;
    if (vel && this.mode !== 'aim') {
      const sp = Math.hypot(vel.x, vel.z);
      if (sp > 0.5) {
        const lead = Math.min(1, sp / 8) * C.lookAhead;
        leadX = (vel.x / sp) * lead; leadZ = (vel.z / sp) * lead;
      }
    }
    this.pivotTarget.set(target.x + leadX, target.y + this.params.height, target.z + leadZ);
    if (!this._initialised) { this.pivot.copy(this.pivotTarget); this._initialised = true; }

    const kXZ = expSmooth(this.params.lag, dt);
    const kY = expSmooth(this.mode === 'vehicle' ? C.followLagY * 0.8 : C.followLagY, dt);
    this.pivot.x += (this.pivotTarget.x - this.pivot.x) * kXZ;
    this.pivot.z += (this.pivotTarget.z - this.pivot.z) * kXZ;
    this.pivot.y += (this.pivotTarget.y - this.pivot.y) * kY;

    // ---- desired arm ------------------------------------------------------
    const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
    const dirX = Math.sin(yaw) * cosP, dirY = sinP, dirZ = Math.cos(yaw) * cosP;
    const rightX = -Math.cos(yaw), rightZ = Math.sin(yaw);

    const wantDist = Math.max(C.minDistance, Math.min(C.maxDistance, this.params.dist + this.zoomBias));
    const shoulder = this.params.shoulder * this.shoulderSide;

    const originX = this.pivot.x + rightX * shoulder * 0.6;
    const originY = this.pivot.y;
    const originZ = this.pivot.z + rightZ * shoulder * 0.6;

    this._desired.set(
      originX - dirX * wantDist + rightX * shoulder * 0.4,
      originY - dirY * wantDist,
      originZ - dirZ * wantDist + rightZ * shoulder * 0.4,
    );

    // ---- collision --------------------------------------------------------
    let allowed = wantDist;
    if (opts.world) {
      const from = { x: originX, y: originY, z: originZ };
      const frac = opts.world.sweepSphere(from, this._desired, C.collisionRadius);
      allowed = wantDist * frac;
      allowed = Math.max(0.45, allowed - (frac < 1 ? 0.08 : 0));
    }
    if (allowed < this.armLength) {
      this.armLength += (allowed - this.armLength) * expSmooth(C.pullInSpeed, dt);
    } else {
      this.armLength += (allowed - this.armLength) * expSmooth(C.pullOutSpeed, dt);
    }
    this.armLength = Math.min(this.armLength, wantDist);

    // ---- place ------------------------------------------------------------
    this._place(dt, { originX, originY, originZ, dirX, dirY, dirZ, rightX, rightZ, shoulder, pitch, yaw });

    // ---- fov --------------------------------------------------------------
    let fov = this.params.fov + this.extraFov;
    if (opts.speedBoostFov) fov += opts.speedBoostFov;
    this.extraFov -= this.extraFov * expSmooth(6, dt);
    if (Math.abs(this.currentFov - fov) > 0.01) {
      this.currentFov += (fov - this.currentFov) * expSmooth(8, dt);
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    return this.yaw;
  }

  _place(dt, p) {
    if (!p) {
      const cosP = Math.cos(this.pitch), sinP = Math.sin(this.pitch);
      p = {
        originX: this.pivot.x, originY: this.pivot.y, originZ: this.pivot.z,
        dirX: Math.sin(this.yaw) * cosP, dirY: sinP, dirZ: Math.cos(this.yaw) * cosP,
        rightX: -Math.cos(this.yaw), rightZ: Math.sin(this.yaw), shoulder: 0, pitch: this.pitch, yaw: this.yaw,
      };
    }
    // Landing dip + shake offsets
    if (this.dip > 0.0001) this.dip -= this.dip * expSmooth(7, Math.max(dt, 0.0001));
    let shakeX = 0, shakeY = 0;
    if (this.shake.time > 0) {
      this.shake.time = Math.max(0, this.shake.time - dt);
      const decay = this.shake.time > 0 ? this.shake.time : 0;
      const t = performance.now() * 0.001;
      shakeX = Math.sin(t * this.shake.freq) * this.shake.amp * decay;
      shakeY = Math.cos(t * this.shake.freq * 1.37) * this.shake.amp * decay;
      if (this.shake.time <= 0) this.shake.amp = 0;
    }

    const d = this.armLength;
    this.camera.position.set(
      p.originX - p.dirX * d + p.rightX * p.shoulder * 0.4 + shakeX,
      p.originY - p.dirY * d - this.dip + shakeY,
      p.originZ - p.dirZ * d + p.rightZ * p.shoulder * 0.4,
    );
    this._lookTarget.set(
      p.originX + p.dirX * 6 + shakeX,
      p.originY + p.dirY * 6 - this.dip * 0.6 + shakeY,
      p.originZ + p.dirZ * 6,
    );
    this.camera.lookAt(this._lookTarget);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Convert a WASD vector into world XZ space, relative to the camera. */
  moveRelative(mv) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    return { x: fx * -mv.z + rx * mv.x, z: fz * -mv.z + rz * mv.x };
  }

  /** Ray from the camera through the screen centre (weapon aiming). */
  aimRay() {
    const cosP = Math.cos(this.pitch + this.recoil.pitch);
    const dir = new THREE.Vector3(
      Math.sin(this.yaw + this.recoil.yaw) * cosP,
      Math.sin(this.pitch + this.recoil.pitch),
      Math.cos(this.yaw + this.recoil.yaw) * cosP,
    ).normalize();
    return { origin: this.camera.position.clone(), dir };
  }

  get forwardYaw() { return this.yaw; }
}
