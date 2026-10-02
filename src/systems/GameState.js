import { CONFIG } from '../config.js';
import { NPCS } from '../data/npcs.js';
import { REPUTATION_TRACKS } from '../data/factions.js';
import { ITEMS } from '../data/items.js';

const REL_KEYS = ['friendship', 'trust', 'respect', 'rivalry', 'fear', 'affinity'];

// Central persistent state for the ONE player character across BOTH storylines.
export class GameState {
  constructor() {
    this.reset();
    this.onChange = null;     // callback(kind, payload) for UI/notifications
  }

  reset() {
    this.maxHealth = CONFIG.player.maxHealth;
    this.health = this.maxHealth;
    this.maxStamina = CONFIG.player.maxStamina;
    this.stamina = this.maxStamina;
    this.money = 50;
    this.xp = 0;
    this.level = 1;
    this.xpToNext = 100;

    this.inventory = { soda: 2 };
    this.equippedWeapon = 'fists';
    this.ammo = { mag: 0, reserve: 0 };   // ranged weapon ammunition
    this.equippedGear = null;
    this.maxSlots = 12;

    // Reputation (multiple named tracks). lawdogs = police heat (bad when high).
    this.reputation = {};
    REPUTATION_TRACKS.forEach(t => this.reputation[t.key] = t.key === 'lawdogs' ? 0 : 0);

    // Relationships with named NPCs.
    this.relationships = {};
    for (const id of Object.keys(NPCS)) {
      this.relationships[id] = { friendship: 0, trust: 0, respect: 0, rivalry: 0, fear: 0, affinity: 0, met: false };
    }

    this.romance = null;      // npc id of current partner
    this.flags = {};          // arbitrary story flags
    this.wanted = 0;          // 0..5

    // Mission tracking
    this.completed = [];      // mission ids
    this.activeMission = { student: null, gang: null };
    this.missionProgress = {};// missionId -> {step, counts}

    this.mode = 'student';    // which storyline badge is shown
    this.time = { day: 1, minutes: CONFIG.world.startHour * 60 };
    this.playSeconds = 0;
    this.spawn = null;        // saved player position {x,y,z,rot}
    this.collected = [];      // collectible ids found
  }

  // ---- Economy ----
  addMoney(n) {
    this.money = Math.max(0, this.money + n);
    this.emit('money', n);
  }
  spend(n) { if (this.money >= n) { this.money -= n; this.emit('money', -n); return true; } return false; }

  // ---- Inventory ----
  addItem(id, n = 1) {
    if (!ITEMS[id]) return false;
    this.inventory[id] = (this.inventory[id] || 0) + n;
    this.emit('item', { id, n });
    return true;
  }
  removeItem(id, n = 1) {
    if ((this.inventory[id] || 0) < n) return false;
    this.inventory[id] -= n;
    if (this.inventory[id] <= 0) delete this.inventory[id];
    this.emit('item', { id, n: -n });
    return true;
  }
  hasItem(id, n = 1) { return (this.inventory[id] || 0) >= n; }
  itemCount(id) { return this.inventory[id] || 0; }
  usedSlots() { return Object.keys(this.inventory).length; }

  equipWeapon(id) { if (ITEMS[id]?.type === 'weapon') { this.equippedWeapon = id; this.emit('equip'); } }
  equipGear(id) { if (ITEMS[id]?.type === 'gear') { this.equippedGear = id; this.emit('equip'); } }

  weaponDamage() { return ITEMS[this.equippedWeapon]?.damage || CONFIG.player.attackDamage; }
  weaponRange() { return ITEMS[this.equippedWeapon]?.range || CONFIG.player.attackRange; }
  armor() { return this.equippedGear ? (ITEMS[this.equippedGear]?.armor || 0) : 0; }

