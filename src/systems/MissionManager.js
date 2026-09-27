import * as THREE from 'three';
import { MISSIONS, MISSIONS_BY_ID } from '../data/missions.js';
import { LOCATIONS } from '../data/world.js';
import { NPCS } from '../data/npcs.js';
import { ITEMS } from '../data/items.js';

export class MissionManager {
  constructor(scene, state, npcMgr, ui, audio) {
    this.scene = scene;
    this.state = state;
    this.npcMgr = npcMgr;
    this.ui = ui;
    this.audio = audio;
    this.runtime = {};        // missionId -> {killNeed,killed,collectNeed,collected,spawned:[],pickups:[]}
    this.marker = null;
    this._makeMarker();
  }

  _makeMarker() {
    const g = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 40, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffca3a, transparent: true, opacity: 0.18, side: THREE.DoubleSide })
    );
    beam.position.y = 20; g.add(beam);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 2, 24), new THREE.MeshBasicMaterial({ color: 0xffca3a, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.1; g.add(ring);
    g.visible = false;
    this.scene.add(g);
    this.marker = g;
  }

  // Missions available from a given NPC (giver), requirement met, not done/active.
  availableFrom(npcId) {
    for (const m of MISSIONS) {
      if (m.giver !== npcId) continue;
      if (this.state.completed.includes(m.id)) continue;
      if (this.state.activeMission[m.line]) continue;
      if (m.requires && !this.state.completed.includes(m.requires)) continue;
      return m;
    }
    return null;
  }

  // All currently startable missions (for UI/journal and marker hints).
  availableMissions() {
    return MISSIONS.filter(m =>
      !this.state.completed.includes(m.id) &&
      !this.state.activeMission[m.line] &&
      (!m.requires || this.state.completed.includes(m.requires))
    );
  }

  start(missionId) {
    const m = MISSIONS_BY_ID[missionId];
    if (!m) return;
    this.state.activeMission[m.line] = missionId;
    this.state.missionProgress[missionId] = { step: 0 };
    this.runtime[missionId] = { killNeed: 0, killed: 0, collectNeed: 0, collected: 0, spawned: [], pickups: [] };
    this.audio.confirm();
    this.ui.notify(`New Mission: ${m.title}`, 'mission');
    this._setupObjective(m);
    this.updateTracker();
  }

  _active(line) { return this.state.activeMission[line] ? MISSIONS_BY_ID[this.state.activeMission[line]] : null; }
  currentObjective(m) {
    const step = this.state.missionProgress[m.id]?.step ?? 0;
    return m.objectives[step];
  }

  _setupObjective(m) {
    const obj = this.currentObjective(m);
    if (!obj) return;
    const rt = this.runtime[m.id];
    // clear leftover spawns from previous objective
    if (obj.type === 'defeat') {
      rt.killNeed = obj.count; rt.killed = 0;
      rt.spawned = this.npcMgr.spawnEnemies(obj.count, obj.at, obj.enemy || 'thug');
    } else if (obj.type === 'collect') {
      rt.collectNeed = obj.count; rt.collected = 0;
      this._spawnPickups(m, obj);
    }
    this._moveMarker(obj);
  }

  _spawnPickups(m, obj) {
    const rt = this.runtime[m.id];
    const loc = LOCATIONS[obj.at] || { x: 0, z: 0 };
    for (let i = 0; i < obj.count; i++) {
      const a = (i / obj.count) * Math.PI * 2;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8),
        new THREE.MeshBasicMaterial({ color: 0x4cc9f0 }));
      mesh.position.set(loc.x + Math.cos(a) * (3 + i * 1.5), 1, loc.z + Math.sin(a) * (3 + i * 1.5));
      mesh.userData.item = obj.item;
      this.scene.add(mesh);
      rt.pickups.push(mesh);
    }
  }

  _moveMarker(obj) {
    let loc = null;
    if (obj.type === 'goto' || obj.type === 'defeat' || obj.type === 'collect') loc = LOCATIONS[obj.at];
    else if (obj.type === 'talk' || obj.type === 'deliver') {
      const npc = this.npcMgr.get(obj.npc);
      if (npc) loc = { x: npc.pos.x, z: npc.pos.z };
    }
    if (loc) { this.marker.position.set(loc.x, 0, loc.z); this.marker.visible = true; this._markerLoc = loc; }
    else { this.marker.visible = false; this._markerLoc = null; }
  }

  // ---- Talk / deliver ----
  pendingTalk(npcId) {
    for (const line of ['student', 'gang']) {
      const m = this._active(line);
      if (!m) continue;
      const obj = this.currentObjective(m);
      if (!obj) continue;
      if ((obj.type === 'talk' || obj.type === 'deliver') && obj.npc === npcId) return { mission: m, objective: obj };
    }
    return null;
  }

  completeTalk(npcId) {
    const p = this.pendingTalk(npcId);
    if (!p) return;
    const obj = p.objective;
    if (obj.type === 'deliver') {
      if (!this.state.hasItem(obj.item)) { this.ui.notify(`You still need ${ITEMS[obj.item]?.name || obj.item}`, 'bad'); return; }
      this.state.removeItem(obj.item, 1);
    }
    this._advance(p.mission);
  }

  // ---- Kills / pickups feed ----
  onEnemyKilled(npc) {
    this.state.addXP(15);
    for (const line of ['student', 'gang']) {
      const m = this._active(line);
      if (!m) continue;
      const obj = this.currentObjective(m);
      const rt = this.runtime[m.id];
      if (obj && obj.type === 'defeat' && rt.spawned.includes(npc)) {
        rt.killed++;
        if (rt.killed >= rt.killNeed) this._advance(m);
        else this.updateTracker();
      }
    }
  }

  // called from Game loop to check goto + pickups + marker updates
  update(dt, playerPos) {
    for (const line of ['student', 'gang']) {
      const m = this._active(line);
      if (!m) continue;
      const obj = this.currentObjective(m);
      if (!obj) continue;
      const rt = this.runtime[m.id];

      if (obj.type === 'goto') {
        const loc = LOCATIONS[obj.at];
        if (loc && Math.hypot(playerPos.x - loc.x, playerPos.z - loc.z) < 6.5) this._advance(m);
      } else if (obj.type === 'collect') {
        for (const mesh of rt.pickups.slice()) {
          mesh.rotation.y += dt * 2; mesh.position.y = 1 + Math.sin(performance.now() / 300) * 0.2;
          if (Math.hypot(playerPos.x - mesh.position.x, playerPos.z - mesh.position.z) < 2) {
            this.scene.remove(mesh);
            rt.pickups = rt.pickups.filter(p => p !== mesh);
            this.state.addItem(mesh.userData.item, 1);
            rt.collected++;
            this.audio.cash();
            this.ui.notify(`Collected ${ITEMS[mesh.userData.item]?.name || mesh.userData.item}`, 'good');
            if (rt.collected >= rt.collectNeed) this._advance(m);
            else this.updateTracker();
          }
        }
      } else if (obj.type === 'talk' || obj.type === 'deliver') {
        // keep marker on moving NPC
        const npc = this.npcMgr.get(obj.npc);
        if (npc && this._trackedMission() === m) this.marker.position.set(npc.pos.x, 0, npc.pos.z);
      }
    }
    if (this.marker.visible) this.marker.children[1].rotation.z += dt;
  }

  _advance(m) {
    const rt = this.runtime[m.id];
    // cleanup current objective spawns
    const obj = this.currentObjective(m);
    if (obj && obj.type === 'defeat') { /* enemies already dead */ }
    const prog = this.state.missionProgress[m.id];
    prog.step++;
    this.audio.confirm();
    if (prog.step >= m.objectives.length) { this._complete(m); return; }
    this._setupObjective(m);
    this.ui.notify('Objective complete', 'good');
    this.updateTracker();
  }

  _complete(m) {
    this.state.completed.push(m.id);
    this.state.activeMission[m.line] = null;
    const r = m.rewards || {};
    if (r.money) this.state.addMoney(r.money);
    if (r.xp) this.state.addXP(r.xp);
    if (r.rep) for (const [k, v] of Object.entries(r.rep)) this.state.addRep(k, v);
    if (r.rel) for (const [npc, ch] of Object.entries(r.rel)) this.state.addRel(npc, ch);
    if (r.item) this.state.addItem(r.item, 1);
    // clear this mission's enemies/pickups
    this.marker.visible = false;
    this.audio.cash();
    this.ui.notify(`Mission Complete: ${m.title}  (+$${r.money || 0}, +${r.xp || 0} XP)`, 'mission');
    // announce next in the arc
    const nextId = m.id.slice(0, 1) + String(m.order + 1).padStart(2, '0');
    const next = MISSIONS_BY_ID[nextId];
    if (next && next.giver) {
      const giver = NPCS[next.giver];
      this.ui.notify(`Next: see ${giver?.name || next.giver} for "${next.title}"`, 'mission');
    }
    this.updateTracker();
  }

  _trackedMission() {
    // prefer active mission for current mode, else any active
    const mode = this.state.mode;
    return this._active(mode) || this._active('student') || this._active('gang');
  }

  currentTracked() { return this._trackedMission(); }

  updateTracker() {
    const m = this._trackedMission();
    if (!m) { this.ui.setTracker(null); this.marker.visible = false; return; }
    const step = this.state.missionProgress[m.id]?.step ?? 0;
    const rt = this.runtime[m.id] || {};
    const items = m.objectives.map((o, i) => {
      let text = o.text || o.type;
      if (o.type === 'defeat' && i === step) text += ` (${rt.killed || 0}/${o.count})`;
      if (o.type === 'collect' && i === step) text += ` (${rt.collected || 0}/${o.count})`;
      return { text, done: i < step, active: i === step };
    });
    this.ui.setTracker({ title: m.title, line: m.line, objectives: items });
    // ensure marker points at current objective
    const obj = m.objectives[step];
    if (obj) this._moveMarker(obj);
  }

  // Re-create runtime spawns after a load for the current objective.
  resume() {
    for (const line of ['student', 'gang']) {
      const m = this._active(line);
      if (!m) continue;
      if (!this.runtime[m.id]) this.runtime[m.id] = { killNeed: 0, killed: 0, collectNeed: 0, collected: 0, spawned: [], pickups: [] };
      this._setupObjective(m);
    }
    this.updateTracker();
  }

  markerTarget() { return this.marker.visible ? { x: this.marker.position.x, z: this.marker.position.z } : null; }
}
