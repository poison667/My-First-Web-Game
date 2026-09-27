import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Input } from './core/Input.js';
import { SaveManager } from './core/SaveManager.js';
import { AudioManager } from './core/Audio.js';
import { GameState } from './systems/GameState.js';
import { CameraController } from './systems/CameraController.js';
import { Combat } from './systems/Combat.js';
import { NPCManager } from './systems/NPCManager.js';
import { MissionManager } from './systems/MissionManager.js';
import { DialogueManager } from './systems/DialogueManager.js';
import { TownBuilder } from './world/TownBuilder.js';
import { Player } from './entities/Player.js';
import { Vehicle } from './entities/Vehicle.js';
import { UI } from './ui/UI.js';
import { BUILDINGS, INTERIORS, LOCATIONS } from './data/world.js';
import { ITEMS } from './data/items.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.settings = SaveManager.loadSettings();
    this.state = new GameState();
    this.clock = new THREE.Clock();
    this.paused = false;
    this.insideInterior = null;
    this.heatTimer = 0;
    this.cops = [];
    this.saveTimer = 0;
  }

  async init() {
    this.ui = new UI(this.state, this.settings);
    this.ui.setLoading(5, 'Starting engine…');

    // Renderer
    const preset = CONFIG.presets[this.settings.preset];
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: preset.antialias });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = preset.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._applyPixelRatio();

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fc4e8);
    this.scene.fog = new THREE.Fog(0x9fc4e8, 60, preset.drawDistance);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, preset.drawDistance + 150);
    this.camCtrl = new CameraController(this.camera, this.settings);

    // Lights
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x40502f, 0.7);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d0, 1.0);
    this.sun.position.set(50, 100, 30);
    if (preset.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(1024, 1024);
      const s = 120; const cam = this.sun.shadow.camera;
      cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s; cam.near = 1; cam.far = 300;
    }
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.ui.setLoading(25, 'Building the town…');
    this.builder = new TownBuilder(this.scene).build();
    this.colliders = this.builder.colliders;

    this.ui.setLoading(55, 'Waking the townsfolk…');
    this.npcMgr = new NPCManager(this.scene, this.state, this.settings);
    this.npcMgr.spawnAll();

    this.ui.setLoading(75, 'Loading systems…');
    this.player = new Player(this.scene, this.state);
    this.player.setPosition(LOCATIONS.home.x, 0, LOCATIONS.home.z + 12, Math.PI);

    this.audio = new AudioManager(this.settings);
    this.combat = new Combat(this.state, this.audio);
    this.combat.onKill = (npc) => this._onKill(npc);

    this.dialogue = new DialogueManager(this.state, this.ui, this.audio);
    this.missions = new MissionManager(this.scene, this.state, this.npcMgr, this.ui, this.audio);
    this.dialogue.missions = this.missions;
    this.dialogue.onClose = () => { this._maybeLock(); };
    this.dialogue.onShop = (shopId) => this.openShop(shopId);

    // Vehicles
    this.vehicles = [
      new Vehicle(this.scene, LOCATIONS.home.x + 8, LOCATIONS.home.z + 12, 0x3b7fcf),
      new Vehicle(this.scene, LOCATIONS.downtown.x, LOCATIONS.downtown.z + 14, 0xcf3b3b),
      new Vehicle(this.scene, LOCATIONS.warehouse.x - 14, LOCATIONS.warehouse.z - 16, 0x2a2a2a),
    ];

    this.input = new Input(this.canvas);
    // Start audio on first user gesture (pointer-lock click).
    this.canvas.addEventListener('click', () => { this.audio.init(); this.audio.resume(); this.audio.startMusic(); });
    this._weatherInit();
    this._wireHooks();

    this.state.onChange = (kind, payload) => this._onStateChange(kind, payload);

    // auto-load existing save
    if (SaveManager.hasSave()) {
      this.load(true);
    }

    this.ui.setLoading(100, 'Welcome to Brackenridge');
    setTimeout(() => {
      this.ui.hideLoading();
      this.ui.notify('Click the screen to lock the mouse and play. Tab = menu, M = map.', 'mission');
      this.ui.notify('🎓 Talk to Devon (at school) to start the Student story.', '');
      this.ui.notify('🔫 Talk to Rosa (at the diner) to start the Gangster story.', '');
    }, 400);

    window.addEventListener('resize', () => this._onResize());
    this.missions.updateTracker();
    this._loop();
  }

  _applyPixelRatio() {
    const preset = CONFIG.presets[this.settings.preset];
    const pr = Math.min(window.devicePixelRatio || 1, preset.pixelRatio) * this.settings.resolutionScale;
    this.renderer.setPixelRatio(pr);
  }

  _wireHooks() {
    this.ui.hooks = {
      audio: this.audio,
      resume: () => { this.ui.closeMenu(); this._maybeLock(); },
      toggleMode: () => { this.state.mode = this.state.mode === 'student' ? 'gang' : 'student'; this.missions.updateTracker(); this.ui.notify('Focus: ' + (this.state.mode === 'student' ? '🎓 Student' : '🔫 Gangster'), 'mission'); },
      save: () => this.save(),
      load: () => this.load(),
      newGame: () => this.newGame(),
      useItem: (id) => this.useItem(id),
      applySettings: (patch) => this.applySettings(patch),
      buyItem: (id, price) => this.buyItem(id, price),
      sellItem: (id, price) => this.sellItem(id, price),
      onShopClose: () => this._maybeLock(),
      markerTarget: () => this.missions.markerTarget(),
      playerPos: () => ({ x: this.player.pos.x, z: this.player.pos.z }),
    };
  }

  // ---------------- Weather ----------------
  _weatherInit() {
    this.isRaining = false;
    this.weatherTimer = 30 + Math.random() * 60;
    const count = 1200;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { pos[i*3] = (Math.random()-0.5)*120; pos[i*3+1] = Math.random()*60; pos[i*3+2] = (Math.random()-0.5)*120; }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x9fbcd0, size: 0.25, transparent: true, opacity: 0.6 }));
    this.rain.visible = false;
    this.scene.add(this.rain);
  }
  _updateWeather(dt) {
    const preset = CONFIG.presets[this.settings.preset];
    if (!preset.weather) { this.rain.visible = false; this.isRaining = false; return; }
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      this.isRaining = !this.isRaining;
      this.weatherTimer = this.isRaining ? 20 + Math.random()*40 : 60 + Math.random()*120;
      this.rain.visible = this.isRaining;
      if (this.isRaining) this.ui.notify('☔ It started raining', '');
    }
    if (this.isRaining) {
      this.rain.position.set(this.player.pos.x, 0, this.player.pos.z);
      const p = this.rain.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let y = p.getY(i) - dt * 40;
        if (y < 0) y = 60;
        p.setY(i, y);
      }
      p.needsUpdate = true;
    }
  }

  // ---------------- Day / night ----------------
  _updateTime(dt) {
    this.state.playSeconds += dt;
    this.state.time.minutes += dt * (1440 / CONFIG.world.dayLengthSeconds);
    if (this.state.time.minutes >= 1440) { this.state.time.minutes -= 1440; this.state.time.day++; }
    const hour = this.state.time.minutes / 60;

    // sun angle
    const t = hour / 24;
    const ang = (t - 0.25) * Math.PI * 2;
    this.sun.position.set(Math.cos(ang) * 120, Math.max(5, Math.sin(ang) * 120), 40);
    this.sun.target.position.copy(this.player.pos);

    // day factor 0 (night) .. 1 (noon)
    const day = Math.max(0, Math.sin((hour / 24) * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5);
    const dayColor = new THREE.Color(0x9fc4e8), nightColor = new THREE.Color(0x0a0e1e), duskColor = new THREE.Color(0xe89a5a);
    let sky = nightColor.clone().lerp(dayColor, day);
    if (hour > 5 && hour < 8) sky.lerp(duskColor, 0.4 * (1 - Math.abs(hour - 6.5) / 1.5));
    if (hour > 17 && hour < 20) sky.lerp(duskColor, 0.4 * (1 - Math.abs(hour - 18.5) / 1.5));
    if (this.isRaining) sky.multiplyScalar(0.6);
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);
    this.sun.intensity = 0.25 + day * 0.85;
    this.hemi.intensity = 0.35 + day * 0.5;

    // clock hand
    if (this.builder.clockHand) this.builder.clockHand.rotation.z = -(hour / 12) * Math.PI * 2;
  }

  _timeStr() {
    const m = Math.floor(this.state.time.minutes);
    const h = Math.floor(m / 60), mm = m % 60;
    return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  }
  _dayStr() {
    const hour = this.state.time.minutes / 60;
    const icon = this.isRaining ? '☔' : (hour > 6 && hour < 19 ? '☀' : '🌙');
    return `Day ${this.state.time.day} · ${icon}`;
  }

  // ---------------- Main loop ----------------
  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(0.05, this.clock.getDelta());

    const uiBlocking = this.ui.menuOpen || this.ui.dialogueOpen || this.ui.shopOpen;

    // global keys
    if (this.input.once('Tab')) { this.audio.init(); this.audio.resume(); this.audio.startMusic(); if (this.ui.menuOpen) this.ui.closeMenu(); else { this.input.unlock(); this.ui.openMenu('main'); } }
    if (this.input.once('Escape')) { if (this.ui.shopOpen) this.closeShop(); else if (this.ui.dialogueOpen) this.dialogue.close(); else if (this.ui.menuOpen) { this.ui.closeMenu(); this._maybeLock(); } else { this.input.unlock(); this.ui.openMenu('main'); } }
    if (this.input.once('KeyM')) { if (this.ui.menuOpen && this.ui.currentTab==='map') { this.ui.closeMenu(); this._maybeLock(); } else { this.input.unlock(); this.ui.openMenu('map'); } }

    if (!uiBlocking) {
      this._updateTime(dt);
      this._updateWeather(dt);
      this._updatePlay(dt);
      // auto-save every 60s of play
      this.saveTimer += dt;
      if (this.saveTimer > 60) { this.saveTimer = 0; this._quietSave(); }
    } else {
      // still update clock hand lightly? keep world frozen
    }

    // dialogue number keys
    if (this.ui.dialogueOpen) {
      for (let i = 0; i < 6; i++) if (this.input.once('Digit' + (i + 1))) this.ui.selectChoice(i);
    }

    this.ui.updateHUD(this._timeStr(), this._dayStr());
    if (!uiBlocking) this.ui.drawMinimap(this.player, this.npcMgr, this.missions.markerTarget(), this.camCtrl.yaw);
    this.ui.setCrosshair(this.input.locked && !uiBlocking && !this.player.inVehicle);

    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  _updatePlay(dt) {
    const mouse = this.input.consumeMouse();
    if (this.input.locked) this.camCtrl.handleMouse(mouse);

    const hour = this.state.time.minutes / 60;

    // Vehicle mode
    if (this.player.inVehicle) {
      this.player.group.visible = false;
      this.player.inVehicle.update(dt, this.input, this.colliders);
      this.player.pos.copy(this.player.inVehicle.pos); this.player.pos.y = 0;
      this.camCtrl.update(this.player.inVehicle.pos, this.colliders);
      if (this.input.once('KeyV')) this._exitVehicle();
    } else {
      const mv = this.input.moveVector();
      const rel = this.camCtrl.moveRelative(mv);
      const run = this.input.down('ShiftLeft') || this.input.down('ShiftRight');
      const jump = this.input.once('Space');
      if (jump && this.player.grounded) this.audio.jump();
      this.player.update(dt, rel, run, jump, this.colliders);
      this.camCtrl.update(this.player.pos, this.colliders);

      // attack
      if ((this.input.mouse.down || this.input.down('KeyF')) && this.player.tryAttack()) {
        this.audio.blip(200, 0.05, 'square', 0.1);
        this._resolveAttack();
      }
      if (this.input.once('KeyV')) this._enterVehicle();
    }

    // quick items
    if (this.input.once('Digit1')) this.useItem('medkit');
    if (this.input.once('Digit2')) this.useItem('burger');
    if (this.input.once('Digit3')) this.useItem('energy');
    if (this.input.once('Digit4')) this.useItem('soda');

    // NPC + missions
    this.npcMgr.update(dt, hour, this.player.pos, (dmg) => this._playerHurt(dmg));
    this.missions.update(dt, this.player.pos);
    this._updateCollectibles(dt);
    this._updateHeat(dt);

    // interactions
    this._handleInteraction();

    // death
    if (this.state.health <= 0) this._playerDown();
  }

  // ---------------- Combat ----------------
  _resolveAttack() {
    const enemies = [...this.npcMgr.aliveEnemies()];
    const hit = this.combat.playerAttack(this.player, enemies);
    if (!hit) {
      // check if attacking innocent NPC -> crime
      const near = this.npcMgr.nearestInteractable(this.player.pos, this.player.state.weaponRange());
      if (near && !near.npc.isEnemy) {
        this._commitCrime(near.id);
      }
    }
  }

  _onKill(npc) {
    this.missions.onEnemyKilled(npc);
    this.state.addRep('street', 2);
    // cop kills add heat
    if (this.cops.includes(npc)) { this.state.addRep('lawdogs', 3); }
  }

  _playerHurt(dmg) {
    const dead = this.combat.hurtPlayer(dmg);
    if (dead) this._playerDown();
  }

  _playerDown() {
    this.ui.notify('You were knocked out! Waking up at the hospital…', 'bad');
    this.audio.fail();
    this.state.health = this.state.maxHealth * 0.6;
    this.state.addMoney(-Math.min(this.state.money, 50));
    this.npcMgr.clearEnemies();
    this.cops = []; this.state.setWanted(0);
    this._fadeTeleport(LOCATIONS.home.x, LOCATIONS.home.z + 12, Math.PI, null);
  }

  // ---------------- Crime / police ----------------
  _commitCrime(npcId) {
    this.state.addRel(npcId, { fear: 8, friendship: -10, trust: -8, respect: -4, rivalry: 6 });
    this.state.addRep('street', 3);
    this.state.addRep('student', -4);
    this.state.addRep('staff', -3);
    this.state.addRep('lawdogs', 6);
    this.state.addWanted(1);
    this.ui.notify('You attacked a civilian! Wanted level up.', 'bad');
    this._spawnCops();
  }
  _spawnCops() {
    if (this.state.wanted <= 0) return;
    const need = this.state.wanted;
    if (this.cops.filter(c => !c.dead).length >= need) return;
    const cops = this.npcMgr.spawnEnemies(need, this._nearestLocationKey(), 'rival');
    cops.forEach(c => { c.name = 'Cop'; c.group.userData.parts.torso.material.color.setHex(0x2f4f8f); });
    this.cops.push(...cops);
    this.heatTimer = 25;
  }
  _updateHeat(dt) {
    if (this.state.wanted <= 0) return;
    this.heatTimer -= dt;
    if (this.heatTimer <= 0) {
      this.state.setWanted(this.state.wanted - 1);
      this.state.addRep('lawdogs', -3);
      this.heatTimer = 25;
      if (this.state.wanted <= 0) { this.ui.notify('You lost the heat.', 'good'); this.cops.forEach(c => c.remove()); this.cops = []; }
      else this._spawnCops();
    }
  }
  _nearestLocationKey() {
    let best = 'downtown', bd = Infinity;
    for (const [k, l] of Object.entries(LOCATIONS)) {
      const d = Math.hypot(l.x - this.player.pos.x, l.z - this.player.pos.z);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  // ---------------- Interactions ----------------
  _handleInteraction() {
    if (this.player.inVehicle) { this.ui.setInteract('<b>V</b> Exit vehicle'); return; }
    let prompt = null, action = null;
    const pp = this.player.pos;

    // doors
    let best = null, bestD = 3.2;
    for (const d of this.builder.doors) {
      const dist = d.pos.distanceTo(pp);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    if (best) {
      if (best.kind === 'enter') { prompt = `<b>E</b> Enter ${best.name}`; action = () => this._enterInterior(best); }
      else { prompt = `<b>E</b> Leave`; action = () => this._exitInterior(best); }
    }

    // shop counter
    if (!best) {
      for (const c of this.builder.shopCounters) {
        if (c.pos.distanceTo(pp) < 3.5) { prompt = `<b>E</b> Shop at ${c.name}`; action = () => this.openShop(c.shop); break; }
      }
    }
    // activity
    if (!prompt) {
      for (const a of this.builder.activityMarkers) {
        if (a.pos.distanceTo(pp) < 3.5) { prompt = `<b>E</b> ${this._activityLabel(a.activity)}`; action = () => this._doActivity(a.activity); break; }
      }
    }
    // vehicle
    if (!prompt) {
      const v = this._nearestVehicle();
      if (v && v.pos.distanceTo(pp) < 3.5) { prompt = `<b>V</b> Drive`; }
    }
    // NPC
    if (!prompt) {
      const near = this.npcMgr.nearestInteractable(pp, 3.2);
      if (near && !near.npc.isEnemy) {
        const m = this.missions.availableFrom(near.id);
        prompt = `<b>E</b> Talk to ${near.npc.name}` + (m ? ' ⭐' : '');
        action = () => this._talkTo(near.id);
      }
    }

    this.ui.setInteract(prompt);
    if (prompt && action && this.input.once('KeyE')) { this.audio.init(); this.audio.resume(); action(); }
  }

  _activityLabel(a) { return a === 'gym' ? 'Train (costs $10, +XP/HP)' : a === 'arcade' ? 'Play Arcade ($5)' : a === 'home' ? 'Rest & Save' : 'Use'; }
  _doActivity(a) {
    if (a === 'gym') {
      if (!this.state.spend(10)) return this.ui.notify('Need $10 to train', 'bad');
      this.state.addXP(25); this.state.maxStamina += 1; this.state.heal(20);
      this.audio.confirm(); this.ui.notify('Trained hard! +25 XP, stamina up', 'good');
    } else if (a === 'arcade') {
      if (!this.state.spend(5)) return this.ui.notify('Need $5 to play', 'bad');
      const win = Math.random() < 0.4;
      if (win) { this.state.addMoney(15); this.ui.notify('High score! Won $15', 'good'); this.audio.cash(); }
      else { this.ui.notify('So close! Try again.', ''); this.audio.ui(); }
      this.state.addXP(5);
    } else if (a === 'home') {
      // rest: advance to morning, heal, save
      this.state.time.minutes = 7 * 60; this.state.time.day++;
      this.state.health = this.state.maxHealth; this.state.stamina = this.state.maxStamina;
      this.save(); this.audio.confirm(); this.ui.notify('Rested until morning. Game saved.', 'good');
    }
  }

  _talkTo(npcId) {
    this.input.unlock();
    this.dialogue.talk(npcId);
  }

  _enterInterior(door) {
    if (door.interior === 'warehouse' && this.state.rep('street') < 5 && !this.state.completed.some(id => id.startsWith('G'))) {
      this.ui.notify("The Kings won't let you in. Build some street rep first.", 'bad');
      return;
    }
    const c = this.builder.interiorCenters[door.interior];
    const def = INTERIORS[door.interior];
    this.insideInterior = door.interior;
    this._fadeTeleport(c.x, c.z + def.d / 2 - 3, Math.PI, () => this.ui.notify('Entered ' + def.name, ''));
  }
  _exitInterior(door) {
    const b = BUILDINGS.find(bb => bb.id === door.exit);
    const dp = b ? b.door : LOCATIONS.downtown;
    this.insideInterior = null;
    this._fadeTeleport(dp.x, dp.z + 3, 0, null);
  }

  _fadeTeleport(x, z, rot, cb) {
    this.ui.fade(true);
    setTimeout(() => {
      this.player.setPosition(x, 0, z, rot);
      this.camera.position.set(x, 5, z + 8);
      cb && cb();
      setTimeout(() => this.ui.fade(false), 150);
    }, 350);
  }

  // ---------------- Vehicles ----------------
  _nearestVehicle() {
    let best = null, bd = 4;
    for (const v of this.vehicles) { const d = v.pos.distanceTo(this.player.pos); if (d < bd) { bd = d; best = v; } }
    return best;
  }
  _enterVehicle() {
    const v = this._nearestVehicle();
    if (v && !this.insideInterior) { v.occupied = true; this.player.inVehicle = v; this.camCtrl.distance = 9; this.ui.notify('Driving. Press V to exit.', ''); this.audio.confirm(); }
  }
  _exitVehicle() {
    const v = this.player.inVehicle; if (!v) return;
    v.occupied = false; v.speed = 0; this.player.inVehicle = null;
    this.player.setPosition(v.pos.x + 3, 0, v.pos.z, v.rot);
    this.camCtrl.distance = CONFIG.camera.distance;
  }

  // ---------------- Collectibles ----------------
  _updateCollectibles(dt) {
    for (const c of this.builder.collectibles) {
      if (this.state.collected.includes(c.id)) { c.mesh.visible = false; continue; }
      c.mesh.rotation.y += dt * 1.5;
      c.mesh.position.y = 1.4 + Math.sin(performance.now() / 400) * 0.25;
      if (c.pos.distanceTo(this.player.pos) < 2.2) {
        this.state.collected.push(c.id);
        c.mesh.visible = false;
        const reward = 40;
        this.state.addMoney(reward); this.state.addXP(20);
        this.audio.cash();
        this.ui.notify(`Secret found: ${c.name}! +$${reward} (${this.state.collected.length}/${this.builder.collectibles.length})`, 'good');
      }
    }
  }

  // ---------------- Shop / items ----------------
  openShop(shopId) { this.input.unlock(); this.ui.openShop(shopId); }
  closeShop() { this.ui.closeShop(); this._maybeLock(); }
  buyItem(id, price) {
    if (this.state.usedSlots() >= this.state.maxSlots && !this.state.inventory[id]) return this.ui.notify('Inventory full!', 'bad');
    if (!this.state.spend(price)) return this.ui.notify('Not enough money', 'bad');
    this.state.addItem(id, 1);
    if (id === 'backpack') this.state.maxSlots += 6;
    this.audio.cash(); this.ui.notify(`Bought ${ITEMS[id].name}`, 'good');
  }
  sellItem(id, price) {
    if (!this.state.removeItem(id, 1)) return;
    this.state.addMoney(price); this.audio.cash();
    this.ui.notify(`Sold ${ITEMS[id].name} for $${price}`, 'good');
  }
  useItem(id) {
    const it = ITEMS[id]; if (!it || !this.state.hasItem(id)) return;
    if (it.type !== 'consumable') return;
    this.state.removeItem(id, 1);
    if (it.heal) this.state.heal(it.heal);
    if (it.stamina) this.state.stamina = Math.min(this.state.maxStamina, this.state.stamina + it.stamina);
    this.audio.confirm(); this.ui.notify(`Used ${it.name}`, 'good');
  }

  // ---------------- State change reactions ----------------
  _onStateChange(kind, payload) {
    if (kind === 'levelup') { this.ui.notify(`Level Up! You are now level ${payload}`, 'mission'); this.audio.confirm(); }
    if (kind === 'rep' && payload.track === 'lawdogs' && this.state.rep('lawdogs') > 60 && this.state.wanted < 3) { this.state.addWanted(1); this._spawnCops(); }
  }

  // ---------------- Save / load ----------------
  save() {
    this.state.spawn = { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z, rot: this.player.rot, interior: this.insideInterior };
    SaveManager.save(this.state.serialize());
    this.ui.notify('Game saved 💾', 'good');
  }
  _quietSave() {
    this.state.spawn = { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z, rot: this.player.rot, interior: this.insideInterior };
    SaveManager.save(this.state.serialize());
  }
  load(silent) {
    const d = SaveManager.load();
    if (!d) { if (!silent) this.ui.notify('No save found', 'bad'); return; }
    this.state.deserialize(d);
    this.npcMgr.clearEnemies(); this.cops = [];
    if (this.state.spawn) { this.player.setPosition(this.state.spawn.x, this.state.spawn.y, this.state.spawn.z, this.state.spawn.rot); this.insideInterior = this.state.spawn.interior || null; }
    this.missions.resume();
    if (!silent) { this.ui.notify('Game loaded 📂', 'good'); this.ui.closeMenu(); this._maybeLock(); }
  }
  newGame() {
    SaveManager.clear();
    this.state.reset();
    this.npcMgr.clearEnemies(); this.cops = [];
    this.player.setPosition(LOCATIONS.home.x, 0, LOCATIONS.home.z + 12, Math.PI);
    this.insideInterior = null;
    this.missions.updateTracker();
    this.ui.closeMenu(); this._maybeLock();
    this.ui.notify('New game! Talk to Devon (school) for the Student story or Rosa (diner) for the Gangster story.', 'mission');
    // auto-start first missions availability by talking to givers
  }

  // ---------------- Settings ----------------
  applySettings(patch) {
    Object.assign(this.settings, patch);
    SaveManager.saveSettings(this.settings);
    const preset = CONFIG.presets[this.settings.preset];
    this._applyPixelRatio();
    this.renderer.shadowMap.enabled = preset.shadows;
    this.sun.castShadow = preset.shadows;
    this.scene.fog.far = preset.drawDistance;
    this.camera.far = preset.drawDistance + 150; this.camera.updateProjectionMatrix();
    this.audio.setVolumes(this.settings.masterVolume, this.settings.musicVolume);
    if (this.ui.currentTab === 'settings') { /* keep values */ }
  }

  _maybeLock() {
    if (!this.ui.menuOpen && !this.ui.dialogueOpen && !this.ui.shopOpen) this.canvas.requestPointerLock?.();
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this._applyPixelRatio();
  }
}
