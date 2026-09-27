import * as THREE from 'three';

// Resolves melee attacks between player and NPC enemies.
export class Combat {
  constructor(state, audio) {
    this.state = state;
    this.audio = audio;
    this.onKill = null;      // callback(npc)
    this.onNotify = null;
  }

  playerAttack(player, enemies) {
    const range = this.state.weaponRange();
    const dmg = this.state.weaponDamage() + this.state.level * 2;
    const fwd = player.forward();
    let hitAny = false;
    for (const e of enemies) {
      if (e.dead) continue;
      const to = e.pos.clone().sub(player.pos); to.y = 0;
      const dist = to.length();
      if (dist <= range) {
        // within a frontal cone
        const dot = to.normalize().dot(fwd);
        if (dot > 0.2 || dist < 1.4) {
          const dead = e.takeDamage(dmg);
          hitAny = true;
          // knockback
          e.pos.add(to.multiplyScalar(0.6));
          if (dead) { this.audio.hit(); this.onKill && this.onKill(e); }
        }
      }
    }
    if (hitAny) this.audio.hit();
    return hitAny;
  }

  hurtPlayer(amount) {
    const dead = this.state.damage(amount);
    this.audio.hurt();
    return dead;
  }
}
