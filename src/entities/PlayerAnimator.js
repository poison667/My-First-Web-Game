// ---------------------------------------------------------------------------
// Procedural animation system for the player rig.
//
// There are no animation clips to load: every pose is generated from the
// controller's physical state (speed, stance, airtime, parkour progress…) and
// written into a channel table that is smoothed towards its target each frame.
//
// Layers, applied in order:
//   1. base locomotion  (idle / walk / jog / sprint / crouch, strafe-aware)
//   2. air + landing    (jump tuck, fall flail, knee-bend recovery)
//   3. scripted motion  (vault, mantle, ladder, vehicle, knocked out)
//   4. upper-body overlays (aim pose, melee combo, flinch)
//
// Conventions for this rig (character faces +Z):
//   rotation.x < 0  → limb swings forward        rotation.x > 0 → backward
//   knee  (shin.x)  > 0 → flexion (heel to butt) elbow (fore.x) < 0 → flexion
//   chest/hips .y   > 0 → turns to the right     .z > 0 → leans/rolls right
// ---------------------------------------------------------------------------

const CHANNELS = [
  'hipsY', 'hipsPitch', 'hipsRoll', 'hipsYaw',
  'spinePitch', 'spineYaw', 'spineRoll',
  'chestPitch', 'chestYaw', 'chestRoll',
  'neckPitch', 'neckYaw',
  'lArmP', 'lArmY', 'lArmR', 'lElb',
  'rArmP', 'rArmY', 'rArmR', 'rElb',
  'lThighP', 'lThighY', 'lThighR', 'lKnee', 'lFootP',
  'rThighP', 'rThighY', 'rThighR', 'rKnee', 'rFootP',
];

const UPPER = ['spinePitch', 'spineYaw', 'spineRoll', 'chestPitch', 'chestYaw', 'chestRoll',
  'neckPitch', 'neckYaw', 'lArmP', 'lArmY', 'lArmR', 'lElb', 'rArmP', 'rArmY', 'rArmR', 'rElb'];

const STIFFNESS = {
  hips: 16, spine: 12, chest: 12, neck: 14, arm: 18, elb: 18, thigh: 22, knee: 22, foot: 20,
};

function stiffnessFor(ch) {
  if (ch.startsWith('hips')) return STIFFNESS.hips;
  if (ch.startsWith('spine')) return STIFFNESS.spine;
  if (ch.startsWith('chest')) return STIFFNESS.chest;
  if (ch.startsWith('neck')) return STIFFNESS.neck;
  if (ch.endsWith('Elb')) return STIFFNESS.elb;
  if (ch.includes('Arm')) return STIFFNESS.arm;
  if (ch.includes('Thigh')) return STIFFNESS.thigh;
  if (ch.includes('Knee')) return STIFFNESS.knee;
  return STIFFNESS.foot;
}

