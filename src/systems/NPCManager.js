import * as THREE from 'three';
import { NPC } from '../entities/NPC.js';
import { NPCS, AMBIENT_STYLES, AMBIENT_NAMES } from '../data/npcs.js';
import { LOCATIONS } from '../data/world.js';
import { CONFIG } from '../config.js';

export class NPCManager {
  constructor(scene, state, settings) {
    this.scene = scene;
    this.state = state;
    this.settings = settings;
    this.named = {};      // id -> NPC
    this.ambient = [];    // NPC[]
    this.enemies = [];    // NPC[] (mission/aggro)
    this.all = [];
  }

  spawnAll() {
    // Named NPCs at their homes
    for (const [id, def] of Object.entries(NPCS)) {
      const loc = LOCATIONS[def.home] || { x: 0, z: 0 };
      const npc = new NPC(this.scene, {
        id, name: def.name, def, faction: def.faction, home: def.home,
        color: def.color, x: loc.x + (Math.random() - 0.5) * 4, z: loc.z + (Math.random() - 0.5) * 4,
      });
      this.named[id] = npc; this.all.push(npc);
    }
    // Ambient crowd
    const spots = Object.values(LOCATIONS);
    const count = CONFIG.world.npcCount - Object.keys(NPCS).length;
    for (let i = 0; i < count; i++) {
      const s = spots[Math.floor(Math.random() * spots.length)];
      const npc = new NPC(this.scene, {
        id: `amb${i}`, name: AMBIENT_NAMES[i % AMBIENT_NAMES.length],
        color: AMBIENT_STYLES[i % AMBIENT_STYLES.length],
        x: s.x + (Math.random() - 0.5) * 20, z: s.z + (Math.random() - 0.5) * 20,
        home: null,
      });
      npc.homePoint = new THREE.Vector3(s.x, 0, s.z);
      this.ambient.push(npc); this.all.push(npc);
    }
  }

  spawnEnemies(count, locationKey, type = 'thug') {
    const loc = LOCATIONS[locationKey] || { x: 0, z: 0 };
    const hpByType = { thug: 45, jock: 60, rival: 50 };
    const colorByType = { thug: 0x8a3030, jock: 0xc07020, rival: 0x704090 };
    const created = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const npc = new NPC(this.scene, {
        id: `enemy_${Date.now()}_${i}`, name: type, enemy: true, hp: hpByType[type] || 45,
        color: colorByType[type] || 0x8a3030,
        x: loc.x + Math.cos(a) * (5 + Math.random() * 4), z: loc.z + Math.sin(a) * (5 + Math.random() * 4),
      });
      this.enemies.push(npc); this.all.push(npc); created.push(npc);
    }
    return created;
  }

  clearEnemies() {
    for (const e of this.enemies) e.remove();
    this.all = this.all.filter(n => !this.enemies.includes(n));
    this.enemies = [];
  }

  update(dt, hour, playerPos, onAttackPlayer) {
    const sim = this.settings.npcSim || 40;
    const draw = this.settings.drawDistance || 220;

    // sort a subset by distance is expensive every frame; approximate:
    let simulated = 0;
    for (const npc of this.all) {
      if (npc.dead) continue;
      const dist = npc.pos.distanceTo(playerPos);
      // frustum-ish / distance culling
      const visible = dist < draw;
      npc.group.visible = visible && !npc.dead;
      if (!visible) continue;
      if (npc.isEnemy) { npc.update(dt, hour, playerPos, onAttackPlayer); continue; }
      if (simulated < sim) { npc.update(dt, hour, playerPos, null); simulated++; }
    }
  }

  // Nearest named NPC the player can interact with (within radius, roughly in front).
  nearestInteractable(playerPos, maxDist = 3.2) {
    let best = null, bestD = maxDist;
    for (const [id, npc] of Object.entries(this.named)) {
      if (npc.dead) continue;
      const d = npc.pos.distanceTo(playerPos);
      if (d < bestD) { bestD = d; best = { id, npc }; }
    }
    return best;
  }

  nearestEnemy(playerPos, maxDist = 30) {
    let best = null, bestD = maxDist;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = e.pos.distanceTo(playerPos);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  aliveEnemies() { return this.enemies.filter(e => !e.dead); }

  get(id) { return this.named[id]; }
}
