import * as THREE from 'three';
import { buildCharacter, animateWalk } from './Character.js';
import { LOCATIONS } from '../data/world.js';

export class NPC {
  constructor(scene, opts) {
    this.id = opts.id;
    this.name = opts.name;
    this.def = opts.def || null;      // named NPC data
    this.isNamed = !!opts.def;
    this.isEnemy = !!opts.enemy;
    this.faction = opts.faction || null;
    this.home = opts.home || null;

    this.group = buildCharacter({ color: opts.color || 0x888888, pants: 0x333333, skin: opts.skin || 0xcc9a70 });
    this.group.scale.setScalar(opts.enemy ? 1.02 : 1.0);
    scene.add(this.group);
    this.scene = scene;

    this.pos = new THREE.Vector3(opts.x || 0, 0, opts.z || 0);
    this.target = this.pos.clone();
    this.rot = Math.random() * Math.PI * 2;
    this.speed = opts.enemy ? 4.2 : (1.6 + Math.random() * 1.2);
    this.speed01 = 0;
    this.repathT = Math.random() * 3;
    this.fleeT = 0;
    this.health = opts.enemy ? (opts.hp || 40) : 999;
    this.maxHealth = this.health;
    this.attackCd = 0;
    this.dead = false;
    this.hitFlash = 0;
    this.talkedT = 0;

    // health bar for enemies
    if (this.isEnemy) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.16), new THREE.MeshBasicMaterial({ color: 0xef476f }));
      bar.position.y = 2.5; this.group.add(bar); this.hpBar = bar;
      const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 0.2), new THREE.MeshBasicMaterial({ color: 0x111 }));
      bg.position.y = 2.5; bg.position.z = -0.01; this.group.add(bg);
    }
    this.group.position.copy(this.pos);
  }

  scheduleTarget(hour) {
    if (!this.def || !this.def.schedule) return null;
    for (const s of this.def.schedule) {
      const inRange = s.from <= s.to ? (hour >= s.from && hour < s.to) : (hour >= s.from || hour < s.to);
      if (inRange) return LOCATIONS[s.at] || null;
    }
    return this.home ? LOCATIONS[this.home] : null;
  }

  /** Civilians scatter away from gunfire or a brawl for a few seconds. */
  scare(fromPos, seconds = 4) {
    if (this.dead || this.isEnemy) return;
    this.fleeT = Math.max(this.fleeT || 0, seconds);
    const dx = this.pos.x - fromPos.x, dz = this.pos.z - fromPos.z;
    const len = Math.hypot(dx, dz) || 1;
    this.target.set(this.pos.x + (dx / len) * 22, 0, this.pos.z + (dz / len) * 22);
    this.repathT = seconds;
  }

  update(dt, hour, playerPos, onAttackPlayer) {
    if (this.dead) return;
    if (this.hitFlash > 0) { this.hitFlash -= dt; this.group.userData.parts.torso.material.emissive?.setHex(this.hitFlash > 0 ? 0x662222 : 0x000000); }

    if (this.isEnemy) return this._updateEnemy(dt, playerPos, onAttackPlayer);

    // Panicking civilians sprint away and ignore their schedule.
    if (this.fleeT > 0) {
      this.fleeT -= dt;
      this._stepToward(this.target, dt, this.speed * 2.1);
      this.group.position.copy(this.pos);
      this.group.rotation.y = this.rot;
      animateWalk(this.group, dt, Math.min(1, this.speed01 * 1.6));
      return;
    }

    // Named/ambient: move toward schedule/wander target
    this.repathT -= dt;
    if (this.repathT <= 0) {
      this.repathT = 3 + Math.random() * 4;
      let dest = this.scheduleTarget(hour);
      if (!dest && this.home) dest = LOCATIONS[this.home];
      if (dest) {
        this.target.set(dest.x + (Math.random() - 0.5) * 8, 0, dest.z + (Math.random() - 0.5) * 8);
      } else {
        this.target.set(this.pos.x + (Math.random() - 0.5) * 20, 0, this.pos.z + (Math.random() - 0.5) * 20);
      }
    }
    this._stepToward(this.target, dt, this.speed);

    // face player briefly if very close (for conversation feel)
    if (playerPos && this.pos.distanceTo(playerPos) < 3) {
      const d = playerPos.clone().sub(this.pos);
      this.rot = Math.atan2(d.x, d.z);
      this.speed01 = 0;
    }

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.rot;
    animateWalk(this.group, dt, this.speed01);
  }

  _updateEnemy(dt, playerPos, onAttackPlayer) {
    if (this.attackCd > 0) this.attackCd -= dt;
    const d = playerPos.clone().sub(this.pos); d.y = 0;
    const dist = d.length();
    if (dist < 30) {
      if (dist > 1.8) {
        this._stepToward(playerPos, dt, this.speed);
        this.rot = Math.atan2(d.x, d.z);
      } else {
        this.speed01 = 0;
        this.rot = Math.atan2(d.x, d.z);
        if (this.attackCd <= 0) {
          this.attackCd = 1.1;
          if (onAttackPlayer) onAttackPlayer(8 + Math.random() * 6);
          this.group.userData.parts.rightArm.rotation.x = -2;
        }
      }
    } else this.speed01 = 0;

    if (this.hpBar) this.hpBar.scale.x = Math.max(0.01, this.health / this.maxHealth);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.rot;
    animateWalk(this.group, dt, this.speed01);
  }

  _stepToward(dest, dt, speed) {
    const d = new THREE.Vector3(dest.x - this.pos.x, 0, dest.z - this.pos.z);
    const dist = d.length();
    if (dist > 0.4) {
      d.normalize();
      this.pos.x += d.x * speed * dt;
      this.pos.z += d.z * speed * dt;
      this.rot = Math.atan2(d.x, d.z);
      this.speed01 = speed > 3 ? 1 : 0.5;
    } else this.speed01 = 0;
  }

  takeDamage(n) {
    if (!this.isEnemy || this.dead) return false;
    this.health -= n;
    this.hitFlash = 0.15;
    if (this.health <= 0) { this.dead = true; this.group.visible = false; return true; }
    return false;
  }

  remove() { this.scene.remove(this.group); }
}