const zeroPose = () => { const p = {}; for (const c of CHANNELS) p[c] = 0; return p; };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (t) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------------------
// Melee combo definitions. `u` is normalised attack time (0..1).
// Each returns partial channels for the upper body.
// ---------------------------------------------------------------------------
const ATTACKS = {
  jab: {
    duration: 0.38, hitAt: 0.34, damage: 0.85, range: 1.0, lunge: 1.0,
    pose(u) {
      const wind = clamp(u / 0.3, 0, 1), strike = clamp((u - 0.3) / 0.22, 0, 1), rec = clamp((u - 0.52) / 0.48, 0, 1);
      const ext = smoothstep(strike) * (1 - smoothstep(rec));
      return {
        rArmP: lerp(-0.5 - wind * 0.3, -1.52, ext), rElb: lerp(-1.7 + wind * 0.1, -0.12, ext), rArmR: -0.12,
        lArmP: lerp(-0.7, -0.95, ext), lElb: -1.6, lArmR: 0.25,
        chestYaw: lerp(0.22 * wind, -0.38, ext), spineYaw: lerp(0.1 * wind, -0.16, ext), chestPitch: 0.08,
      };
    },
  },
  cross: {
    duration: 0.44, hitAt: 0.38, damage: 1.15, range: 1.05, lunge: 1.3,
    pose(u) {
      const wind = clamp(u / 0.32, 0, 1), strike = clamp((u - 0.32) / 0.24, 0, 1), rec = clamp((u - 0.56) / 0.44, 0, 1);
      const ext = smoothstep(strike) * (1 - smoothstep(rec));
      return {
        lArmP: lerp(-0.45 - wind * 0.35, -1.55, ext), lElb: lerp(-1.75, -0.1, ext), lArmR: 0.12,
        rArmP: lerp(-0.8, -1.0, ext), rElb: -1.7, rArmR: -0.25,
        chestYaw: lerp(-0.25 * wind, 0.42, ext), spineYaw: lerp(-0.12 * wind, 0.2, ext), chestPitch: 0.1,
        hipsYaw: lerp(0, 0.18, ext),
      };
    },
  },
  hook: {
    duration: 0.58, hitAt: 0.42, damage: 1.6, range: 1.1, lunge: 1.5,
    pose(u) {
      const wind = clamp(u / 0.34, 0, 1), strike = clamp((u - 0.34) / 0.26, 0, 1), rec = clamp((u - 0.6) / 0.4, 0, 1);
      const ext = smoothstep(strike) * (1 - smoothstep(rec));
      return {
        rArmP: lerp(-0.4, -1.15, ext), rElb: lerp(-1.9, -1.0, ext), rArmR: lerp(-0.9 - wind * 0.4, 0.55, ext),
        lArmP: -0.85, lElb: -1.75, lArmR: 0.3,
        chestYaw: lerp(0.5 * wind, -0.6, ext), spineYaw: lerp(0.22 * wind, -0.3, ext),
        hipsYaw: lerp(0.2 * wind, -0.26, ext), chestPitch: 0.12,
      };
    },
  },
  swing: {   // horizontal weapon swing
    duration: 0.55, hitAt: 0.4, damage: 1.2, range: 1.15, lunge: 1.2,
    pose(u) {
      const wind = clamp(u / 0.34, 0, 1), strike = clamp((u - 0.34) / 0.28, 0, 1), rec = clamp((u - 0.62) / 0.38, 0, 1);
      const ext = smoothstep(strike) * (1 - smoothstep(rec));
      return {
        rArmP: lerp(-0.55 - wind * 0.3, -1.45, ext), rElb: lerp(-1.5 + wind * 0.5, -0.35, ext),
        rArmR: lerp(-1.15 - wind * 0.35, 0.75, ext),
        lArmP: lerp(-0.5, -0.9, ext), lElb: -1.3, lArmR: 0.35,
        chestYaw: lerp(0.62 * wind, -0.68, ext), spineYaw: lerp(0.3 * wind, -0.34, ext),
        hipsYaw: lerp(0.26 * wind, -0.3, ext), chestPitch: 0.1,
      };
    },
  },
  overhead: {  // overhead weapon smash
    duration: 0.68, hitAt: 0.46, damage: 1.8, range: 1.2, lunge: 1.0,
    pose(u) {
      const wind = clamp(u / 0.4, 0, 1), strike = clamp((u - 0.4) / 0.24, 0, 1), rec = clamp((u - 0.64) / 0.36, 0, 1);
      const ext = smoothstep(strike) * (1 - smoothstep(rec));
      return {
        rArmP: lerp(-2.6 * wind, -1.1, ext), rElb: lerp(-1.1, -0.15, ext), rArmR: lerp(-0.3, 0.05, ext),
        lArmP: lerp(-1.6 * wind, -0.8, ext), lElb: lerp(-1.2, -0.6, ext), lArmR: 0.3,
        chestPitch: lerp(-0.22 * wind, 0.42, ext), spinePitch: lerp(-0.12 * wind, 0.25, ext),
        chestYaw: lerp(0.18, -0.1, ext),
      };
    },
  },
  kick: {
    duration: 0.62, hitAt: 0.4, damage: 1.45, range: 1.25, lunge: 0.6, lower: true,
    pose(u) {
      const wind = clamp(u / 0.32, 0, 1), strike = clamp((u - 0.32) / 0.26, 0, 1), rec = clamp((u - 0.58) / 0.42, 0, 1);
      const ext = smoothstep(strike) * (1 - smoothstep(rec));
      return {
        rThighP: lerp(0.35 * wind, -1.5, ext), rKnee: lerp(1.4, 0.15, ext), rFootP: lerp(0.2, -0.35, ext),
        lThighP: lerp(0, 0.15, ext), lKnee: lerp(0.15, 0.4, ext),
        spinePitch: lerp(0.1, -0.25, ext), chestPitch: lerp(0, -0.18, ext),
        lArmP: lerp(-0.4, -1.0, ext), lElb: -1.2, rArmP: lerp(-0.3, 0.6, ext), rElb: -0.9,
        hipsY: -0.06 * ext,
      };
    },
  },
};

