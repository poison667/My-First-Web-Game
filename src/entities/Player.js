import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { buildPlayerRig } from './PlayerRig.js';
import { PlayerAnimator, FIST_COMBO, WEAPON_COMBO } from './PlayerAnimator.js';

// ---------------------------------------------------------------------------
// Third-person player controller.
//
// Motion states
//   ground   normal locomotion (idle/walk/jog/sprint/crouch) + jumping
//   air      airborne, with air control and landing prediction
//   vault    scripted motion over a low obstacle
//   mantle   scripted motion climbing onto a ledge
//   ladder   attached to a ladder volume
//   vehicle  driving (character hidden, controller dormant)
//   ko       knocked out
//
// Feel notes
//   * velocity based, with separate accel/decel so stops are crisp but not icy
//   * coyote time + jump buffering + variable jump height
//   * the body yaws smoothly toward the movement direction, but snaps to the
//     camera when aiming (strafe mode)
//   * ledges are probed every frame so vaults/mantles trigger on contact
// ---------------------------------------------------------------------------

const P = CONFIG.player;
const TAU = Math.PI * 2;

function shortestAngle(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class Player {
  constructor(scene, state, opts = {}) {
    this.scene = scene;
    this.state = state;
    this.world = opts.world || null;
    this.settings = opts.settings || CONFIG.defaultSettings;
    this.onEvent = opts.onEvent || (() => {});

    this.rig = buildPlayerRig(opts.outfit);
    this.group = this.rig.root;
    scene.add(this.group);
    this.animator = new PlayerAnimator(this.rig);
    this.animator.onFootstep = (side, intensity) => {
      if (this.motion === 'ground' && this.grounded) {
        this.onEvent('footstep', { side, intensity, sprint: this.sprinting, crouch: this.stance === 'crouch' });
      }
    };

    // --- transform / physics ---
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3(0, 0, 0);
    this.rot = 0;                     // facing yaw (forward = sin/cos of rot)
    this.turnRate = 0;
    this.radius = P.radius;
    this.height = P.height;
    this.targetHeight = P.height;

    // --- state machine ---
    this.motion = 'ground';
    this.stance = 'stand';
    this.grounded = true;
    this.groundBox = null;
    this.coyoteT = 0;
    this.jumpBufferT = 0;
    this.airTime = 0;
    this.landT = 0;
    this.hardLand = false;
    this.lastFallSpeed = 0;
    this.crouchToggled = false;
    this.slideT = 0;
    this.slideCooldownT = 0;
    this.hang = null;           // {top, dirX, dirZ, box}
    this.hangT = 0;
    this.hangCooldownT = 0;
    this.shimmyDir = 0;

    // --- speed / stamina ---
    this.speed = 0;
    this.speedNorm = 0;
    this.sprinting = false;
    this.walkMod = false;
    this.exhausted = false;
    this.staminaDelay = 0;
    this.accelMag = 0;

    // --- combat ---
    this.aiming = false;
    this.aimWeight = 0;
    this.aimToggled = false;
    this.attack = { active: false, type: 'jab', t: 0, duration: 0.4, applied: false, weight: 1, def: null };
    this.comboIndex = -1;
    this.comboT = 0;
    this.flinch = 0;
    this.weaponKind = 'fists';
    this.weaponDrawn = true;

    // --- scripted motion ---
    this.scripted = null;
    this.ladder = null;
    this.ladderCooldown = 0;
    this.inVehicle = null;
    this.koT = 0;

    this._tmpDir = { x: 0, z: 1 };
    this.moveLocal = { x: 0, z: 0 };
    this.lastGroundY = 0;
    this.jumpHeldTime = 0;
  }

  // =========================================================================
  // Public helpers
  // =========================================================================

  setPosition(x, y, z, rot) {
    this.pos.set(x, y ?? 0, z);
    if (rot !== undefined) this.rot = rot;
    this.vel.set(0, 0, 0);
    this.motion = 'ground';
    this.scripted = null;
    this.ladder = null;
    this.grounded = true;
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.rot;
  }

  forward() { return new THREE.Vector3(Math.sin(this.rot), 0, Math.cos(this.rot)); }
  right() { return new THREE.Vector3(-Math.cos(this.rot), 0, Math.sin(this.rot)); }
  eyePosition() {
    const h = this.stance === 'crouch' ? P.crouchEyeHeight : P.eyeHeight;
    return new THREE.Vector3(this.pos.x, this.pos.y + h, this.pos.z);
  }
  centerPosition() { return new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.55, this.pos.z); }
  isBusy() { return this.motion === 'vault' || this.motion === 'mantle' || this.motion === 'hang'; }
  canAct() { return this.motion === 'ground' || this.motion === 'ladder'; }

  setWeapon(kind, drawn = true) {
    this.weaponKind = kind;
    this.weaponDrawn = drawn;
    this.rig.setWeaponVisual(kind, drawn);
  }

  // =========================================================================
  // Main update
  // =========================================================================

  /**
   * @param {number} dt
   * @param {object} ctx { input, camYaw, camPitch, blockInput, canAim }
   */
  update(dt, ctx) {
    this._tickTimers(dt);

    switch (this.motion) {
      case 'vehicle': this._updateVehicle(dt, ctx); break;
      case 'vault':
      case 'mantle': this._updateScripted(dt); break;
      case 'ladder': this._updateLadder(dt, ctx); break;
      case 'slide': this._updateSlide(dt, ctx); break;
      case 'hang': this._updateHang(dt, ctx); break;
      case 'ko': this._updateKO(dt); break;
      default: this._updateGround(dt, ctx); break;
    }

    this._updateAttack(dt);
    this._applyTransform();
    this._animate(dt, ctx);
  }

  _tickTimers(dt) {
    if (this.jumpBufferT > 0) this.jumpBufferT -= dt;
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.comboIndex = -1; }
    if (this.landT > 0) this.landT = Math.max(0, this.landT - dt / P.landRecovery);
    if (this.flinch > 0) this.flinch = Math.max(0, this.flinch - dt * 2.6);
    if (this.ladderCooldown > 0) this.ladderCooldown -= dt;
    if (this.slideCooldownT > 0) this.slideCooldownT -= dt;
    if (this.hangCooldownT > 0) this.hangCooldownT -= dt;
    if (this.staminaDelay > 0) this.staminaDelay -= dt;
  }

  // =========================================================================
  // Ground / air locomotion
  // =========================================================================

  _updateGround(dt, ctx) {
    const input = ctx.input;
    const blocked = !!ctx.blockInput;
    const move = blocked ? { x: 0, z: 0 } : input.move;
    const mag = Math.min(1, Math.hypot(move.x, move.z));

    // Crouching at speed turns into a slide instead of a crouch-walk.
    if (!blocked && this.grounded && this.motion === 'ground' && this.slideCooldownT <= 0 &&
        this.speed >= P.slideMinSpeed && this.stance === 'stand' && !this.aiming &&
        !this.attack.active && this.state.stamina > P.slideCost &&
        (input.pressed('crouch') || input.pressed('crouchToggle'))) {
      this._startSlide();
      return;
    }

    this._updateStance(dt, input, blocked);
    this._updateAim(dt, input, ctx, blocked);

    // ---- desired direction, relative to the camera ------------------------
    const camYaw = ctx.camYaw || 0;
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
    let dx = fx * -move.z + rx * move.x;
    let dz = fz * -move.z + rz * move.x;
    const dlen = Math.hypot(dx, dz);
    if (dlen > 1e-4) { dx /= dlen; dz /= dlen; } else { dx = 0; dz = 0; }
    if (dlen > 1e-4) { this._tmpDir.x = dx; this._tmpDir.z = dz; }

    // ---- speed tier -------------------------------------------------------
    const stam = this.state.stamina ?? 100;
    this.walkMod = !blocked && input.down('walk');
    const wantsSprint = !blocked && input.down('sprint') && mag > 0.35 && this.stance === 'stand' && !this.aiming;
    if (this.exhausted && stam > P.exhaustedRecover) this.exhausted = false;
    if (stam <= 0.5) this.exhausted = true;
    this.sprinting = wantsSprint && !this.exhausted && this.grounded && !this.attack.active;

    let targetSpeed;
    if (this.stance === 'crouch') targetSpeed = P.crouchSpeed;
    else if (this.aiming) targetSpeed = P.aimSpeed;
    else if (this.walkMod) targetSpeed = P.walkSpeed;
    else if (this.sprinting) targetSpeed = P.sprintSpeed;
    else targetSpeed = P.jogSpeed;
    targetSpeed *= mag;
    if (this.attack.active) targetSpeed *= 0.42;
    if (this.landT > 0 && this.hardLand) targetSpeed *= 0.55 + 0.45 * (1 - this.landT);

    // Directional penalties make strafing/backpedalling feel grounded.
    if (dlen > 1e-4) {
      const lz = dx * Math.sin(this.rot) + dz * Math.cos(this.rot);
      const lx = dx * -Math.cos(this.rot) + dz * Math.sin(this.rot);
      this.moveLocal.x = lx; this.moveLocal.z = lz;
      if (this.aiming || this.stance === 'crouch') {
        if (lz < -0.2) targetSpeed *= P.backpedalMul;
        else if (Math.abs(lx) > 0.5) targetSpeed *= P.strafeMul;
      }
    } else {
      this.moveLocal.x *= 0.85; this.moveLocal.z *= 0.85;
    }

    // ---- stamina ----------------------------------------------------------
    if (this.sprinting && this.speed > 1.5) {
      this.state.stamina = Math.max(0, this.state.stamina - P.sprintDrain * dt);
      this.staminaDelay = P.staminaRegenDelay;
    } else if (this.staminaDelay <= 0) {
      const regen = this.stance === 'crouch' ? P.staminaRegen * 1.35 : P.staminaRegen;
      this.state.stamina = Math.min(this.state.maxStamina, this.state.stamina + regen * dt);
    }

    // ---- horizontal acceleration -----------------------------------------
    const tvx = dx * targetSpeed, tvz = dz * targetSpeed;
    let accel;
    if (!this.grounded) accel = P.airAccel * (dlen > 0 ? P.airControl : 0.35);
    else if (dlen > 0) accel = this.sprinting ? P.sprintAccel : P.groundAccel;
    else accel = P.groundDecel;

    const dvx = tvx - this.vel.x, dvz = tvz - this.vel.z;
    const dvLen = Math.hypot(dvx, dvz);
    const maxDelta = accel * dt;
    if (dvLen <= maxDelta || dvLen < 1e-5) {
      if (this.grounded || dlen > 0) { this.vel.x = tvx; this.vel.z = tvz; }
    } else {
      this.vel.x += (dvx / dvLen) * maxDelta;
      this.vel.z += (dvz / dvLen) * maxDelta;
    }
    if (!this.grounded && dlen === 0) {
      const drag = Math.max(0, 1 - P.airDrag * dt);
      this.vel.x *= drag; this.vel.z *= drag;
    }
    this.accelMag = dvLen > 0 ? Math.min(dvLen, maxDelta) / Math.max(dt, 1e-4) * Math.sign(targetSpeed - this.speed) : 0;

    // ---- body rotation ----------------------------------------------------
    let targetRot = this.rot;
    const strafeMode = this.aiming;
    if (strafeMode) targetRot = camYaw;
    else if (dlen > 1e-4) targetRot = Math.atan2(dx, dz);

    const turnSpeed = strafeMode
      ? P.aimTurnSpeed
      : P.turnSpeed - (P.turnSpeed - P.turnSpeedFast) * Math.min(1, this.speed / P.sprintSpeed);
    const delta = shortestAngle(this.rot, targetRot);
    const step = Math.sign(delta) * Math.min(Math.abs(delta), turnSpeed * dt);
    this.rot += step;
    this.turnRate = step / Math.max(dt, 1e-4);

    // ---- jump -------------------------------------------------------------
    if (!blocked && input.pressed('jump')) this.jumpBufferT = P.jumpBufferTime;
    if (input.down('jump')) this.jumpHeldTime += dt; else this.jumpHeldTime = 0;

    if (this.jumpBufferT > 0 && !this.attack.active) {
      // A jump into an obstacle becomes a vault or a climb.
      if (this._tryParkour(true)) {
        this.jumpBufferT = 0;
      } else if ((this.grounded || this.coyoteT > 0) && this.motion === 'ground') {
        if (this.stance === 'crouch') {
          if (this._tryStand()) this.jumpBufferT = 0.05;   // stand first, jump next frame
        } else {
          this._doJump();
        }
      }
    }

    // ---- gravity ----------------------------------------------------------
    let g = P.gravity;
    if (this.vel.y < 0) g *= P.fallGravityMul;
    else if (this.vel.y > 0 && !input.down('jump')) g *= P.lowJumpGravityMul;
    this.vel.y = Math.max(-P.maxFallSpeed, this.vel.y - g * dt);

    // ---- integrate + collide ---------------------------------------------
    const world = this.world;
    const prevY = this.pos.y;
    const wasGrounded = this.grounded;

    if (world) {
      const hres = world.moveXZ(this.pos, this.vel.x * dt, this.vel.z * dt,
        this.radius, this.height, this.grounded ? P.stepHeight : 0.2);
      if (hres.hit) {
        // Cancel velocity into the wall so we slide instead of sticking.
        if (hres.nx !== 0) this.vel.x = 0;
        if (hres.nz !== 0) this.vel.z = 0;
        // Auto-vault: running into low cover hops over it without extra input.
        if (this.settings.autoVault !== false && this.grounded && this.speed > 3.2 &&
            !this.aiming && this.stance === 'stand') {
          this._tryParkour(false);
        }
      }
      this.pos.y += this.vel.y * dt;

      // ceiling
      if (this.vel.y > 0) {
        const ceil = world.ceilingAt(this.pos.x, this.pos.z, this.pos.y, this.radius);
        if (ceil < this.pos.y + this.height) {
          this.pos.y = Math.max(prevY, ceil - this.height - 0.01);
          this.vel.y = Math.min(this.vel.y, -0.5);
        }
      }

      // ground / landing
      const probeY = Math.max(prevY, this.pos.y);
      const support = world.groundAt(this.pos.x, this.pos.z, probeY, this.radius, 0.02);
      const snapDist = (wasGrounded && this.vel.y <= 0.02) ? 0.42 : 0;
      if (this.pos.y <= support.y + 1e-3) {
        this._land(support, -this.vel.y);
      } else if (snapDist > 0 && this.pos.y - support.y <= snapDist) {
        this.pos.y = support.y;
        this.vel.y = 0;
        this.grounded = true;
        this.groundBox = support.box;
      } else {
        if (this.grounded) this.coyoteT = P.coyoteTime;
        this.grounded = false;
      }
      world.depenetrate(this.pos, this.radius, this.height);
    } else {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= 0) this._land({ y: 0, box: null }, -this.vel.y);
    }

    // ---- post state -------------------------------------------------------
    if (!this.grounded) {
      this.airTime += dt;
      this.coyoteT = Math.max(0, this.coyoteT - dt);
      this.lastFallSpeed = Math.max(this.lastFallSpeed, -this.vel.y);
      // Falling past a climbable surface: catch the lip, or mantle a low one.
      if (this.vel.y < -1 && this.airTime > 0.12 && this.hangCooldownT <= 0) {
        if (!this._tryLedgeGrab()) this._tryParkour(false, true);
      }
    } else {
      this.airTime = 0;
      this.coyoteT = P.coyoteTime;
      this.lastGroundY = this.pos.y;
    }

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.speedNorm = Math.min(1.2, this.speed / P.sprintSpeed);

    // ---- ladders: proximity only; attaching is driven by the interaction
    // system so the prompt and the action always agree.
    this.nearLadder = (world && this.ladderCooldown <= 0 && this.motion === 'ground')
      ? world.nearestLadder(this.pos, 1.4) : null;
  }

  _doJump() {
    const boost = this.sprinting ? P.sprintJumpBoost : 0;
    this.vel.y = P.jumpVelocity + boost;
    this.grounded = false;
    this.coyoteT = 0;
    this.jumpBufferT = 0;
    this.airTime = 0.001;
    this.state.stamina = Math.max(0, this.state.stamina - P.jumpCost);
    this.staminaDelay = P.staminaRegenDelay;
    this.onEvent('jump', { sprint: this.sprinting });
  }

  _land(support, impactSpeed) {
    const wasAir = !this.grounded;
    this.pos.y = support.y;
    this.vel.y = 0;
    this.grounded = true;
    this.groundBox = support.box;
    if (!wasAir) return;

    const speed = Math.max(impactSpeed, this.lastFallSpeed);
    this.lastFallSpeed = 0;
    this.hardLand = speed > P.hardLandSpeed;
    this.landT = this.hardLand ? 1 : Math.min(1, 0.35 + speed / 26);
    if (this.hardLand) {
      // Heavy landings bleed speed and stamina.
      this.vel.x *= 0.45; this.vel.z *= 0.45;
      this.state.stamina = Math.max(0, this.state.stamina - 8);
    }
    let damage = 0;
    if (speed > P.fallDamageSpeed) damage = Math.round((speed - P.fallDamageSpeed) * P.fallDamageScale);
    this.onEvent('land', { speed, hard: this.hardLand, damage });
  }

  // =========================================================================
  // Slide
  // =========================================================================

  _startSlide() {
    const sp = Math.max(0.001, Math.hypot(this.vel.x, this.vel.z));
    const boost = Math.min(P.sprintSpeed * 1.25, sp * P.slideBoost);
    this.rot = Math.atan2(this.vel.x / sp, this.vel.z / sp);
    this.vel.x = Math.sin(this.rot) * boost;
    this.vel.z = Math.cos(this.rot) * boost;
    this.motion = 'slide';
    this.slideT = 0;
    this.sprinting = false;
    this.stance = 'crouch';
    this.targetHeight = P.crouchHeight;
    this.height = P.crouchHeight;       // drop the capsule at once so gaps are usable
    this.crouchToggled = false;
    this.state.stamina = Math.max(0, this.state.stamina - P.slideCost);
    this.staminaDelay = P.staminaRegenDelay;
    this.onEvent('slide-start', { speed: boost });
  }

  _updateSlide(dt, ctx) {
    const input = ctx.input;
    const blocked = !!ctx.blockInput;
    const world = this.world;
    this.slideT += dt;

    // The capsule drops fast so you can slip under low obstacles immediately.
    this.targetHeight = P.crouchHeight;
    const hk = 1 - Math.exp(-22 * dt);
    this.height += (this.targetHeight - this.height) * hk;

    // ---- limited steering -------------------------------------------------
    const move = blocked ? { x: 0, z: 0 } : input.move;
    const camYaw = ctx.camYaw || 0;
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
    const dx = fx * -move.z + rx * move.x;
    const dz = fz * -move.z + rz * move.x;
    if (Math.hypot(dx, dz) > 1e-4) {
      const delta = shortestAngle(this.rot, Math.atan2(dx, dz));
      const step = Math.sign(delta) * Math.min(Math.abs(delta), P.slideSteer * dt);
      this.rot += step;
      this.turnRate = step / Math.max(dt, 1e-4);
    } else {
      this.turnRate = 0;
    }

    // ---- friction ---------------------------------------------------------
    let sp = Math.max(0, Math.hypot(this.vel.x, this.vel.z) - P.slideFriction * dt);
    this.vel.x = Math.sin(this.rot) * sp;
    this.vel.z = Math.cos(this.rot) * sp;
    this.vel.y = Math.max(-P.maxFallSpeed, this.vel.y - P.gravity * dt);

    // ---- integrate --------------------------------------------------------
    const prevY = this.pos.y;
    const wasGrounded = this.grounded;
    let wallHit = false;
    if (world) {
      const hres = world.moveXZ(this.pos, this.vel.x * dt, this.vel.z * dt,
        this.radius, this.height, P.stepHeight);
      if (hres.hit) {
        if (hres.nx !== 0) this.vel.x = 0;
        if (hres.nz !== 0) this.vel.z = 0;
        wallHit = Math.hypot(this.vel.x, this.vel.z) < sp * 0.4;
      }
      this.pos.y += this.vel.y * dt;
      const probeY = Math.max(prevY, this.pos.y);
      const support = world.groundAt(this.pos.x, this.pos.z, probeY, this.radius, 0.02);
      const snapDist = (wasGrounded && this.vel.y <= 0.02) ? 0.42 : 0;
      if (this.pos.y <= support.y + 1e-3) this._land(support, -this.vel.y);
      else if (snapDist > 0 && this.pos.y - support.y <= snapDist) {
        this.pos.y = support.y; this.vel.y = 0; this.grounded = true; this.groundBox = support.box;
      } else {
        if (this.grounded) this.coyoteT = P.coyoteTime;
        this.grounded = false;
      }
      world.depenetrate(this.pos, this.radius, this.height);
    } else {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= 0) this._land({ y: 0, box: null }, -this.vel.y);
    }

    sp = Math.hypot(this.vel.x, this.vel.z);
    this.speed = sp;
    this.speedNorm = Math.min(1.2, sp / P.sprintSpeed);
    if (!this.grounded) { this.airTime += dt; this.lastFallSpeed = Math.max(this.lastFallSpeed, -this.vel.y); }
    else { this.airTime = 0; this.lastGroundY = this.pos.y; }

    // ---- exit conditions --------------------------------------------------
    const jumped = !blocked && input.pressed('jump');
    const tooSlow = sp < P.slideExitSpeed && this.slideT > P.slideMinTime;
    if (jumped || wallHit || tooSlow || this.slideT >= P.slideMaxTime ||
        (!this.grounded && this.airTime > 0.18)) {
      this._endSlide(input, blocked, jumped);
    }
  }

  _endSlide(input, blocked, jumped) {
    this.motion = 'ground';
    this.slideCooldownT = P.slideCooldown;
    this.slideT = 0;
    // Stand back up unless the player is still holding crouch or a ceiling
    // (a pipe, a vent, a car) keeps them down.
    const holdCrouch = !blocked && input && input.down('crouch');
    if (!holdCrouch) this._tryStand();
    if (jumped) this.jumpBufferT = P.jumpBufferTime;
    this.onEvent('slide-end', { crouched: this.stance === 'crouch' });
  }

  // =========================================================================
  // Stance (crouch) + aim
  // =========================================================================

  _updateStance(dt, input, blocked) {
    const holdCrouch = !blocked && input.down('crouch');
    if (!blocked && input.pressed('crouchToggle')) this.crouchToggled = !this.crouchToggled;
    if (this.settings.toggleCrouch && !blocked && input.pressed('crouch')) this.crouchToggled = !this.crouchToggled;

    let wantCrouch = this.crouchToggled || (this.settings.toggleCrouch ? false : holdCrouch);
    if (!this.grounded && this.motion === 'ground') wantCrouch = wantCrouch && this.stance === 'crouch';
    if (this.sprinting && !this.crouchToggled) wantCrouch = false;

    if (wantCrouch && this.stance === 'stand') {
      this.stance = 'crouch';
      this.targetHeight = P.crouchHeight;
      this.onEvent('crouch', { on: true });
    } else if (!wantCrouch && this.stance === 'crouch') {
      this._tryStand();
    }

    // Smooth capsule height so the camera doesn't pop.
    const k = 1 - Math.exp(-16 * dt);
    this.height += (this.targetHeight - this.height) * k;
    if (Math.abs(this.targetHeight - this.height) < 0.005) this.height = this.targetHeight;
  }

  /** Stand up if there is headroom; returns success. */
  _tryStand() {
    if (this.stance === 'stand') return true;
    if (this.world && !this.world.isFree(this.pos.x, this.pos.y, this.pos.z, this.radius, P.height)) {
      return false;   // blocked by a ceiling: stay crouched
    }
    this.stance = 'stand';
    this.crouchToggled = false;
    this.targetHeight = P.height;
    this.onEvent('crouch', { on: false });
    return true;
  }

  _updateAim(dt, input, ctx, blocked) {
    const canAim = !!ctx.canAim && this.motion === 'ground' && !blocked;
    if (this.settings.toggleAim) {
      if (canAim && input.pressed('aim')) this.aimToggled = !this.aimToggled;
      if (!canAim) this.aimToggled = false;
      this.aiming = canAim && this.aimToggled;
    } else {
      this.aiming = canAim && input.down('aim');
    }
    if (this.aiming && this.sprinting) this.sprinting = false;
    const k = 1 - Math.exp(-14 * dt);
    this.aimWeight += ((this.aiming ? 1 : 0) - this.aimWeight) * k;
  }

  // =========================================================================
  // Parkour: step / vault / mantle
  // =========================================================================

  /**
   * Classify the obstacle in front of the player without acting on it.
   * @returns {null|{kind:'vault'|'mantle', target:THREE.Vector3, control:THREE.Vector3, dirX:number, dirZ:number, rel:number}}
   */
  probeParkour(fromJump, airborne = false) {
    const world = this.world;
    if (!world || this.motion !== 'ground') return null;
    if (this.stance === 'crouch' && !fromJump) return null;

    // Direction: current movement, else facing.
    let dx = this._tmpDir.x, dz = this._tmpDir.z;
    if (this.speed > 0.6) { dx = this.vel.x / this.speed; dz = this.vel.z / this.speed; }
    const dl = Math.hypot(dx, dz);
    if (dl < 1e-4) { dx = Math.sin(this.rot); dz = Math.cos(this.rot); } else { dx /= dl; dz /= dl; }

    const reach = P.ledgeReach + this.radius;
    const probe = world.probeAhead(this.pos, dx, dz, this.radius, this.height, reach);
    if (!probe) return null;
    if (probe.dist > P.ledgeReach) return null;

    const box = probe.box;
    const rel = probe.top - this.pos.y;
    if (rel <= P.stepHeight + 0.02) return null;             // handled by step-up
    if (airborne && rel < 0.6) return null;

    const farDist = world.depthAlong(box, this.pos, dx, dz);
    const thickness = farDist - probe.dist;
    const standH = P.height;

    // --- vault over thin obstacles ---------------------------------------
    if (box.vault !== false && rel >= P.vaultMinHeight && rel <= P.vaultMaxHeight &&
        thickness <= P.vaultMaxDepth && !airborne) {
      const tx = this.pos.x + dx * (farDist + this.radius + 0.35);
      const tz = this.pos.z + dz * (farDist + this.radius + 0.35);
      const landing = world.groundAt(tx, tz, probe.top + 0.1, this.radius, 99);
      const drop = probe.top - landing.y;
      if (drop < 3.2 && world.isFree(tx, landing.y + 0.05, tz, this.radius, standH)) {
        return {
          kind: 'vault', dirX: dx, dirZ: dz, rel,
          target: new THREE.Vector3(tx, landing.y, tz),
          control: new THREE.Vector3(
            this.pos.x + dx * (probe.dist + this.radius * 0.6), probe.top + 0.35,
            this.pos.z + dz * (probe.dist + this.radius * 0.6)),
          duration: P.vaultDuration * (0.85 + rel / P.vaultMaxHeight * 0.3),
          cost: 7,
        };
      }
    }

    // --- mantle onto ledges ----------------------------------------------
    const maxClimb = (fromJump || airborne) ? P.mantleMaxHeight : P.mantleMaxHeight * 0.75;
    if (box.climb !== false && rel > 0 && rel <= maxClimb) {
      const onTop = Math.min(probe.dist + this.radius + 0.42, Math.max(farDist - this.radius - 0.05, probe.dist + 0.1));
      const tx = this.pos.x + dx * onTop;
      const tz = this.pos.z + dz * onTop;
      const standable = world.groundAt(tx, tz, probe.top + 0.05, this.radius, 0.05);
      if (Math.abs(standable.y - probe.top) < 0.12 && world.isFree(tx, probe.top + 0.06, tz, this.radius, standH)) {
        return {
          kind: 'mantle', dirX: dx, dirZ: dz, rel,
          target: new THREE.Vector3(tx, probe.top, tz),
          control: new THREE.Vector3(this.pos.x + dx * 0.1, probe.top + 0.08, this.pos.z + dz * 0.1),
          duration: P.mantleDuration * (0.7 + rel / P.mantleMaxHeight * 0.55),
          cost: 14,
        };
      }
    }
    return null;
  }

  /**
   * Probe for a climbable obstacle and start the matching motion.
   * @param {boolean} fromJump  triggered by the jump key (allows higher climbs)
   * @param {boolean} airborne  mid-air ledge grab
   */
  _tryParkour(fromJump, airborne = false) {
    const plan = this.probeParkour(fromJump, airborne);
    if (!plan) return false;
    if (this.state.stamina < plan.cost * 0.5) { this.onEvent('too-tired', {}); return false; }
    this._startScripted(plan.kind, plan.dirX, plan.dirZ, plan.target, plan.control, plan.duration);
    this.state.stamina = Math.max(0, this.state.stamina - plan.cost);
    this.staminaDelay = P.staminaRegenDelay;
    return true;
  }

  /** 'vault' | 'mantle' | null — used for the on-screen prompt. */
  ledgeHint() {
    if (this.motion !== 'ground' || !this.grounded) return null;
    const plan = this.probeParkour(true, false);
    return plan ? plan.kind : null;
  }

  _startScripted(kind, dx, dz, target, control, duration) {
    this.motion = kind;
    this.scripted = {
      kind,
      t: 0,
      duration: Math.max(0.2, duration),
      from: this.pos.clone(),
      control,
      to: target,
      dirX: dx, dirZ: dz,
      exitSpeed: kind === 'vault' ? Math.max(this.speed, 3.4) : 1.6,
    };
    this.rot = Math.atan2(dx, dz);
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.aiming = false;
    this.attack.active = false;
    this.onEvent(kind, { height: target.y - this.pos.y });
  }

  _updateScripted(dt) {
    const s = this.scripted;
    if (!s) { this.motion = 'ground'; return; }
    s.t += dt;
    const u = Math.min(1, s.t / s.duration);
    const e = easeInOut(u);
    // Quadratic Bezier through the control point gives a natural arc.
    const inv = 1 - e;
    this.pos.x = inv * inv * s.from.x + 2 * inv * e * s.control.x + e * e * s.to.x;
    this.pos.y = inv * inv * s.from.y + 2 * inv * e * s.control.y + e * e * s.to.y;
    this.pos.z = inv * inv * s.from.z + 2 * inv * e * s.control.z + e * e * s.to.z;
    this.scriptedProgress = u;

    if (u >= 1) {
      this.pos.copy(s.to);
      this.motion = 'ground';
      this.grounded = true;
      this.landT = 0.35;
      this.hardLand = false;
      this.vel.set(s.dirX * s.exitSpeed, 0, s.dirZ * s.exitSpeed);
      this.onEvent(s.kind + '-end', {});
      this.scripted = null;
    }
  }

  // =========================================================================
  // Ledge hang + shimmy
  // =========================================================================

  /**
   * Catch a ledge that is too high to mantle straight onto while falling past
   * it. Returns true when the player latches on.
   */
  _tryLedgeGrab() {
    const world = this.world;
    if (!world || this.motion !== 'ground' || this.grounded) return false;
    if (this.stance === 'crouch') return false;

    const dir = this._tmpDir;
    let dx = dir.x, dz = dir.z;
    if (Math.abs(dx) + Math.abs(dz) < 1e-4) { const f = this.forward(); dx = f.x; dz = f.z; }

    const probe = world.probeAhead(this.pos, dx, dz, this.radius, this.height, P.ledgeReach + this.radius);
    if (!probe || probe.dist > P.ledgeReach) return false;

    const box = probe.box;
    if (box.climb === false) return false;
    const rel = probe.top - this.pos.y;                // lip height above the feet
    if (rel < P.hangMinHeight || rel > P.hangMaxHeight) return false;

    // There must be somewhere to end up: free space over the lip.
    const onTop = probe.dist + this.radius + 0.42;
    if (!world.isFree(this.pos.x + dx * onTop, probe.top + 0.06, this.pos.z + dz * onTop, this.radius, P.crouchHeight)) {
      return false;
    }
    this._startHang(probe.top, dx, dz, box, probe.dist + this.radius);
    return true;
  }

  _startHang(top, dx, dz, box, faceDist = P.hangReach) {
    this.motion = 'hang';
    this.hang = { top, dirX: dx, dirZ: dz, box };
    this.hangT = 0;
    this.shimmyDir = 0;
    this.vel.set(0, 0, 0);
    this.pos.y = top - P.hangDrop;
    // settle at a fixed reach from the wall so the hands sit on the lip
    const pull = faceDist - P.hangReach;
    if (Math.abs(pull) > 0.01) { this.pos.x += dx * pull; this.pos.z += dz * pull; }
    this.rot = Math.atan2(dx, dz);
    this.grounded = false;
    this.aiming = false;
    this.attack.active = false;
    this.airTime = 0;
    this.lastFallSpeed = 0;         // the catch absorbs the fall
    this.stance = 'stand';
    this.targetHeight = P.height;
    this.onEvent('ledge-grab', { top });
  }

  /** Let go. `push` kicks the player away from the wall. */
  releaseHang(push = false) {
    const h = this.hang;
    this.motion = 'ground';
    this.hang = null;
    this.hangCooldownT = P.hangCooldown;
    this.grounded = false;
    this.airTime = 0.001;
    this.lastFallSpeed = 0;
    if (push && h) this.vel.set(-h.dirX * 2.0, 1.2, -h.dirZ * 2.0);
    else this.vel.set(0, -0.5, 0);
    this.onEvent('ledge-release', {});
  }

  /** Climb from a hang onto the surface above. */
  mantleFromHang() {
    const world = this.world, h = this.hang;
    if (!world || !h) return false;
    if (this.state.stamina < 6) { this.onEvent('too-tired', {}); return false; }

    const probe = world.probeAhead(this.pos, h.dirX, h.dirZ, this.radius, this.height, P.ledgeReach + this.radius);
    const top = probe ? probe.top : h.top;
    const near = probe ? probe.dist : 0.35;
    const far = probe ? world.depthAlong(probe.box, this.pos, h.dirX, h.dirZ) : near + 1.2;
    const onTop = Math.min(near + this.radius + 0.42, Math.max(far - this.radius - 0.05, near + 0.1));
    const tx = this.pos.x + h.dirX * onTop;
    const tz = this.pos.z + h.dirZ * onTop;
    if (!world.isFree(tx, top + 0.06, tz, this.radius, P.height)) return false;

    this.hang = null;
    this._startScripted('mantle', h.dirX, h.dirZ,
      new THREE.Vector3(tx, top, tz),
      new THREE.Vector3(this.pos.x + h.dirX * 0.1, top + 0.12, this.pos.z + h.dirZ * 0.1),
      P.mantleDuration * 0.75);
    this.state.stamina = Math.max(0, this.state.stamina - P.hangMantleCost);
    this.staminaDelay = P.staminaRegenDelay;
    return true;
  }

  _updateHang(dt, ctx) {
    const h = this.hang;
    if (!h) { this.motion = 'ground'; return; }
    const input = ctx.input;
    const blocked = !!ctx.blockInput;
    const move = blocked ? { x: 0, z: 0 } : input.move;
    const world = this.world;
    this.hangT += dt;
    this.speed = 0;
    this.speedNorm = 0;

    // ---- stamina ----------------------------------------------------------
    this.state.stamina = Math.max(0, this.state.stamina - P.hangDrain * dt);
    this.staminaDelay = P.staminaRegenDelay;
    if (this.state.stamina <= 0) { this.onEvent('too-tired', {}); this.releaseHang(false); return; }

    // ---- climb up / drop --------------------------------------------------
    if (!blocked && (input.pressed('jump') || move.z < -0.55)) {
      if (this.mantleFromHang()) return;
    }
    if (!blocked && (input.pressed('crouch') || input.pressed('crouchToggle') || move.z > 0.65)) {
      this.releaseHang(true);
      return;
    }

    // ---- shimmy -----------------------------------------------------------
    const want = Math.abs(move.x) > 0.25 ? Math.sign(move.x) : 0;
    this.shimmyDir = want;
    if (want !== 0 && world) {
      const latX = -h.dirZ * want, latZ = h.dirX * want;   // along the wall
      const step = P.shimmySpeed * dt;
      const nx = this.pos.x + latX * step, nz = this.pos.z + latZ * step;
      const ahead = world.probeAhead({ x: nx, y: this.pos.y, z: nz }, h.dirX, h.dirZ,
        this.radius, this.height, P.ledgeReach + this.radius);
      // the hands have to stay over solid wall, so corners end the shimmy
      const handX = nx + h.dirX * (P.hangReach + 0.12);
      const handZ = nz + h.dirZ * (P.hangReach + 0.12);
      const handsOnWall = !world.isFree(handX, h.top - 0.4, handZ, 0.1, 0.3);
      const continues = handsOnWall && ahead && Math.abs(ahead.top - h.top) < 0.16 && ahead.dist <= P.ledgeReach;
      const bodyFree = world.isFree(nx, this.pos.y + 0.1, nz, this.radius * 0.85, P.hangDrop * 0.9);
      if (continues && bodyFree) {
        this.pos.x = nx; this.pos.z = nz;
        h.top = ahead.top;
        this.speed = P.shimmySpeed;
        this.speedNorm = 0.25;
      } else {
        this.shimmyDir = 0;                                  // end of the ledge
      }
    }

    // Stay glued to the lip (ledges are not perfectly flat) and keep the
    // body a constant arm's length from the wall.
    this.pos.y += ((h.top - P.hangDrop) - this.pos.y) * (1 - Math.exp(-18 * dt));
    if (world) {
      const cur = world.probeAhead(this.pos, h.dirX, h.dirZ, this.radius, this.height, P.ledgeReach + this.radius);
      if (cur) {
        const err = (cur.dist + this.radius) - P.hangReach;
        if (Math.abs(err) > 0.015) {
          const k = 1 - Math.exp(-14 * dt);
          this.pos.x += h.dirX * err * k;
          this.pos.z += h.dirZ * err * k;
        }
        h.top = cur.top;
      }
    }
    this.rot = Math.atan2(h.dirX, h.dirZ);
    this.turnRate = 0;
    this.height = this.targetHeight = P.height;
  }

  // =========================================================================
  // Ladders
  // =========================================================================

  startLadder(l) {
    this.ladder = l;
    this.motion = 'ladder';
    this.vel.set(0, 0, 0);
    this.rot = l.yaw;
    const back = 0.42;
    this.pos.x = l.x - Math.sin(l.yaw) * back;
    this.pos.z = l.z - Math.cos(l.yaw) * back;
    this.pos.y = Math.max(this.pos.y, l.bottom);
    this.stance = 'stand';
    this.targetHeight = P.height;
    this.grounded = false;
    this.onEvent('ladder-enter', {});
  }

  exitLadder(push = true) {
    this.motion = 'ground';
    this.ladder = null;
    this.ladderCooldown = 0.45;
    if (push) {
      const f = this.forward();
      this.vel.set(-f.x * 2.4, 2.2, -f.z * 2.4);
    }
    this.onEvent('ladder-exit', {});
  }

  _updateLadder(dt, ctx) {
    const l = this.ladder;
    const input = ctx.input;
    if (!l) { this.motion = 'ground'; return; }
    const blocked = !!ctx.blockInput;
    const move = blocked ? { x: 0, z: 0 } : input.move;

    const up = -move.z;                       // W climbs up
    const climbSpeed = P.ladderSpeed * (input.down('sprint') ? 1.5 : 1);
    this.ladderSpeedNorm = Math.abs(up);
    this.pos.y += up * climbSpeed * dt;

    if (Math.abs(up) > 0.1) {
      this.state.stamina = Math.max(0, this.state.stamina - P.climbDrain * dt * 0.5);
      this.staminaDelay = P.staminaRegenDelay;
    }

    // Small lateral shuffle to line up
    this.rot += shortestAngle(this.rot, l.yaw) * Math.min(1, 10 * dt);

    // Reached the top: mantle onto the platform.
    if (this.pos.y >= l.top - 0.25 && up > 0.1) {
      const dx = Math.sin(l.yaw), dz = Math.cos(l.yaw);
      const tx = l.x + dx * (this.radius + 0.35);
      const tz = l.z + dz * (this.radius + 0.35);
      const ground = this.world ? this.world.groundAt(tx, tz, l.top + 0.3, this.radius, 0.6) : { y: l.top };
      this.ladder = null;
      this.ladderCooldown = 0.4;
      this.motion = 'ground';
      this._startScripted('mantle', dx, dz,
        new THREE.Vector3(tx, ground.y, tz),
        new THREE.Vector3(l.x, l.top + 0.25, l.z),
        0.55);
      return;
    }
    // Bottom: step off.
    if (this.pos.y <= l.bottom + 0.05 && up < -0.05) {
      this.pos.y = l.bottom;
      this.exitLadder(false);
      this.grounded = true;
      return;
    }
    if (!blocked && (input.pressed('jump') || input.pressed('interact'))) { this.exitLadder(true); return; }
    if (this.state.stamina <= 0) { this.exitLadder(false); }
  }

  // =========================================================================
  // Vehicle
  // =========================================================================

  enterVehicle(vehicle) {
    this.inVehicle = vehicle;
    this.motion = 'vehicle';
    this.vel.set(0, 0, 0);
    this.attack.active = false;
    this.aiming = false;
    this.group.visible = false;
    this.onEvent('vehicle-enter', { vehicle });
  }

  exitVehicle(x, y, z, rot) {
    this.inVehicle = null;
    this.motion = 'ground';
    this.group.visible = true;
    this.setPosition(x, y, z, rot);
    this.landT = 0.4;
    this.onEvent('vehicle-exit', {});
  }

  _updateVehicle(dt, ctx) {
    const v = this.inVehicle;
    if (!v) { this.motion = 'ground'; this.group.visible = true; return; }
    this.pos.set(v.pos.x, v.pos.y, v.pos.z);
    this.rot = v.rot;
    this.speed = Math.abs(v.speed || 0);
    this.speedNorm = Math.min(1, this.speed / 20);
    this.grounded = true;
  }

  // =========================================================================
  // Combat
  // =========================================================================

  /** Start (or chain) a melee attack. Returns true if a swing started. */
  meleeAttack() {
    if (this.motion !== 'ground' || !this.grounded) return false;
    if (this.attack.active && this.attack.t < this.attack.duration * 0.42) return false;
    if (this.state.stamina < 4) { this.onEvent('too-tired', {}); return false; }

    const usingWeapon = this.weaponKind !== 'fists' && this.weaponKind !== 'pistol';
    const combo = usingWeapon ? WEAPON_COMBO : FIST_COMBO;
    this.comboIndex = this.comboT > 0 ? (this.comboIndex + 1) % combo.length : 0;
    const type = combo[this.comboIndex];
    const def = PlayerAnimator.attackDef(type);

    this.attack = { active: true, type, t: 0, duration: def.duration, applied: false, weight: 1, def };
    this.comboT = def.duration + P.comboWindow;
    this.state.stamina = Math.max(0, this.state.stamina - 4 - def.damage * 2);
    this.staminaDelay = P.staminaRegenDelay;

    // Small forward lunge keeps combos feeling connected.
    const f = this.forward();
    const lunge = P.meleeLunge * (def.lunge || 1) * (this.stance === 'crouch' ? 0.4 : 1);
    this.vel.x += f.x * lunge * 0.35;
    this.vel.z += f.z * lunge * 0.35;
    this.onEvent('melee-start', { type, index: this.comboIndex });
    return true;
  }

  /** Legacy name used by older systems. */
  tryAttack() { return this.meleeAttack(); }

  _updateAttack(dt) {
    const a = this.attack;
    if (!a.active) return;
    a.t += dt;
    const def = a.def || PlayerAnimator.attackDef(a.type);
    if (!a.applied && a.t >= def.duration * def.hitAt) {
      a.applied = true;
      this.onEvent('melee-strike', {
        type: a.type,
        damageMul: def.damage,
        rangeMul: def.range,
        index: this.comboIndex,
      });
    }
    if (a.t >= def.duration) { a.active = false; a.weight = 0; }
  }

  hurt(amount, fromPos) {
    this.flinch = Math.min(1, 0.6 + amount / 40);
    if (fromPos) {
      const dx = this.pos.x - fromPos.x, dz = this.pos.z - fromPos.z;
      const l = Math.hypot(dx, dz) || 1;
      this.vel.x += (dx / l) * Math.min(3.5, amount * 0.12);
      this.vel.z += (dz / l) * Math.min(3.5, amount * 0.12);
    }
    this.onEvent('hurt', { amount });
  }

  knockOut() {
    this.motion = 'ko';
    this.koT = 0;
    this.vel.set(0, 0, 0);
    this.attack.active = false;
    this.aiming = false;
  }
  _updateKO(dt) {
    this.koT = Math.min(1, this.koT + dt * 3);
    if (!this.grounded && this.world) {
      this.vel.y -= P.gravity * dt;
      this.pos.y += this.vel.y * dt;
      const support = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y, this.radius, 0.1);
      if (this.pos.y <= support.y) { this.pos.y = support.y; this.vel.y = 0; this.grounded = true; }
    }
  }
  revive() { this.motion = 'ground'; this.koT = 0; this.flinch = 0; }

  // =========================================================================
  // Presentation
  // =========================================================================

  _applyTransform() {
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.group.rotation.y = this.rot;
    this.group.visible = this.motion !== 'vehicle';
  }

  _animate(dt, ctx) {
    const camYaw = ctx.camYaw || 0;
    const lookYawOffset = shortestAngle(this.rot, camYaw);
    this.animator.update(dt, {
      motion: this.motion,
      speed: this.speed,
      speedNorm: this.speedNorm,
      accel: this.accelMag,
      moveLocal: this.moveLocal,
      stance: this.stance,
      grounded: this.grounded,
      vertVel: this.vel.y,
      airTime: this.airTime,
      landT: this.landT,
      hardLand: this.hardLand,
      aim: this.aimWeight,
      aimPitch: -(ctx.camPitch || 0),
      attack: this.attack,
      climbT: this.scriptedProgress || 0,
      slideT: this.slideT,
      hangT: this.hangT,
      shimmyDir: this.shimmyDir,
      ladderSpeed: this.ladderSpeedNorm || 0,
      flinch: this.flinch,
      koT: this.koT,
      turnRate: this.turnRate,
      lookYawOffset,
      lookPitch: ctx.camPitch || 0,
    });
  }

  /** Compact snapshot for HUD / camera / save data. */
  describeState() {
    if (this.motion === 'vehicle') return 'DRIVING';
    if (this.motion === 'slide') return 'SLIDING';
    if (this.motion === 'hang') return this.shimmyDir ? 'SHIMMYING' : 'HANGING';
    if (this.motion === 'ladder') return 'CLIMBING';
    if (this.motion === 'mantle') return 'CLIMBING';
    if (this.motion === 'vault') return 'VAULTING';
    if (!this.grounded) return this.vel.y > 0.5 ? 'JUMPING' : 'FALLING';
    if (this.stance === 'crouch') return this.speed > 0.3 ? 'SNEAKING' : 'CROUCHED';
    if (this.aiming) return 'AIMING';
    if (this.sprinting && this.speed > 1) return 'SPRINTING';
    if (this.speed > P.jogSpeed * 0.75) return 'RUNNING';
    if (this.speed > 0.3) return 'WALKING';
    return 'IDLE';
  }
}
