import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { ITEMS } from '../data/items.js';

// ---------------------------------------------------------------------------
// Ranged weapon handling: draw/holster, aim-down-sights, hit-scan firing with
// spread, recoil, tracers, muzzle flash, impacts, reloading and ammo.
//
// Hit detection runs along the camera ray (what the crosshair covers) while the
// tracer is drawn from the muzzle, which is how most third-person shooters
// reconcile an off-centre camera with an on-screen crosshair.
// ---------------------------------------------------------------------------

const TRACER_POOL = 14;
const IMPACT_POOL = 10;

export class WeaponSystem {
  constructor(scene, state, audio, opts = {}) {
    this.scene = scene;
    this.state = state;
    this.audio = audio;
    this.onHitNPC = opts.onHitNPC || (() => {});
    this.onImpact = opts.onImpact || (() => {});
    this.onEvent = opts.onEvent || (() => {});

    this.weaponId = null;      // 'pistol' | 'revolver' | null
    this.drawn = false;
    this.cooldown = 0;
    this.reloading = 0;
    this.spread = 0.06;
    this.lastShot = -99;

    this._initVisuals();
  }

  _initVisuals() {
    // Tracer pool
    this.tracers = [];
    const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 });
    for (let i = 0; i < TRACER_POOL; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, tracerMat.clone());
      line.visible = false;
      line.frustumCulled = false;
      this.scene.add(line);
      this.tracers.push({ line, life: 0 });
    }

    // Impact sparks
    this.impacts = [];
    for (let i = 0; i < IMPACT_POOL; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 6, 5),
        new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 }),
      );
      m.visible = false;
      this.scene.add(m);
      this.impacts.push({ mesh: m, life: 0 });
    }

    // Muzzle flash
    this.muzzle = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 7, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.95 }),
    );
    this.muzzle.visible = false;
    this.scene.add(this.muzzle);
    this.muzzleLight = new THREE.PointLight(0xffc266, 0, 9);
    this.scene.add(this.muzzleLight);
    this.muzzleT = 0;
  }

  // -------------------------------------------------------------------------
  // Equipment
  // -------------------------------------------------------------------------

  /** Which ranged weapon the player owns (best one), or null. */
  availableWeapon() {
    if (this.state.hasItem('revolver')) return 'revolver';
    if (this.state.hasItem('pistol')) return 'pistol';
    return null;
  }

  def() { return CONFIG.weapons[this.weaponId] || null; }

  sync() {
    const owned = this.availableWeapon();
    if (!owned) { this.weaponId = null; this.drawn = false; return; }
    if (!this.weaponId || this.weaponId !== owned) {
      this.weaponId = owned;
      const d = this.def();
      const ammo = this.state.ammo || (this.state.ammo = { mag: 0, reserve: 0 });
      if (ammo.mag <= 0 && ammo.reserve <= 0) { ammo.mag = d.magSize; ammo.reserve = d.magSize * 2; }
    }
  }

  toggleDraw() {
    this.sync();
    if (!this.weaponId) { this.onEvent('no-weapon'); return false; }
    this.drawn = !this.drawn;
    this.onEvent(this.drawn ? 'draw' : 'holster', { id: this.weaponId });
    // Drawing an empty weapon chambers a fresh magazine straight away.
    const a = this.ammo();
    if (this.drawn && a.mag <= 0 && a.reserve > 0 && this.reloading <= 0) {
      const d = this.def();
      this.reloading = d.reloadTime;
      this.onEvent('reloading', { time: d.reloadTime });
    }
    return this.drawn;
  }

  canAim() { return !!this.weaponId && this.drawn; }

  ammo() { return this.state.ammo || { mag: 0, reserve: 0 }; }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  /**
   * @param {object} ctx { dt, player, cam, world, targets, input, blocked }
   */
  update(dt, ctx) {
    this.sync();
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.muzzleT > 0) {
      this.muzzleT -= dt;
      const k = Math.max(0, this.muzzleT / 0.05);
      this.muzzle.visible = k > 0;
      this.muzzle.scale.setScalar(0.6 + k * 0.9);
      this.muzzleLight.intensity = k * 3.2;
      if (this.muzzleT <= 0) { this.muzzle.visible = false; this.muzzleLight.intensity = 0; }
    }
    this._updateEffects(dt);

    const { player, input, blocked } = ctx;
    if (!this.weaponId || !this.drawn || blocked || !player || player.motion !== 'ground') {
      this.spread = 0.06;
      if (this.reloading > 0) this.reloading = Math.max(0, this.reloading - dt);
      return;
    }

    const d = this.def();
    const a = this.ammo();

    // --- reload ---
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const need = d.magSize - a.mag;
        const take = Math.min(need, a.reserve);
        a.mag += take; a.reserve -= take;
        this.onEvent('reloaded', { mag: a.mag, reserve: a.reserve });
      }
    } else if (input.pressed('reload') && a.mag < d.magSize && a.reserve > 0) {
      this.reloading = d.reloadTime;
      this.audio?.ui?.();
      this.onEvent('reloading', { time: d.reloadTime });
    }

    // --- spread model ---
    const aiming = player.aiming;
    const moveFactor = Math.min(1, player.speed / 5);
    const base = aiming ? d.spreadAim : d.spreadHip;
    const target = base + moveFactor * d.spreadMove + (player.grounded ? 0 : 0.05) +
      (player.stance === 'crouch' ? -base * 0.35 : 0);
    this.spread += (Math.max(0.002, target) - this.spread) * (1 - Math.exp(-10 * dt));

    // --- fire ---
    const wantFire = input.down('attack');
    if (wantFire && this.cooldown <= 0 && this.reloading <= 0) {
      if (a.mag > 0) this._fire(ctx, d, a);
      else {
        this.cooldown = 0.35;
        this.audio?.blip?.(140, 0.05, 'square', 0.06);
        this.onEvent('empty');
        if (a.reserve > 0) { this.reloading = d.reloadTime; this.onEvent('reloading', { time: d.reloadTime }); }
      }
    }
  }

  _fire(ctx, d, ammo) {
    const { player, cam, world, targets } = ctx;
    ammo.mag--;
    this.cooldown = d.fireRate;

    // Ray from the camera through the crosshair, with spread.
    const ray = cam.aimRay();
    const spread = this.spread;
    const jitterA = Math.random() * Math.PI * 2;
    const jitterR = Math.sqrt(Math.random()) * spread;
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(ray.dir, up).normalize();
    const vert = new THREE.Vector3().crossVectors(side, ray.dir).normalize();
    const dir = ray.dir.clone()
      .addScaledVector(side, Math.cos(jitterA) * jitterR)
      .addScaledVector(vert, Math.sin(jitterA) * jitterR)
      .normalize();

    // Muzzle position (right hand, roughly)
    const f = player.forward();
    const r = player.right();
    const muzzlePos = new THREE.Vector3(
      player.pos.x + f.x * 0.55 + r.x * 0.22,
      player.pos.y + (player.stance === 'crouch' ? 1.05 : 1.45),
      player.pos.z + f.z * 0.55 + r.z * 0.22,
    );

    // --- resolve hit ---
    let hitDist = d.range;
    let hitPoint = ray.origin.clone().addScaledVector(dir, d.range);
    let hitNPC = null, headshot = false;

    const worldHit = world ? world.raycast(ray.origin, dir, d.range) : null;
    if (worldHit) { hitDist = worldHit.dist; hitPoint.set(worldHit.x, worldHit.y, worldHit.z); }

    if (targets && targets.length) {
      const o = ray.origin;
      for (const npc of targets) {
        if (!npc || npc.dead) continue;
        const cx = npc.pos.x - o.x, cy = (npc.pos.y + 1.05) - o.y, cz = npc.pos.z - o.z;
        const t = cx * dir.x + cy * dir.y + cz * dir.z;
        if (t <= 0.6 || t >= hitDist) continue;
        const px = o.x + dir.x * t, py = o.y + dir.y * t, pz = o.z + dir.z * t;
        const dx = px - npc.pos.x, dy = py - (npc.pos.y + 1.05), dz = pz - npc.pos.z;
        const radial = Math.hypot(dx, dz);
        if (radial < 0.46 && Math.abs(dy) < 0.95) {
          hitDist = t;
          hitPoint.set(px, py, pz);
          hitNPC = npc;
          headshot = py > npc.pos.y + 1.52;
        }
      }
    }

    // --- feedback ---
    this._tracer(muzzlePos, hitPoint);
    this._muzzleFlash(muzzlePos);
    cam.addRecoil(d.recoilPitch * (player.aiming ? 0.7 : 1), (Math.random() - 0.5) * d.recoilYaw * 2);
    cam.addShake(d.shake * (player.aiming ? 0.6 : 1), 0.12);
    this.audio?.shot?.(d === CONFIG.weapons.revolver);

    if (hitNPC) {
      const dmg = d.damage * (headshot ? 2.2 : 1);
      this.onHitNPC(hitNPC, dmg, headshot, hitPoint);
    } else {
      this._impact(hitPoint);
      this.onImpact(hitPoint, worldHit);
    }
    this.onEvent('fired', { mag: ammo.mag, reserve: ammo.reserve });
  }

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  _tracer(from, to) {
    const t = this.tracers.find(x => x.life <= 0) || this.tracers[0];
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    t.line.visible = true;
    t.line.material.opacity = 0.95;
    t.life = 0.07;
  }

  _impact(point) {
    const i = this.impacts.find(x => x.life <= 0) || this.impacts[0];
    i.mesh.position.copy(point);
    i.mesh.visible = true;
    i.mesh.scale.setScalar(1);
    i.mesh.material.opacity = 0.95;
    i.life = 0.22;
  }

  _muzzleFlash(pos) {
    this.muzzle.position.copy(pos);
    this.muzzleLight.position.copy(pos);
    this.muzzleT = 0.05;
    this.muzzle.visible = true;
  }

  _updateEffects(dt) {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.95;
      if (t.life <= 0) t.line.visible = false;
    }
    for (const i of this.impacts) {
      if (i.life <= 0) continue;
      i.life -= dt;
      const k = Math.max(0, i.life / 0.22);
      i.mesh.material.opacity = k;
      i.mesh.scale.setScalar(0.6 + (1 - k) * 2.2);
      if (i.life <= 0) i.mesh.visible = false;
    }
  }

  /** Crosshair gap in pixels for the HUD. */
  crosshairGap() {
    return 6 + this.spread * 420;
  }

  hudText() {
    if (!this.weaponId) return null;
    const a = this.ammo();
    const name = ITEMS[this.weaponId]?.name || this.def()?.name || 'Weapon';
    if (!this.drawn) return `${name} (holstered)`;
    if (this.reloading > 0) return `${name} · reloading…`;
    return `${name} · ${a.mag} / ${a.reserve}`;
  }
}