export const FIST_COMBO = ['jab', 'cross', 'hook', 'kick'];
export const WEAPON_COMBO = ['swing', 'overhead', 'swing'];

export class PlayerAnimator {
  constructor(rig) {
    this.rig = rig;
    this.cur = zeroPose();
    this.target = zeroPose();
    this.phase = 0;            // locomotion cycle phase (2π = full stride)
    this.idleT = Math.random() * 10;
    this.t = 0;
    this.lastStepSign = 0;
    this.onFootstep = null;    // (side, intensity) => void
    this.baseHipsY = rig.hips.position.y;
    this.attackPoseWeight = 0;
  }

  /**
   * @param {number} dt
   * @param {object} s controller state snapshot
   */
  update(dt, s) {
    this.t += dt;
    const p = this.target;
    for (const c of CHANNELS) p[c] = 0;

    const speedNorm = clamp(s.speedNorm ?? 0, 0, 1.3);
    const moving = (s.speed ?? 0) > 0.25 && s.grounded;

    // ---- cycle phase -----------------------------------------------------
    if (s.motion === 'ladder') {
      this.phase += dt * 4.2 * (s.ladderSpeed ?? 0);
    } else if (moving) {
      const cadence = 1.25 + (s.speed ?? 0) * 0.30;            // steps / second
      this.phase += dt * cadence * Math.PI;
      const sign = Math.sin(this.phase) >= 0 ? 1 : -1;
      if (sign !== this.lastStepSign) {
        this.lastStepSign = sign;
        if (this.onFootstep) this.onFootstep(sign > 0 ? 'R' : 'L', clamp(0.25 + speedNorm, 0, 1.2));
      }
    } else {
      // ease the stride out so the legs settle instead of snapping
      this.phase += dt * 1.2;
      this.lastStepSign = 0;
    }

    // ---- 1. base layer ---------------------------------------------------
    if (s.motion === 'vehicle') this._poseDriving(p, s);
    else if (s.motion === 'ko') this._poseKO(p, s);
    else if (s.motion === 'ladder') this._poseLadder(p, s);
    else if (s.motion === 'vault') this._poseVault(p, s);
    else if (s.motion === 'mantle') this._poseMantle(p, s);
    else if (!s.grounded) this._poseAir(p, s);
    else if (s.stance === 'crouch') this._poseCrouch(p, s, speedNorm);
    else this._poseLocomotion(p, s, speedNorm);

    // ---- 2. landing recovery --------------------------------------------
    if (s.grounded && (s.landT ?? 0) > 0 && s.motion === 'ground') this._applyLanding(p, s);

    // ---- 3. overlays -----------------------------------------------------
    if ((s.aim ?? 0) > 0.001 && s.motion === 'ground') this._applyAim(p, s);
    if (s.attack && s.attack.active) this._applyAttack(p, s);
    if ((s.flinch ?? 0) > 0.001) this._applyFlinch(p, s.flinch);
    if (s.motion === 'ground' || s.motion === 'ladder') this._applyLook(p, s);

    // ---- smooth & write --------------------------------------------------
    const attacking = s.attack && s.attack.active;
    for (const c of CHANNELS) {
      let k = stiffnessFor(c);
      if (attacking && UPPER.includes(c)) k = 46;              // crisp strikes
      if (s.motion === 'vault' || s.motion === 'mantle') k = 26;
      const a = 1 - Math.exp(-k * dt);
      this.cur[c] += (this.target[c] - this.cur[c]) * a;
    }
    this._applyToRig();
  }

  // -------------------------------------------------------------------------
  // Base poses
  // -------------------------------------------------------------------------

