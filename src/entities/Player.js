import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { buildCharacter, animateWalk } from './Character.js';

export class Player {
  constructor(scene, state) {
    this.state = state;
    this.group = buildCharacter({ color: 0x2f6f9f, pants: 0x22303a, hair: 0x1a1410 });
    scene.add(this.group);
    this.pos = new THREE.Vector3(-96, 0, 55);
    this.velY = 0;
    this.grounded = true;
    this.rot = 0;               // facing yaw
    this.attackT = 0;
    this.attackCd = 0;
    this.speed01 = 0;
    this.inVehicle = null;
    this.radius = CONFIG.player.radius;
  }

  setPosition(x, y, z, rot) {
    this.pos.set(x, y ?? 0, z);
    if (rot !== undefined) this.rot = rot;
    this.group.position.copy(this.pos);
  }

  // moveDir in world XZ (already camera-relative), run bool, jump bool
  update(dt, moveDir, run, jump, colliders) {
    if (this.inVehicle) { this.group.visible = false; return; }
    this.group.visible = true;

    const p = CONFIG.player;
    const len = Math.hypot(moveDir.x, moveDir.z);
    let speed = 0;
    if (len > 0.01) {
      const nx = moveDir.x / len, nz = moveDir.z / len;
      const canRun = run && this.state.stamina > 1;
      speed = canRun ? p.runSpeed : p.walkSpeed;
      this.speed01 = canRun ? 1 : 0.5;
      // stamina
      if (canRun) this.state.stamina = Math.max(0, this.state.stamina - p.staminaDrain * dt);
      this.rot = Math.atan2(nx, nz);

      let dx = nx * speed * dt, dz = nz * speed * dt;
      this._moveAxis(dx, 0, colliders);
      this._moveAxis(0, dz, colliders);
    } else {
      this.speed01 = 0;
    }
    if (!(run && len > 0.01)) {
      this.state.stamina = Math.min(this.state.maxStamina, this.state.stamina + p.staminaRegen * dt);
    }

    // gravity / jump
    if (jump && this.grounded) { this.velY = p.jumpForce; this.grounded = false; }
    this.velY -= p.gravity * dt;
    this.pos.y += this.velY * dt;
    if (this.pos.y <= 0) { this.pos.y = 0; this.velY = 0; this.grounded = true; }

    // attack timing
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.attackT > 0) this.attackT -= dt / p.attackCooldown;
    if (this.attackT < 0) this.attackT = 0;

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.rot;
    animateWalk(this.group, dt, this.grounded ? this.speed01 : 0.2, this.attackT);
  }

  _moveAxis(dx, dz, colliders) {
    const nx = this.pos.x + dx, nz = this.pos.z + dz;
    const r = this.radius;
    for (const c of colliders) {
      if (nx + r > c.minX && nx - r < c.maxX && nz + r > c.minZ && nz - r < c.maxZ) {
        return; // blocked on this axis
      }
    }
    this.pos.x = nx; this.pos.z = nz;
  }

  tryAttack() {
    if (this.attackCd > 0) return false;
    this.attackCd = CONFIG.player.attackCooldown;
    this.attackT = 1;
    return true;
  }

  forward() { return new THREE.Vector3(Math.sin(this.rot), 0, Math.cos(this.rot)); }
}
