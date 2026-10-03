import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Input } from './core/Input.js';
import { SaveManager } from './core/SaveManager.js';
import { AudioManager } from './core/Audio.js';
import { GameState } from './systems/GameState.js';
import { CameraController } from './systems/CameraController.js';
import { CollisionWorld } from './systems/Physics.js';
import { InteractionSystem } from './systems/Interaction.js';
import { WeaponSystem } from './systems/Weapons.js';
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
    this.settings = { ...CONFIG.defaultSettings, ...SaveManager.loadSettings() };
    this.state = new GameState();
    this.clock = new THREE.Clock();
    this.paused = false;
    this.insideInterior = null;
    this.heatTimer = 0;
    this.cops = [];
    this.saveTimer = 0;
    this.tiredMsgT = 0;
    this.engineSoundT = 0;
    this.hintT = 75;            // seconds the on-screen control reminder stays up
  }

  /** Overridable seam so headless tests can boot the game without WebGL. */
  _createRenderer(preset) {
    return new THREE.WebGLRenderer({ canvas: this.canvas, antialias: preset.antialias });
  }

  async init() {
    this.ui = new UI(this.state, this.settings);
    this.ui.setLoading(5, 'Starting engine…');

    // Renderer
    const preset = CONFIG.presets[this.settings.preset];
    this.renderer = this._createRenderer(preset);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = preset.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._applyPixelRatio();

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fc4e8);
    this.scene.fog = new THREE.Fog(0x9fc4e8, 60, preset.drawDistance);

    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, window.innerWidth / window.innerHeight, 0.1, preset.drawDistance + 150);
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
    this.colliders = this.builder.colliders;             // legacy alias
    this.world = new CollisionWorld(this.builder.colliders);
    for (const l of this.builder.ladders) this.world.addLadder(l);

    this.ui.setLoading(55, 'Waking the townsfolk…');
    this.npcMgr = new NPCManager(this.scene, this.state, this.settings);
    this.npcMgr.spawnAll();

    this.ui.setLoading(75, 'Loading systems…');
    this.audio = new AudioManager(this.settings);

    this.player = new Player(this.scene, this.state, {
      world: this.world,
      settings: this.settings,
      onEvent: (type, data) => this._onPlayerEvent(type, data),
    });
    this.player.setPosition(LOCATIONS.home.x, 0, LOCATIONS.home.z + 12, Math.PI);
    this.camCtrl.yaw = this.camCtrl.yawTarget = this.player.rot;
    this.camCtrl.snap(this.player.pos);
    this._syncWeaponVisual();

    this.combat = new Combat(this.state, this.audio);
    this.combat.onKill = (npc) => this._onKill(npc);

    this.weapons = new WeaponSystem(this.scene, this.state, this.audio, {
      onHitNPC: (npc, dmg, head, point) => this._onShotNPC(npc, dmg, head, point),
      onEvent: (type, data) => this._onWeaponEvent(type, data),
    });

    this.interaction = new InteractionSystem();

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
      new Vehicle(this.scene, LOCATIONS.school_gate.x + 16, LOCATIONS.school_gate.z + 6, 0xd8b23c),
    ];
    for (const v of this.vehicles) v.onImpact = (f) => { this.camCtrl.addShake(Math.min(0.8, f * 0.06), 0.3); this.audio.hit(); };

    this.input = new Input(this.canvas, this.settings);
    this._registerInteractions();

    // Start audio on first user gesture (pointer-lock click).
    this.canvas.addEventListener('click', () => { this.audio.init(); this.audio.resume(); this.audio.startMusic(); });
    this._weatherInit();
    this._wireHooks();

    this.state.onChange = (kind, payload) => this._onStateChange(kind, payload);

    // auto-load existing save
    if (SaveManager.hasSave()) this.load(true);

    this.ui.setLoading(100, 'Welcome to Brackenridge');
    setTimeout(() => {
      this.ui.hideLoading();
      this.ui.notify('Click to lock the mouse. WASD move · Shift sprint · Ctrl crouch · Space jump/climb · E interact', 'mission');
      this.ui.notify('Space at a wall vaults or climbs it. Ladders take you to the rooftops.', '');
      this.ui.notify('🎓 Devon (school) starts the Student story · 🔫 Rosa (diner) starts the Gangster story.', '');
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
      equipWeapon: (id) => { this.state.equipWeapon(id); this._syncWeaponVisual(); },
    };
  }

  // =========================================================================
  // Interactions
  // =========================================================================

  _registerInteractions() {
    const I = this.interaction;

    // Doors in / out of buildings
    I.addProvider((ctx, out) => {
      for (const d of this.builder.doors) {
        if (Math.abs(d.pos.z - ctx.player.pos.z) > 6 || Math.abs(d.pos.x - ctx.player.pos.x) > 6) continue;
        out.push({
          pos: d.pos, range: 3.2, priority: 1.4, vertical: 3,
          label: d.kind === 'enter' ? `Enter ${d.name}` : 'Go outside',
          action: () => (d.kind === 'enter' ? this._enterInterior(d) : this._exitInterior(d)),
        });
      }
    });

    // Shop counters
    I.addProvider((ctx, out) => {
      for (const c of this.builder.shopCounters) {
        out.push({ pos: c.pos, range: 3.4, priority: 1.1, label: `Shop at ${c.name}`, action: () => this.openShop(c.shop) });
      }
    });

    // Activities (gym, arcade, rest at home)
    I.addProvider((ctx, out) => {
      for (const a of this.builder.activityMarkers) {
        out.push({ pos: a.pos, range: 3.4, priority: 1.0, label: this._activityLabel(a.activity), action: () => this._doActivity(a.activity) });
      }
    });

    // Vehicles
    I.addProvider((ctx, out) => {
      if (ctx.player.inVehicle) return;
      for (const v of this.vehicles) {
        out.push({
          pos: v.pos, range: 3.6, priority: 0.9, key: 'vehicle', keyLabel: 'V',
          label: 'Get in the car', action: () => this._enterVehicle(v),
        });
      }
    });

    // Ladders
    I.addProvider((ctx, out) => {
      const p = ctx.player;
      if (p.motion !== 'ground') return;
      for (const l of this.world.ladders) {
        if (p.pos.y < l.bottom - 1.5 || p.pos.y > l.top - 0.5) continue;
        const d = Math.hypot(l.x - p.pos.x, l.z - p.pos.z);
        if (d > 2.0) continue;
        out.push({
          pos: new THREE.Vector3(l.x, p.pos.y, l.z), range: 1.9, priority: 1.6, minFacing: 0.1,
          label: 'Climb the ladder', action: () => this.player.startLadder(l),
        });
      }
    });

    // People
    I.addProvider((ctx, out) => {
      const near = this.npcMgr.nearestInteractable(ctx.player.pos, 3.4);
      if (!near || near.npc.isEnemy) return;
      const m = this.missions.availableFrom(near.id);
      out.push({
        pos: near.npc.pos, range: 3.4, priority: 0.8,
        label: `Talk to ${near.npc.name}`, badge: m ? '⭐' : '',
        action: () => this._talkTo(near.id),
      });
    });
  }

  // =========================================================================
  // Player event feedback
  // =========================================================================

  _onPlayerEvent(type, data) {
    switch (type) {
      case 'footstep':
        this.audio.footstep(data.intensity, data.crouch);
        break;
      case 'jump':
        this.audio.jump();
        this.camCtrl.addDip(-0.05);
        break;
      case 'land':
        this.audio.land(data.hard);
        this.camCtrl.addDip(data.hard ? 0.4 : 0.14);
        if (data.hard) this.camCtrl.addShake(0.22, 0.22);
        if (data.damage > 0) {
          this._playerHurt(data.damage);
          this.ui.notify(`Rough landing! −${data.damage} HP`, 'bad');
        }
        break;
      case 'vault':
        this.audio.whoosh(0.9);
        this.camCtrl.addShake(0.06, 0.18);
        break;
      case 'mantle':
        this.audio.climb();
        break;
      case 'mantle-end':
      case 'vault-end':
        this.audio.footstep(0.8, false);
        break;
      case 'slide-start':
        this.audio.slide();
        this.camCtrl.addDip(0.16);
        this.camCtrl.addShake(0.08, 0.3);
        break;
      case 'slide-end':
        this.audio.footstep(0.6, data.crouched);
        break;
      case 'ladder-enter':
        this.ui.notify('On the ladder — W/S to climb, Space to drop off', '');
        break;
      case 'ladder-exit':
        this.audio.footstep(0.7, false);
        break;
      case 'vehicle-enter':
        this.audio.engine(0.35);
        break;
      case 'vehicle-exit':
        this.audio.footstep(0.8, false);
        break;
      case 'melee-start':
        this.audio.whoosh(data.type === 'kick' ? 1.2 : 1);
        break;
      case 'melee-strike':
        this._resolveMelee(data);
        break;
      case 'hurt':
        this.camCtrl.addShake(Math.min(0.5, 0.12 + data.amount * 0.01), 0.25);
        break;
      case 'crouch':
        this.audio.blip(data.on ? 220 : 320, 0.04, 'sine', 0.05);
        break;
      case 'too-tired':
        if (this.tiredMsgT <= 0) { this.ui.notify('Out of breath — catch your breath first', 'bad'); this.tiredMsgT = 4; }
        break;
    }
  }

  _onWeaponEvent(type, data) {
    if (type === 'draw') { this.ui.notify('Weapon drawn — right mouse to aim, left to fire', ''); this._syncWeaponVisual(); }
    if (type === 'holster') { this._syncWeaponVisual(); }
    if (type === 'empty') this.ui.notify('Click — empty magazine (R to reload)', 'bad');
    if (type === 'reloading') this.ui.notify('Reloading…', '');
    if (type === 'no-weapon') this.ui.notify('No firearm. Buy one at the pawn shop.', 'bad');
    if (type === 'reloaded') this.ui.notify(`Reloaded · ${data.mag} / ${data.reserve}`, '');
    if (type === 'fired') {
      // Gunfire in public is a crime, and the noise scatters nearby civilians.
      if (!this.insideInterior) {
        const witness = this.npcMgr.nearestInteractable(this.player.pos, 26);
        if (witness && !witness.npc.isEnemy) this._commitCrime(witness.id, 2);
        for (const npc of this.npcMgr.all) {
          if (npc.dead || npc.isEnemy) continue;
          if (npc.pos.distanceTo(this.player.pos) < 18) npc.scare(this.player.pos, 5);
        }
      }
      if (data.mag === 0) this.ui.notify('Magazine empty — press R', 'bad');
    }
  }

  _syncWeaponVisual() {
    const ranged = this.weapons?.weaponId;
    const drawn = this.weapons?.drawn;
    const melee = this.state.equippedWeapon;
    this.player.rig.setHasPistol(!!ranged && !drawn);
    if (ranged && drawn) this.player.setWeapon(ranged, true);
    else this.player.setWeapon(melee === 'fists' ? 'fists' : melee, melee !== 'fists');
  }

  // =========================================================================
  // Weather
  // =========================================================================
  _weatherInit() {
    this.isRaining = false;
    this.weatherTimer = 30 + Math.random() * 60;
    const count = 1200;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { pos[i * 3] = (Math.random() - 0.5) * 120; pos[i * 3 + 1] = Math.random() * 60; pos[i * 3 + 2] = (Math.random() - 0.5) * 120; }
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
      this.weatherTimer = this.isRaining ? 20 + Math.random() * 40 : 60 + Math.random() * 120;
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

  // =========================================================================
  // Day / night
  // =========================================================================
  _updateTime(dt) {
    this.state.playSeconds += dt;
    this.state.time.minutes += dt * (1440 / CONFIG.world.dayLengthSeconds);
    if (this.state.time.minutes >= 1440) { this.state.time.minutes -= 1440; this.state.time.day++; }
    const hour = this.state.time.minutes / 60;

    const t = hour / 24;
    const ang = (t - 0.25) * Math.PI * 2;
    this.sun.position.set(Math.cos(ang) * 120, Math.max(5, Math.sin(ang) * 120), 40);
    this.sun.target.position.copy(this.player.pos);

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

    if (this.builder.clockHand) this.builder.clockHand.rotation.z = -(hour / 12) * Math.PI * 2;
  }

  _timeStr() {
    const m = Math.floor(this.state.time.minutes);
    const h = Math.floor(m / 60), mm = m % 60;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  _dayStr() {
    const hour = this.state.time.minutes / 60;
    const icon = this.isRaining ? '☔' : (hour > 6 && hour < 19 ? '☀' : '🌙');
    return `Day ${this.state.time.day} · ${icon}`;
  }

  // =========================================================================
  // Main loop
  // =========================================================================
  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(0.05, this.clock.getDelta());
    this.input.update(dt);

    const uiBlocking = this.ui.menuOpen || this.ui.dialogueOpen || this.ui.shopOpen;
    if (this.tiredMsgT > 0) this.tiredMsgT -= dt;
    if (this.hintT > 0 && this.input.locked) this.hintT -= dt;

    // global keys
    if (this.input.pressed('menu')) {
      this.audio.init(); this.audio.resume(); this.audio.startMusic();
      if (this.ui.menuOpen) { this.ui.closeMenu(); this._maybeLock(); }
      else { this.input.unlock(); this.ui.openMenu('main'); }
    }
    if (this.input.pressed('pause')) {
      if (this.ui.shopOpen) this.closeShop();
      else if (this.ui.dialogueOpen) this.dialogue.close();
      else if (this.ui.menuOpen) { this.ui.closeMenu(); this._maybeLock(); }
      else { this.input.unlock(); this.ui.openMenu('main'); }
    }
    if (this.input.pressed('map')) {
      if (this.ui.menuOpen && this.ui.currentTab === 'map') { this.ui.closeMenu(); this._maybeLock(); }
      else { this.input.unlock(); this.ui.openMenu('map'); }
    }

    if (!uiBlocking) {
      this._updateTime(dt);
      this._updateWeather(dt);
      this._updatePlay(dt);
      this.saveTimer += dt;
      if (this.saveTimer > 60) { this.saveTimer = 0; this._quietSave(); }
    } else {
      // Keep the camera alive but frozen in place while menus are open.
      this.player.update(dt, { input: this.input, camYaw: this.camCtrl.yaw, camPitch: this.camCtrl.pitch, blockInput: true, canAim: false });
      this.camCtrl.update(dt, { target: this.player.inVehicle ? this.player.inVehicle.pos : this.player.pos, world: this.world });
    }

    // dialogue number keys
    if (this.ui.dialogueOpen) {
      for (let i = 0; i < 6; i++) if (this.input.pressedCode('Digit' + (i + 1))) this.ui.selectChoice(i);
    }

    this.ui.updateHUD(this._timeStr(), this._dayStr());
    if (!uiBlocking) this.ui.drawMinimap(this.player, this.npcMgr, this.missions.markerTarget(), this.camCtrl.yaw);
    this._updateHudState(uiBlocking);

    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  _updateHudState(uiBlocking) {
    const p = this.player;
    const playing = this.input.locked && !uiBlocking;
    this.ui.setStance(p.describeState(), p.exhausted);
    this.ui.setWeaponHUD(this.weapons.hudText());
    const showCross = playing && (p.aiming || (this.weapons.drawn && !p.inVehicle));
    this.ui.setCrosshair(showCross, this.weapons.crosshairGap(), p.aiming);
    this.ui.setVignette(p.aimWeight, 1 - this.state.health / this.state.maxHealth);
    this.ui.showControlsHint(this.hintT > 0 && !uiBlocking);
  }

  _updatePlay(dt) {
    const input = this.input;
    const uiBlock = false;
    const hour = this.state.time.minutes / 60;

    // ---- camera look ------------------------------------------------------
    if (input.locked || input.usingGamepad) {
      this.camCtrl.look(input.look.dx, input.look.dy, this.player.aiming);
      this.camCtrl.zoom(input.consumeWheel());
    }
    if (input.pressed('shoulder')) { this.camCtrl.swapShoulder(); this.audio.ui(); }

    const driving = !!this.player.inVehicle;

    if (driving) {
      // ---- vehicle --------------------------------------------------------
      const v = this.player.inVehicle;
      v.update(dt, input, this.world, { blocked: uiBlock });
      v.setLights(hour > 18.3 || hour < 6.6);
      this.player.update(dt, { input, camYaw: this.camCtrl.yaw, camPitch: this.camCtrl.pitch, blockInput: true, canAim: false });

      const vel = { x: Math.sin(v.rot) * v.speed, z: Math.cos(v.rot) * v.speed };
      this.camCtrl.update(dt, {
        target: new THREE.Vector3(v.pos.x, v.pos.y + 0.35, v.pos.z),
        mode: 'vehicle', world: this.world, velocity: vel,
        speedBoostFov: Math.min(12, Math.abs(v.speed) * 0.5),
      });

      this.engineSoundT -= dt;
      if (this.engineSoundT <= 0 && Math.abs(v.speed) > 0.5) {
        this.engineSoundT = 0.1;
        this.audio.engine(Math.min(1, Math.abs(v.speed) / v.maxSpeed));
      }
      if (input.pressed('vehicle')) this._exitVehicle();
    } else {
      // ---- on foot --------------------------------------------------------
      this.player.update(dt, {
        input,
        camYaw: this.camCtrl.yaw,
        camPitch: this.camCtrl.pitch,
        blockInput: uiBlock,
        canAim: this.weapons.canAim(),
      });

      let mode = 'normal';
      if (this.player.aiming) mode = 'aim';
      else if (this.player.motion === 'ladder' || this.player.isBusy()) mode = 'climb';
      else if (this.player.motion === 'slide') mode = 'slide';
      else if (this.player.stance === 'crouch') mode = 'crouch';
      else if (this.player.sprinting && this.player.speed > 4.5) mode = 'sprint';

      this.camCtrl.update(dt, {
        target: this.player.pos,
        mode, world: this.world,
        velocity: this.player.vel,
        speedBoostFov: this.player.sprinting ? Math.min(6, (this.player.speed - 4.5) * 1.6) : 0,
      });

      // melee / firearms
      if (input.pressed('melee') || (input.pressed('attack') && !this.weapons.drawn)) {
        this.player.meleeAttack();
      }
      if (input.pressed('holster')) { this.weapons.toggleDraw(); this._syncWeaponVisual(); }

      this.weapons.update(dt, {
        player: this.player, cam: this.camCtrl, world: this.world,
        targets: this.npcMgr.all, input, blocked: uiBlock,
      });
    }

    // ---- quick items ------------------------------------------------------
    if (input.pressedCode('Digit1')) this.useItem('medkit');
    if (input.pressedCode('Digit2')) this.useItem('burger');
    if (input.pressedCode('Digit3')) this.useItem('energy');
    if (input.pressedCode('Digit4')) this.useItem('soda');

    // ---- world systems ----------------------------------------------------
    this.npcMgr.update(dt, hour, this.player.pos, (dmg) => this._playerHurt(dmg, true));
    this.missions.update(dt, this.player.pos);
    this._updateCollectibles(dt);
    this._updateHeat(dt);

    // ---- contextual interaction ------------------------------------------
    // Driving suppresses world prompts: the only contextual action in a car is
    // getting back out of it.
    const found = this.interaction.update({ player: this.player, camYaw: this.camCtrl.yaw, blocked: driving });
    if (driving) {
      this.ui.setInteract('<b>V</b> Get out · <b>Space</b> Handbrake');
    } else if (found) {
      this.ui.setInteract(this.interaction.prompt());
      if (this.interaction.tryTrigger(input)) { this.audio.init(); this.audio.resume(); }
    } else {
      const hint = this.player.ledgeHint();
      if (hint === 'vault') this.ui.setInteract('<b>Space</b> Vault over');
      else if (hint === 'mantle') this.ui.setInteract('<b>Space</b> Climb up');
      else this.ui.setInteract(null);
    }

    if (this.state.health <= 0) this._playerDown();
  }

  // =========================================================================
  // Combat
  // =========================================================================

  _resolveMelee(data) {
    const baseRange = this.state.weaponRange() * (data.rangeMul || 1);
    const dmg = (this.state.weaponDamage() + this.state.level * 2) * (data.damageMul || 1);
    const enemies = this.npcMgr.aliveEnemies();
    const fwd = this.player.forward();
    let hitAny = false;

    for (const e of enemies) {
      const to = new THREE.Vector3(e.pos.x - this.player.pos.x, 0, e.pos.z - this.player.pos.z);
      const dist = to.length();
      if (dist > baseRange) continue;
      to.normalize();
      if (to.dot(fwd) > 0.25 || dist < 1.3) {
        const dead = e.takeDamage(dmg);
        hitAny = true;
        e.pos.add(to.multiplyScalar(0.55 + data.damageMul * 0.25));
        if (dead) this._onKill(e);
      }
    }
    if (hitAny) {
      this.audio.hit();
      this.camCtrl.addShake(0.12 * (data.damageMul || 1), 0.14);
      this.ui.hitmarker(false);
    } else {
      // Swinging at a civilian is still a crime.
      const near = this.npcMgr.nearestInteractable(this.player.pos, baseRange);
      if (near && !near.npc.isEnemy) this._commitCrime(near.id);
    }
  }

  _onShotNPC(npc, dmg, headshot, point) {
    if (npc.isEnemy) {
      const dead = npc.takeDamage(dmg);
      this.ui.hitmarker(dead || headshot);
      this.audio.hit();
      if (dead) this._onKill(npc);
      if (headshot) this.ui.notify('Headshot!', 'good');
    } else {
      this.ui.hitmarker(false);
      this.audio.hurt();
      const id = Object.keys(this.npcMgr.named).find(k => this.npcMgr.named[k] === npc);
      this._commitCrime(id || 'stranger', 2);
      this.ui.notify('You shot a civilian!', 'bad');
    }
  }

  _onKill(npc) {
    this.missions.onEnemyKilled(npc);
    this.state.addRep('street', 2);
    if (this.cops.includes(npc)) this.state.addRep('lawdogs', 3);
  }

  _playerHurt(dmg, fromNPC = false) {
    const attacker = fromNPC ? this.npcMgr.nearestEnemy(this.player.pos, 4) : null;
    this.player.hurt(dmg, attacker ? attacker.pos : null);
    const dead = this.combat.hurtPlayer(dmg);
    if (dead) this._playerDown();
  }

  _playerDown() {
    if (this._downing) return;
    this._downing = true;
    this.player.knockOut();
    this.ui.notify('You were knocked out! Waking up at the hospital…', 'bad');
    this.audio.fail();
    this.camCtrl.addShake(0.6, 0.6);
    setTimeout(() => {
      this.state.health = this.state.maxHealth * 0.6;
      this.state.stamina = this.state.maxStamina;
      this.state.addMoney(-Math.min(this.state.money, 50));
      this.npcMgr.clearEnemies();
      this.cops = []; this.state.setWanted(0);
      this.player.revive();
      this._fadeTeleport(LOCATIONS.home.x, LOCATIONS.home.z + 12, Math.PI, null);
      this._downing = false;
    }, 1200);
  }

  // =========================================================================
  // Crime / police
  // =========================================================================
  _commitCrime(npcId, severity = 1) {
    this.state.addRel(npcId, { fear: 8 * severity, friendship: -10, trust: -8, respect: -4, rivalry: 6 });
    this.state.addRep('street', 3 * severity);
    this.state.addRep('student', -4);
    this.state.addRep('staff', -3);
    this.state.addRep('lawdogs', 6 * severity);
    this.state.addWanted(1);
    this.ui.notify('Crime witnessed! Wanted level up.', 'bad');
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

  // =========================================================================
  // Buildings / activities
  // =========================================================================
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
      const ground = this.world.groundAt(x, z, 60, this.player.radius, 99);
      this.player.setPosition(x, ground.y, z, rot);
      this.camCtrl.yaw = this.camCtrl.yawTarget = rot;
      this.camCtrl.snap(this.player.pos);
      cb && cb();
      setTimeout(() => this.ui.fade(false), 150);
    }, 350);
  }

  // =========================================================================
  // Vehicles
  // =========================================================================
  _enterVehicle(v) {
    if (this.insideInterior) return;
    v.occupied = true;
    this.player.enterVehicle(v);
    this.ui.notify('Driving — W/S throttle, A/D steer, Space handbrake, V to get out', '');
    this.audio.confirm();
  }

  _exitVehicle() {
    const v = this.player.inVehicle;
    if (!v) return;
    if (Math.abs(v.speed) > 6) { this.ui.notify('Slow down first!', 'bad'); return; }
    v.occupied = false; v.speed = 0;
    // Pick the first free spot around the car.
    let spot = null;
    for (const s of v.exitSpots()) {
      const ground = this.world.groundAt(s.x, s.z, s.y + 1.5, this.player.radius, 2);
      if (this.world.isFree(s.x, ground.y + 0.05, s.z, this.player.radius, CONFIG.player.height)) {
        spot = new THREE.Vector3(s.x, ground.y, s.z); break;
      }
    }
    if (!spot) spot = new THREE.Vector3(v.pos.x, v.pos.y, v.pos.z);
    this.player.exitVehicle(spot.x, spot.y, spot.z, v.rot);
    this.camCtrl.snap(this.player.pos);
  }

  // =========================================================================
  // Collectibles
  // =========================================================================
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

  // =========================================================================
  // Shop / items
  // =========================================================================
  openShop(shopId) { this.input.unlock(); this.ui.openShop(shopId); }
  closeShop() { this.ui.closeShop(); this._maybeLock(); }
  buyItem(id, price) {
    if (this.state.usedSlots() >= this.state.maxSlots && !this.state.inventory[id]) return this.ui.notify('Inventory full!', 'bad');
    if (!this.state.spend(price)) return this.ui.notify('Not enough money', 'bad');
    this.state.addItem(id, 1);
    if (id === 'backpack') this.state.maxSlots += 6;
    if (id === 'pistol' || id === 'revolver') {
      this.weapons.sync();
      this.ui.notify('Press G to draw it, right mouse to aim.', 'mission');
    }
    this.audio.cash(); this.ui.notify(`Bought ${ITEMS[id].name}`, 'good');
  }
  sellItem(id, price) {
    if (!this.state.removeItem(id, 1)) return;
    this.state.addMoney(price); this.audio.cash();
    this.ui.notify(`Sold ${ITEMS[id].name} for $${price}`, 'good');
    this._syncWeaponVisual();
  }
  useItem(id) {
    const it = ITEMS[id]; if (!it || !this.state.hasItem(id)) return;
    if (it.type !== 'consumable') return;
    this.state.removeItem(id, 1);
    if (it.heal) this.state.heal(it.heal);
    if (it.stamina) this.state.stamina = Math.min(this.state.maxStamina, this.state.stamina + it.stamina);
    if (it.ammo) {
      const ammo = this.state.ammo || (this.state.ammo = { mag: 0, reserve: 0 });
      ammo.reserve += it.ammo;
      this.ui.notify(`+${it.ammo} rounds`, 'good');
    }
    this.audio.confirm(); this.ui.notify(`Used ${it.name}`, 'good');
  }

  // =========================================================================
  // State change reactions
  // =========================================================================
  _onStateChange(kind, payload) {
    if (kind === 'levelup') { this.ui.notify(`Level Up! You are now level ${payload}`, 'mission'); this.audio.confirm(); }
    if (kind === 'equip') this._syncWeaponVisual();
    if (kind === 'rep' && payload.track === 'lawdogs' && this.state.rep('lawdogs') > 60 && this.state.wanted < 3) { this.state.addWanted(1); this._spawnCops(); }
  }

  // =========================================================================
  // Save / load
  // =========================================================================
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
    if (this.state.spawn) {
      this.player.setPosition(this.state.spawn.x, this.state.spawn.y, this.state.spawn.z, this.state.spawn.rot);
      this.insideInterior = this.state.spawn.interior || null;
      this.camCtrl.yaw = this.camCtrl.yawTarget = this.player.rot;
      this.camCtrl.snap(this.player.pos);
    }
    this.weapons.sync();
    this._syncWeaponVisual();
    this.missions.resume();
    if (!silent) { this.ui.notify('Game loaded 📂', 'good'); this.ui.closeMenu(); this._maybeLock(); }
  }
  newGame() {
    SaveManager.clear();
    this.state.reset();
    this.npcMgr.clearEnemies(); this.cops = [];
    this.player.setPosition(LOCATIONS.home.x, 0, LOCATIONS.home.z + 12, Math.PI);
    this.camCtrl.snap(this.player.pos);
    this.insideInterior = null;
    this.weapons.drawn = false;
    this.weapons.weaponId = null;
    this._syncWeaponVisual();
    this.missions.updateTracker();
    this.ui.closeMenu(); this._maybeLock();
    this.ui.notify('New game! Talk to Devon (school) or Rosa (diner) to begin.', 'mission');
  }

  // =========================================================================
  // Settings
  // =========================================================================
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
    if (patch.shoulderSide !== undefined) this.camCtrl.shoulderSide = patch.shoulderSide;
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