  _poseLocomotion(p, s, speedNorm) {
    const ph = this.phase;
    const sp = s.speed ?? 0;
    const moving = sp > 0.25;

    if (!moving) {
      // Idle: breathing, tiny weight shift, relaxed arms
      const b = Math.sin(this.t * 1.25);
      p.chestPitch = 0.02 + b * 0.022;
      p.spinePitch = 0.03;
      p.hipsY = -0.005 + b * 0.008;
      const shift = Math.sin(this.t * 0.42);
      p.hipsRoll = shift * 0.045;
      p.hipsYaw = shift * 0.05;
      p.chestYaw = -shift * 0.05;
      p.neckYaw = shift * 0.08;
      p.lArmP = 0.03 + b * 0.03; p.lElb = -0.22; p.lArmR = 0.12 + shift * 0.02;
      p.rArmP = 0.03 - b * 0.03; p.rElb = -0.22; p.rArmR = -0.12 + shift * 0.02;
      p.lThighP = -0.02; p.rThighP = 0.02;
      p.lKnee = 0.06; p.rKnee = 0.06;
      p.lThighR = 0.03; p.rThighR = -0.03;
      return;
    }

    // Stride amplitude grows with speed; sprint adds a deeper, longer stride.
    const amp = clamp(0.26 + sp * 0.105, 0.26, 1.02);
    const kneeAmp = clamp(0.5 + speedNorm * 1.25, 0.5, 1.9);
    const armAmp = clamp(0.3 + sp * 0.115, 0.3, 1.15);
    const elbowBase = -0.22 - speedNorm * 1.05;

    const legPose = (side, phase) => {
      const sw = Math.sin(phase);
      const thigh = -amp * sw;
      const knee = kneeAmp * Math.pow(Math.max(0, -Math.sin(phase + 0.35)), 1.25) + 0.08 + speedNorm * 0.12;
      const foot = -thigh * 0.3 - knee * 0.3 + Math.max(0, Math.sin(phase + 1.2)) * 0.18;
      p[side + 'ThighP'] = thigh;
      p[side + 'Knee'] = knee;
      p[side + 'FootP'] = foot;
    };
    legPose('l', ph);
    legPose('r', ph + Math.PI);

    const swL = Math.sin(ph), swR = Math.sin(ph + Math.PI);
    p.lArmP = armAmp * swL * 0.85;
    p.rArmP = armAmp * swR * 0.85;
    p.lElb = elbowBase + Math.max(0, -swL) * (0.15 + speedNorm * 0.55) * -1;
    p.rElb = elbowBase + Math.max(0, -swR) * (0.15 + speedNorm * 0.55) * -1;
    p.lArmR = 0.10 + speedNorm * 0.06;
    p.rArmR = -0.10 - speedNorm * 0.06;

    // Torso: forward lean with speed and acceleration, counter-rotation, bob.
    const lean = 0.035 + speedNorm * 0.28 + clamp((s.accel ?? 0) * 0.012, -0.08, 0.14);
    p.spinePitch = lean * 0.55;
    p.chestPitch = lean * 0.45;
    p.chestYaw = -swL * (0.07 + speedNorm * 0.13);
    p.hipsYaw = swL * (0.05 + speedNorm * 0.1);
    p.hipsRoll = swL * (0.03 + speedNorm * 0.045);
    p.hipsY = -0.01 - speedNorm * 0.035 + Math.cos(ph * 2) * (0.012 + speedNorm * 0.038);
    p.neckPitch = -(p.spinePitch + p.chestPitch) * 0.6;

    // Banking into turns + leaning into strafes keeps direction changes readable.
    const turn = clamp(s.turnRate ?? 0, -4, 4);
    p.hipsRoll += clamp(-turn * 0.035 * speedNorm, -0.18, 0.18);
    p.spineRoll = clamp(-turn * 0.02 * speedNorm, -0.1, 0.1);

    const ml = s.moveLocal || { x: 0, z: 1 };
    if (Math.abs(ml.x) > 0.05) {
      p.spineRoll += -ml.x * 0.1 * speedNorm;
      p.hipsYaw += ml.x * 0.06;
    }
    // Backpedalling: shorter stride, upright torso.
    if (ml.z < -0.3) {
      p.spinePitch *= 0.3; p.chestPitch *= 0.3;
      p.chestPitch -= 0.06;
    }
  }