  // ---- Health / progression ----
  heal(n) { this.health = Math.min(this.maxHealth, this.health + n); this.emit('health'); }
  damage(n) {
    const reduced = n * (1 - Math.min(0.6, this.armor() / 100));
    this.health = Math.max(0, this.health - reduced);
    this.emit('health');
    return this.health <= 0;
  }
  addXP(n) {
    this.xp += n;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.maxHealth += 10; this.health = this.maxHealth;
      this.maxStamina += 5; this.stamina = this.maxStamina;
      this.xpToNext = Math.floor(this.xpToNext * 1.35);
      this.emit('levelup', this.level);
    }
    this.emit('xp');
  }

  // ---- Reputation ----
  addRep(track, n) {
    if (this.reputation[track] === undefined) return;
    this.reputation[track] = Math.max(-100, Math.min(100, this.reputation[track] + n));
    // Overall reputation drifts with the big tracks.
    if (track !== 'overall' && track !== 'lawdogs') {
      this.reputation.overall = Math.max(-100, Math.min(100, this.reputation.overall + Math.round(n * 0.2)));
    }
    this.emit('rep', { track, n });
  }
  rep(track) { return this.reputation[track] || 0; }

  // ---- Relationships ----
  addRel(npcId, changes) {
    const r = this.relationships[npcId];
    if (!r) return;
    r.met = true;
    for (const k of REL_KEYS) {
      if (changes[k]) r[k] = Math.max(-100, Math.min(100, (r[k] || 0) + changes[k]));
    }
    this.emit('rel', { npcId, changes });
  }
  rel(npcId) { return this.relationships[npcId] || { friendship: 0, trust: 0, respect: 0, rivalry: 0, fear: 0, affinity: 0 }; }
  relTier(npcId) {
    const r = this.rel(npcId);
    const score = (r.friendship + r.trust + r.respect + r.affinity) - (r.rivalry + r.fear);
    if (r.rivalry > 40 || score < -40) return 'hostile';
    if (score < 0) return 'cold';
    if (score > 60) return 'warm';
    return 'neutral';
  }

  // ---- Wanted / heat ----
  setWanted(n) { this.wanted = Math.max(0, Math.min(5, n)); this.emit('wanted'); }
  addWanted(n) { this.setWanted(this.wanted + n); }

  // Reputation affects shop prices (an example of the world reacting to rep).
  priceFactor() {
    const r = Math.max(0, this.rep('overall')) + Math.max(0, this.rep('street')) * 0.5;
    return 1 - Math.min(0.2, r / 500);
  }
  sellFactor() {
    const r = Math.max(0, this.rep('overall')) + Math.max(0, this.rep('street')) * 0.5;
    return 1 + Math.min(0.25, r / 400);
  }

  emit(kind, payload) { if (this.onChange) this.onChange(kind, payload); }

  // ---- Serialization ----
  serialize() {
    return {
      v: CONFIG.version,
      maxHealth: this.maxHealth, health: this.health, maxStamina: this.maxStamina, stamina: this.stamina,
      money: this.money, xp: this.xp, level: this.level, xpToNext: this.xpToNext,
      inventory: this.inventory, equippedWeapon: this.equippedWeapon, equippedGear: this.equippedGear, maxSlots: this.maxSlots,
      ammo: this.ammo,
      reputation: this.reputation, relationships: this.relationships, romance: this.romance, flags: this.flags,
      wanted: this.wanted, completed: this.completed, activeMission: this.activeMission, missionProgress: this.missionProgress,
      mode: this.mode, time: this.time, playSeconds: this.playSeconds, spawn: this.spawn, collected: this.collected,
    };
  }
  deserialize(d) {
    if (!d) return;
    Object.assign(this, d);
    if (!this.ammo) this.ammo = { mag: 0, reserve: 0 };
    // Ensure new relationship entries exist if data changed.
    for (const id of Object.keys(NPCS)) {
      if (!this.relationships[id]) this.relationships[id] = { friendship: 0, trust: 0, respect: 0, rivalry: 0, fear: 0, affinity: 0, met: false };
    }
  }
}