  _poseCrouch(p, s, speedNorm) {
    const ph = this.phase;
    const sp = s.speed ?? 0;
    const moving = sp > 0.2;
    const amp = moving ? clamp(0.2 + sp * 0.16, 0.2, 0.55) : 0;

    p.hipsY = -0.44;
    p.spinePitch = 0.34;
    p.chestPitch = 0.14;
    p.neckPitch = -0.34;
    p.lThighP = -0.95 - (moving ? 0 : 0.05);
    p.rThighP = -0.95;
    p.lKnee = 1.62; p.rKnee = 1.62;
    p.lFootP = -0.62; p.rFootP = -0.62;
    p.lArmP = -0.42; p.rArmP = -0.42;
    p.lElb = -0.95; p.rElb = -0.95;
    p.lArmR = 0.2; p.rArmR = -0.2;

    if (moving) {
      const swL = Math.sin(ph), swR = Math.sin(ph + Math.PI);
      p.lThighP += -amp * swL; p.rThighP += -amp * swR;
      p.lKnee += Math.max(0, -swL) * 0.4; p.rKnee += Math.max(0, -swR) * 0.4;
      p.lArmP += swL * 0.22; p.rArmP += swR * 0.22;
      p.hipsY += Math.cos(ph * 2) * 0.02;
      p.hipsYaw = swL * 0.06;
      p.chestYaw = -swL * 0.08;
    } else {
      const b = Math.sin(this.t * 1.6) * 0.015;
      p.hipsY += b;
      p.chestPitch += b;
    }
  }

  _poseAir(p, s) {
    const vy = s.vertVel ?? 0;
    const rise = clamp(vy / 6, 0, 1);
    const fall = clamp(-vy / 10, 0, 1);
    const air = clamp(s.airTime ?? 0, 0, 1);

    // Jump: tuck. Fall: legs split, arms out for balance.
    p.lThighP = lerp(-0.55, -0.42, fall) * (0.4 + rise * 0.6) - fall * 0.1;
    p.rThighP = lerp(-0.25, 0.3, fall);
    p.lKnee = lerp(1.15, 0.55, fall);
    p.rKnee = lerp(0.65, 0.3, fall);
    p.lFootP = -0.2; p.rFootP = -0.1;

    p.lArmP = lerp(-1.25, -0.55, fall);
    p.rArmP = lerp(-1.25, -0.55, fall);
    p.lElb = lerp(-0.9, -0.5, fall);
    p.rElb = lerp(-0.9, -0.5, fall);
    p.lArmR = lerp(0.25, 0.95, fall) + Math.sin(this.t * 9) * 0.05 * fall;
    p.rArmR = lerp(-0.25, -0.95, fall) - Math.sin(this.t * 9) * 0.05 * fall;

    p.spinePitch = lerp(0.14, -0.06, fall);
    p.chestPitch = lerp(0.1, -0.1, fall);
    p.neckPitch = lerp(-0.1, 0.12, fall);
    p.hipsY = -0.03 + rise * 0.04;
    p.hipsRoll = Math.sin(this.t * 3 + air) * 0.03;

    const ml = s.moveLocal || { x: 0, z: 0 };
    p.spineRoll = -ml.x * 0.12;
    p.hipsYaw = ml.x * 0.1;
  }

  _applyLanding(p, s) {
    const l = clamp(s.landT, 0, 1);
    const hard = s.hardLand ? 1.6 : 1;
    const w = Math.sin(l * Math.PI) * hard;
    p.lKnee += 0.85 * w; p.rKnee += 0.85 * w;
    p.lThighP += -0.42 * w; p.rThighP += -0.42 * w;
    p.hipsY += -0.26 * w;
    p.spinePitch += 0.3 * w;
    p.chestPitch += 0.12 * w;
    p.lArmP += -0.5 * w; p.rArmP += -0.5 * w;
    p.lElb += -0.5 * w; p.rElb += -0.5 * w;
    p.lFootP += 0.18 * w; p.rFootP += 0.18 * w;
  }

  _poseVault(p, s) {
    const u = clamp(s.climbT ?? 0, 0, 1);
    const plant = clamp(u / 0.34, 0, 1);
    const over = clamp((u - 0.3) / 0.4, 0, 1);
    const land = clamp((u - 0.7) / 0.3, 0, 1);

    // Hands plant on the obstacle, legs tuck through, then extend to land.
    p.rArmP = lerp(-2.0, -0.1, over) + land * 0.6;
    p.rElb = lerp(-0.35, -0.9, over);
    p.rArmR = -0.15;
    p.lArmP = lerp(-1.5, -0.5, over) - land * 0.4;
    p.lElb = lerp(-0.7, -1.2, over);
    p.lArmR = 0.3;

    p.spinePitch = lerp(0.45, 0.2, land) * (0.4 + plant * 0.6);
    p.chestPitch = 0.3 * (1 - land);
    p.neckPitch = -0.25;

    const tuck = Math.sin(clamp(u, 0, 1) * Math.PI);
    p.lThighP = -1.5 * tuck - 0.1;
    p.rThighP = -1.25 * tuck + 0.25 * land;
    p.lKnee = 1.9 * tuck + 0.15;
    p.rKnee = 1.5 * tuck + 0.2;
    p.hipsY = -0.12 * tuck;
    p.hipsYaw = 0.22 * tuck;
    p.spineRoll = 0.12 * tuck;
  }

  _poseMantle(p, s) {
    const u = clamp(s.climbT ?? 0, 0, 1);
    const reach = clamp(u / 0.28, 0, 1);
    const pull = clamp((u - 0.22) / 0.42, 0, 1);
    const stand = clamp((u - 0.62) / 0.38, 0, 1);

    p.lArmP = lerp(-2.55, -1.0, pull) + stand * 0.75;
    p.rArmP = lerp(-2.55, -1.0, pull) + stand * 0.75;
    p.lElb = lerp(-0.25, -1.75, pull) + stand * 1.2;
    p.rElb = lerp(-0.25, -1.75, pull) + stand * 1.2;
    p.lArmR = 0.3 - pull * 0.1;
    p.rArmR = -0.3 + pull * 0.1;

    p.spinePitch = lerp(0.1, 0.5, pull) * (1 - stand * 0.8);
    p.chestPitch = 0.2 * (1 - stand);
    p.neckPitch = lerp(-0.35, -0.1, stand);

    p.lThighP = lerp(-0.15, -1.55, pull) * (1 - stand) - stand * 0.25;
    p.rThighP = lerp(-0.1, -0.85, pull) * (1 - stand * 0.4);
    p.lKnee = lerp(0.2, 1.85, pull) * (1 - stand * 0.7) + 0.12;
    p.rKnee = lerp(0.15, 1.25, pull) * (1 - stand * 0.5) + 0.12;
    p.hipsY = -0.2 * pull * (1 - stand) + reach * 0.03;
    p.hipsYaw = 0.1 * pull;
  }

  _poseLadder(p, s) {
    const ph = this.phase;
    const a = Math.sin(ph), b = Math.sin(ph + Math.PI);
    p.lArmP = -2.35 + a * 0.45;
    p.rArmP = -2.35 + b * 0.45;
    p.lElb = -0.7 - Math.max(0, a) * 0.5;
    p.rElb = -0.7 - Math.max(0, b) * 0.5;
    p.lArmR = 0.18; p.rArmR = -0.18;
    p.lThighP = -0.75 + b * 0.4;
    p.rThighP = -0.75 + a * 0.4;
    p.lKnee = 1.0 + Math.max(0, b) * 0.5;
    p.rKnee = 1.0 + Math.max(0, a) * 0.5;
    p.lFootP = -0.3; p.rFootP = -0.3;
    p.spinePitch = 0.12;
    p.chestPitch = 0.05;
    p.neckPitch = -0.15;
    p.hipsY = -0.08 + Math.sin(ph) * 0.02;
    p.hipsRoll = Math.sin(ph) * 0.05;
  }

  _poseDriving(p) {
    p.hipsY = -0.34;
    p.lThighP = -1.45; p.rThighP = -1.45;
    p.lKnee = 1.45; p.rKnee = 1.35;
    p.lFootP = -0.3; p.rFootP = -0.45;
    p.lArmP = -1.25; p.rArmP = -1.25;
    p.lElb = -0.75; p.rElb = -0.75;
    p.lArmR = 0.35; p.rArmR = -0.35;
    p.spinePitch = 0.12;
    p.chestPitch = 0.05;
  }

  _poseKO(p, s) {
    const u = clamp(s.koT ?? 1, 0, 1);
    p.hipsY = -0.75 * u;
    p.spinePitch = 0.9 * u;
    p.chestPitch = 0.4 * u;
    p.neckPitch = 0.3 * u;
    p.lThighP = -1.5 * u; p.rThighP = -1.2 * u;
    p.lKnee = 1.8 * u; p.rKnee = 1.4 * u;
    p.lArmP = 0.9 * u; p.rArmP = 0.7 * u;
    p.lElb = -0.4; p.rElb = -0.3;
    p.hipsRoll = 0.4 * u;
  }

  // -------------------------------------------------------------------------
  // Overlays
  // -------------------------------------------------------------------------

  _applyAim(p, s) {
    const w = clamp(s.aim, 0, 1);
    const pitch = clamp(s.aimPitch ?? 0, -1.0, 1.0);
    const o = {
      rArmP: -1.46 + pitch, rArmR: -0.2, rElb: -0.2, rArmY: 0.0,
      lArmP: -1.34 + pitch, lArmR: 0.52, lElb: -1.05, lArmY: 0.0,
      chestYaw: -0.2, chestPitch: 0.06 + pitch * 0.18, spinePitch: 0.08,
      neckPitch: -0.05 + pitch * 0.35, neckYaw: 0.12,
    };
    for (const k in o) p[k] = lerp(p[k], o[k], w);
    // Weight shifts onto the back foot while aiming.
    p.hipsYaw = lerp(p.hipsYaw, p.hipsYaw + 0.22, w);
    p.hipsY += -0.03 * w;
  }

  _applyAttack(p, s) {
    const def = ATTACKS[s.attack.type] || ATTACKS.jab;
    const u = clamp(s.attack.t / def.duration, 0, 1);
    const pose = def.pose(u);
    const w = clamp(s.attack.weight ?? 1, 0, 1);
    for (const k in pose) {
      if (p[k] === undefined) continue;
      p[k] = lerp(p[k], pose[k], w);
    }
  }

  _applyFlinch(p, f) {
    const w = clamp(f, 0, 1);
    p.spinePitch = lerp(p.spinePitch, -0.3, w * 0.8);
    p.chestPitch = lerp(p.chestPitch, -0.22, w * 0.8);
    p.chestYaw += 0.25 * w;
    p.neckPitch += 0.2 * w;
    p.lArmP = lerp(p.lArmP, -0.9, w * 0.6);
    p.rArmP = lerp(p.rArmP, -0.8, w * 0.6);
    p.lElb = lerp(p.lElb, -1.4, w * 0.6);
    p.rElb = lerp(p.rElb, -1.3, w * 0.6);
    p.hipsY += -0.05 * w;
  }

  /** Head/chest tracking of the camera look direction (keeps the body alive). */
  _applyLook(p, s) {
    const yaw = clamp(s.lookYawOffset ?? 0, -1.2, 1.2);
    const pitch = clamp(s.lookPitch ?? 0, -0.7, 0.7);
    const w = 1 - clamp(s.aim ?? 0, 0, 1) * 0.6;
    p.neckYaw += yaw * 0.55 * w;
    p.neckPitch += pitch * 0.45 * w;
    p.chestYaw += yaw * 0.22 * w;
    p.spineYaw += yaw * 0.12 * w;
  }

  // -------------------------------------------------------------------------

  _applyToRig() {
    const r = this.rig, c = this.cur;
    r.hips.position.y = this.baseHipsY + c.hipsY;
    r.hips.rotation.set(c.hipsPitch, c.hipsYaw, c.hipsRoll);
    r.spine.rotation.set(c.spinePitch, c.spineYaw, c.spineRoll);
    r.chest.rotation.set(c.chestPitch, c.chestYaw, c.chestRoll);
    r.neck.rotation.set(c.neckPitch, c.neckYaw, 0);

    r.armL.shoulder.rotation.set(c.lArmP, c.lArmY, c.lArmR);
    r.armL.fore.rotation.set(c.lElb, 0, 0);
    r.armR.shoulder.rotation.set(c.rArmP, c.rArmY, c.rArmR);
    r.armR.fore.rotation.set(c.rElb, 0, 0);

    r.legL.thigh.rotation.set(c.lThighP, c.lThighY, c.lThighR);
    r.legL.shin.rotation.set(c.lKnee, 0, 0);
    r.legL.foot.rotation.set(c.lFootP, 0, 0);
    r.legR.thigh.rotation.set(c.rThighP, c.rThighY, c.rThighR);
    r.legR.shin.rotation.set(c.rKnee, 0, 0);
    r.legR.foot.rotation.set(c.rFootP, 0, 0);
  }

  /** Attack metadata used by the controller (timing, damage scale, reach). */
  static attackDef(type) { return ATTACKS[type] || ATTACKS.jab; }
}

export { ATTACKS };
