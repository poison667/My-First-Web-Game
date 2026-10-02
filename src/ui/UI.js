import { BUILDINGS, LOCATIONS, SHOPS } from '../data/world.js';
import { ITEMS } from '../data/items.js';
import { NPCS } from '../data/npcs.js';
import { REPUTATION_TRACKS, FACTIONS } from '../data/factions.js';
import { MISSIONS, STUDENT_MISSIONS, GANG_MISSIONS, MISSIONS_BY_ID } from '../data/missions.js';

export class UI {
  constructor(state, settings) {
    this.state = state;
    this.settings = settings;
    this.hooks = {};             // set by Game
    this.choices = [];
    this.menuOpen = false;
    this.shopOpen = false;
    this.dialogueOpen = false;
    this.currentTab = 'main';
    this._cache();
    this._bind();
  }

  _cache() {
    this.el = {
      loading: document.getElementById('loading'), loadbar: document.getElementById('loadbar'), loadmsg: document.getElementById('loadmsg'),
      hud: document.getElementById('hud'),
      hp: document.getElementById('hp'), sta: document.getElementById('sta'), xp: document.getElementById('xp'), level: document.getElementById('level'),
      money: document.getElementById('money'), clock: document.getElementById('clock'), dayinfo: document.getElementById('dayinfo'), wanted: document.getElementById('wanted'),
      tracker: document.getElementById('mission-tracker'), trackerTitle: document.getElementById('mission-title'), trackerObj: document.getElementById('mission-objectives'),
      minimap: document.getElementById('minimap'), compass: document.getElementById('compass'),
      interact: document.getElementById('interact-prompt'), crosshair: document.getElementById('crosshair'),
      stance: document.getElementById('stance'), weaponHud: document.getElementById('weapon-hud'),
      hitmarker: document.getElementById('hitmarker'), vignette: document.getElementById('vignette'),
      controlsHint: document.getElementById('controls-hint'),
      notifications: document.getElementById('notifications'), modeBadge: document.getElementById('mode-badge'),
      dialogue: document.getElementById('dialogue'), dlgPortrait: document.getElementById('dlg-portrait'), dlgName: document.getElementById('dlg-name'),
      dlgText: document.getElementById('dlg-text'), dlgChoices: document.getElementById('dlg-choices'), dlgRel: document.getElementById('dlg-relbar'),
      menu: document.getElementById('menu'), menuTitle: document.getElementById('menu-title'), menuTabs: document.getElementById('menu-tabs'), menuContent: document.getElementById('menu-content'),
      shop: document.getElementById('shop'), shopName: document.getElementById('shop-name'), shopMoney: document.getElementById('shop-money'),
      shopBuy: document.getElementById('shop-buy'), shopSell: document.getElementById('shop-sell'), shopClose: document.getElementById('shop-close'),
      fade: document.getElementById('fade'),
    };
    this.mmCtx = this.el.minimap.getContext('2d');
  }

  _bind() {
    this.el.menuTabs.querySelectorAll('button').forEach(b => {
      b.onclick = () => { this.openMenu(b.dataset.tab); this.hooks.audio?.ui(); };
    });
    this.el.shopClose.onclick = () => this.closeShop();
  }

  // ---------- Loading ----------
  setLoading(pct, msg) { this.el.loadbar.style.width = pct + '%'; if (msg) this.el.loadmsg.textContent = msg; }
  hideLoading() { this.el.loading.classList.add('hidden'); this.el.hud.classList.remove('hidden'); }

  // ---------- HUD ----------
  updateHUD(timeStr, dayStr) {
    const s = this.state;
    this.el.hp.style.width = (s.health / s.maxHealth * 100) + '%';
    this.el.sta.style.width = (s.stamina / s.maxStamina * 100) + '%';
    this.el.xp.style.width = (s.xp / s.xpToNext * 100) + '%';
    this.el.level.textContent = s.level;
    this.el.money.textContent = '$' + s.money.toLocaleString();
    this.el.clock.textContent = timeStr;
    this.el.dayinfo.textContent = dayStr;
    this.el.wanted.textContent = '★'.repeat(s.wanted);
    this.el.modeBadge.textContent = s.mode === 'student' ? '🎓 STUDENT' : '🔫 GANGSTER';
  }

  setTracker(data) {
    if (!data) { this.el.tracker.classList.add('hidden'); return; }
    this.el.tracker.classList.remove('hidden');
    this.el.trackerTitle.textContent = (data.line === 'student' ? '🎓 ' : '🔫 ') + data.title;
    this.el.trackerObj.innerHTML = '';
    for (const o of data.objectives) {
      const li = document.createElement('li');
      li.textContent = o.text;
      if (o.done) li.className = 'done'; else if (o.active) li.className = 'active';
      this.el.trackerObj.appendChild(li);
    }
  }

  setInteract(text) {
    if (!text) { this.el.interact.classList.add('hidden'); return; }
    this.el.interact.classList.remove('hidden');
    this.el.interact.innerHTML = text;
  }

  /** Dynamic crosshair: `gap` is the pixel distance from the centre. */
  setCrosshair(on, gap = 10, aiming = false) {
    const c = this.el.crosshair;
    c.classList.toggle('hidden', !on);
    if (!on) return;
    c.style.setProperty('--gap', Math.round(gap) + 'px');
    c.style.setProperty('--len', (aiming ? 6 : 8) + 'px');
    c.classList.toggle('aiming', !!aiming);
  }

  setStance(text, tired = false) {
    if (this._stanceText === text && this._tired === tired) return;
    this._stanceText = text; this._tired = tired;
    this.el.stance.textContent = text;
    this.el.stance.classList.toggle('tired', !!tired);
  }

  setWeaponHUD(text) {
    if (this._weaponText === text) return;
    this._weaponText = text;
    this.el.weaponHud.classList.toggle('hidden', !text);
    if (text) this.el.weaponHud.textContent = text;
  }

  hitmarker(kill = false) {
    const h = this.el.hitmarker;
    h.classList.remove('show');
    h.classList.toggle('kill', !!kill);
    void h.offsetWidth;          // restart the animation
    h.classList.add('show');
  }

  /** Aim vignette blended with a damage vignette. */
  setVignette(aim = 0, hurt = 0) {
    const v = this.el.vignette;
    const hurtStrong = hurt > 0.65;
    const opacity = Math.min(0.95, aim * 0.55 + (hurtStrong ? (hurt - 0.65) * 2.4 : 0));
    if (Math.abs((this._vig ?? -1) - opacity) > 0.01) {
      this._vig = opacity;
      v.style.opacity = opacity.toFixed(2);
    }
    v.classList.toggle('hurt', hurtStrong && aim < 0.2);
  }

  showControlsHint(show) {
    if (this._hintShown === show) return;
    this._hintShown = show;
    this.el.controlsHint?.classList.toggle('hidden', !show);
  }

  notify(text, type = '') {
    const d = document.createElement('div');
    d.className = 'notif ' + type;
    d.textContent = text;
    this.el.notifications.appendChild(d);
    setTimeout(() => d.remove(), 4000);
  }

  // ---------- Dialogue ----------
  showDialogue(data) {
    this.dialogueOpen = true;
    this.el.dialogue.classList.remove('hidden');
    this.el.dlgPortrait.textContent = data.emoji || '🧑';
    this.el.dlgPortrait.style.background = (data.color || '#333') + '55';
    this.el.dlgName.textContent = data.name || '';
    this.el.dlgName.style.color = data.color || '#ffca3a';
    this.el.dlgText.textContent = data.text || '';
    this.el.dlgRel.textContent = data.relText || '';
    this.el.dlgChoices.innerHTML = '';
    this.choices = data.choices || [];
    this.choices.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'dlg-choice';
      b.innerHTML = `<b>${i + 1}.</b> ${c.label}`;
      b.onclick = () => { this.hooks.audio?.ui(); c.cb(); };
      this.el.dlgChoices.appendChild(b);
    });
  }
  hideDialogue() { this.dialogueOpen = false; this.el.dialogue.classList.add('hidden'); }
  selectChoice(n) { if (this.choices[n]) { this.hooks.audio?.ui(); this.choices[n].cb(); } }

  // ---------- Menu ----------
  toggleMenu() { this.menuOpen ? this.closeMenu() : this.openMenu(this.currentTab); }
  openMenu(tab = 'main') {
    this.menuOpen = true; this.currentTab = tab;
    this.el.menu.classList.remove('hidden');
    this.el.menuTabs.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    this._renderTab(tab);
  }
  closeMenu() { this.menuOpen = false; this.el.menu.classList.add('hidden'); }

  _renderTab(tab) {
    const c = this.el.menuContent;
    if (tab === 'main') c.innerHTML = this._mainTab();
    else if (tab === 'missions') c.innerHTML = this._missionsTab();
    else if (tab === 'map') { c.innerHTML = '<canvas id="menu-mapcanvas" width="760" height="480"></canvas><p style="text-align:center;color:#9aa3b5;margin-top:8px">Yellow ★ = mission target · Cyan = shops/points · You = white dot</p>'; this._drawBigMap(); }
    else if (tab === 'inventory') c.innerHTML = this._inventoryTab();
    else if (tab === 'stats') c.innerHTML = this._statsTab();
    else if (tab === 'relationships') c.innerHTML = this._relTab();
    else if (tab === 'settings') c.innerHTML = this._settingsTab();
    this._wireTab(tab);
  }

  _mainTab() {
    return `
      <div class="card"><h3>Brackenridge — Two Lives</h3>
      <p>One town, one life, two paths. Follow the <span class="tag student">Student</span> story, the <span class="tag gang">Gangster</span> story, or both.</p></div>
      <button class="btn" id="btn-resume">Resume</button>
      <button class="btn" id="btn-mode">Switch Focus: ${this.state.mode === 'student' ? '🎓 Student → 🔫 Gangster' : '🔫 Gangster → 🎓 Student'}</button>
      <br>
      <button class="btn secondary" id="btn-save">💾 Save Game</button>
      <button class="btn secondary" id="btn-load">📂 Load Game</button>
      <button class="btn secondary" id="btn-new">✨ New Game</button>
      <div class="card" style="margin-top:14px"><h3>Controls</h3>
      <p><b style="color:#fff">Movement</b><br>
      <span class="kbd">W A S D</span> Move · <span class="kbd">Shift</span> Sprint · <span class="kbd">Alt</span> Walk ·
      <span class="kbd">Ctrl</span> hold crouch · <span class="kbd">C</span> toggle crouch · <span class="kbd">Space</span> Jump</p>
      <p><b style="color:#fff">Parkour</b><br>
      <span class="kbd">Space</span> at an obstacle vaults low cover or climbs a ledge · run into low cover to auto-vault ·
      <span class="kbd">E</span> at a ladder to climb, <span class="kbd">W</span>/<span class="kbd">S</span> up and down, <span class="kbd">Space</span> to drop off</p>
      <p><b style="color:#fff">Combat</b><br>
      <span class="kbd">F</span> / <span class="kbd">LMB</span> Melee combo · <span class="kbd">G</span> Draw / holster firearm ·
      <span class="kbd">RMB</span> Aim · <span class="kbd">LMB</span> Fire · <span class="kbd">R</span> Reload</p>
      <p><b style="color:#fff">World</b><br>
      <span class="kbd">E</span> Interact / enter buildings · <span class="kbd">V</span> Enter / exit vehicle ·
      <span class="kbd">Q</span> Swap camera shoulder · <span class="kbd">Wheel</span> Zoom ·
      <span class="kbd">Tab</span> Menu · <span class="kbd">M</span> Map · <span class="kbd">1-4</span> Quick items · <span class="kbd">Esc</span> Pause</p>
      <p style="color:#8a93a6">A gamepad works too: sticks move and look, A jump, B crouch, X melee, Y interact, LT aim, RT fire.</p>
      </div>`;
  }

  _missionsTab() {
    const done = this.state.completed.length;
    const line = (list, name, cls) => {
      let html = `<h3 style="color:#fff;margin:10px 0 6px">${name} (${list.filter(m=>this.state.completed.includes(m.id)).length}/${list.length})</h3>`;
      for (const m of list) {
        const isDone = this.state.completed.includes(m.id);
        const isActive = this.state.activeMission[m.line] === m.id;
        const locked = m.requires && !this.state.completed.includes(m.requires);
        let tag = isDone ? '<span class="tag done">DONE</span>' : isActive ? '<span class="tag">ACTIVE</span>' : locked ? '<span class="tag locked">LOCKED</span>' : '<span class="tag">AVAILABLE</span>';
        html += `<div class="card"><h3>${m.id}. ${m.title} ${tag}</h3><p>${m.desc}<br><small style="color:#8a93a6">Giver: ${NPCS[m.giver]?.name || m.giver} @ ${LOCATIONS[m.at]?.name || m.at}</small></p></div>`;
      }
      return html;
    };
    return `<div class="card"><h3>Progress: ${done}/100 missions complete</h3></div>` +
      line(STUDENT_MISSIONS, '🎓 Student Storyline', 'student') +
      line(GANG_MISSIONS, '🔫 Gangster Storyline', 'gang');
  }

  _inventoryTab() {
    const s = this.state;
    let html = `<div class="card"><h3>Inventory (${s.usedSlots()}/${s.maxSlots})</h3><p>Money: $${s.money} · Weapon: ${ITEMS[s.equippedWeapon]?.name} · Gear: ${s.equippedGear ? ITEMS[s.equippedGear].name : 'None'}</p></div>`;
    const ids = Object.keys(s.inventory);
    if (!ids.length) html += '<p style="color:#9aa3b5">Empty. Buy items at shops.</p>';
    for (const id of ids) {
      const it = ITEMS[id]; if (!it) continue;
      let actions = '';
      if (it.type === 'consumable') actions = `<button class="btn use" data-id="${id}">Use</button>`;
      if (it.type === 'weapon') actions = `<button class="btn equipw" data-id="${id}">${s.equippedWeapon===id?'Equipped':'Equip'}</button>`;
      if (it.type === 'gear') actions = `<button class="btn equipg" data-id="${id}">${s.equippedGear===id?'Equipped':'Equip'}</button>`;
      html += `<div class="shop-item"><div class="info">${it.icon} <b>${it.name}</b> x${s.inventory[id]}<small>${it.desc}</small></div>${actions}</div>`;
    }
    return html;
  }

  _statsTab() {
    const s = this.state;
    let html = `<div class="card"><h3>Character</h3><p>Level ${s.level} · XP ${s.xp}/${s.xpToNext} · HP ${Math.round(s.health)}/${s.maxHealth} · Stamina ${Math.round(s.stamina)}/${s.maxStamina} · Armor ${s.armor()}</p></div>`;
    html += '<div class="card"><h3>Reputation</h3>';
    for (const t of REPUTATION_TRACKS) {
      const v = s.rep(t.key);
      const pct = ((v + 100) / 200) * 100;
      const color = t.key === 'lawdogs' ? (v > 40 ? '#ef476f' : '#06d6a0') : (v >= 0 ? '#06d6a0' : '#ef476f');
      html += `<div class="relrow"><span class="nm">${t.name}</span><div class="minibar"><div style="width:${pct}%;background:${color}"></div></div><span style="width:44px;text-align:right">${v}</span></div>`;
    }
    html += '</div><div class="card"><h3>Factions</h3>';
    for (const [k, f] of Object.entries(FACTIONS)) {
      html += `<p><b style="color:#${f.color.toString(16)}">${f.name}</b> — ${f.turf}. ${f.desc}</p>`;
    }
    html += '</div>';
    return html;
  }

  _relTab() {
    const s = this.state;
    let html = '<div class="card"><h3>People You Know</h3><p>Relationships shift with your choices and remember what you do.</p></div>';
    for (const [id, def] of Object.entries(NPCS)) {
      const r = s.rel(id);
      if (!r.met && r.friendship === 0 && r.trust === 0 && r.respect === 0 && r.rivalry === 0) continue;
      const score = r.friendship + r.trust + r.respect + r.affinity - r.rivalry - r.fear;
      const tier = s.relTier(id);
      const partner = s.romance === id ? ' 💞' : '';
      html += `<div class="card"><h3>${def.emoji} ${def.name}${partner} <span class="tag">${tier}</span></h3>
        <p>${def.bio}</p>
        <div class="relrow"><span class="nm">Friendship</span><div class="minibar"><div style="width:${(r.friendship+100)/2}%;background:#06d6a0"></div></div></div>
        <div class="relrow"><span class="nm">Trust</span><div class="minibar"><div style="width:${(r.trust+100)/2}%;background:#4cc9f0"></div></div></div>
        <div class="relrow"><span class="nm">Respect</span><div class="minibar"><div style="width:${(r.respect+100)/2}%;background:#ffca3a"></div></div></div>
        <div class="relrow"><span class="nm">Rivalry</span><div class="minibar"><div style="width:${(r.rivalry+100)/2}%;background:#ef476f"></div></div></div>
        ${def.romance ? `<div class="relrow"><span class="nm">Affinity ♥</span><div class="minibar"><div style="width:${(r.affinity+100)/2}%;background:#e86fa0"></div></div></div>` : ''}
      </div>`;
    }
    return html;
  }

  _settingsTab() {
    const st = this.settings;
    return `
      <div class="card"><h3>Graphics</h3>
      <div class="row"><label>Preset</label><select id="set-preset">
        <option value="low" ${st.preset==='low'?'selected':''}>Low</option>
        <option value="medium" ${st.preset==='medium'?'selected':''}>Medium</option>
        <option value="high" ${st.preset==='high'?'selected':''}>High</option></select></div>
      <div class="row"><label>Render Resolution (${Math.round(st.resolutionScale*100)}%)</label><input type="range" id="set-res" min="0.4" max="1.5" step="0.05" value="${st.resolutionScale}"></div>
      </div>
      <div class="card"><h3>Audio</h3>
      <div class="row"><label>Master Volume</label><input type="range" id="set-master" min="0" max="1" step="0.05" value="${st.masterVolume}"></div>
      <div class="row"><label>Music Volume</label><input type="range" id="set-music" min="0" max="1" step="0.05" value="${st.musicVolume}"></div>
      </div>
      <div class="card"><h3>Camera</h3>
      <div class="row"><label>Look Sensitivity</label><input type="range" id="set-sens" min="0.3" max="2.5" step="0.1" value="${st.sensitivity}"></div>
      <div class="row"><label>Aim Sensitivity (×)</label><input type="range" id="set-aimsens" min="0.2" max="1.5" step="0.05" value="${st.aimSensitivity ?? 0.6}"></div>
      <div class="row"><label>Camera Shake</label><input type="range" id="set-shake" min="0" max="1.5" step="0.1" value="${st.cameraShake ?? 1}"></div>
      <div class="row"><label>Invert Y</label><input type="checkbox" id="set-invert" ${st.invertY?'checked':''}></div>
      <div class="row"><label>Camera Shoulder</label><select id="set-shoulder">
        <option value="1" ${(st.shoulderSide ?? 1) === 1 ? 'selected' : ''}>Right</option>
        <option value="-1" ${(st.shoulderSide ?? 1) === -1 ? 'selected' : ''}>Left</option></select></div>
      </div>
      <div class="card"><h3>Movement</h3>
      <div class="row"><label>Hold Ctrl to crouch (off = toggle)</label><input type="checkbox" id="set-togglecrouch" ${st.toggleCrouch?'checked':''}></div>
      <div class="row"><label>Toggle aim (instead of hold)</label><input type="checkbox" id="set-toggleaim" ${st.toggleAim?'checked':''}></div>
      <div class="row"><label>Auto-vault when running</label><input type="checkbox" id="set-autovault" ${st.autoVault !== false ?'checked':''}></div>
      </div>`;
  }

  _wireTab(tab) {
    const q = (id) => document.getElementById(id);
    if (tab === 'main') {
      q('btn-resume').onclick = () => this.hooks.resume?.();
      q('btn-mode').onclick = () => { this.hooks.toggleMode?.(); this._renderTab('main'); };
      q('btn-save').onclick = () => this.hooks.save?.();
      q('btn-load').onclick = () => this.hooks.load?.();
      q('btn-new').onclick = () => { if (confirm('Start a new game? Unsaved progress is lost.')) this.hooks.newGame?.(); };
    } else if (tab === 'inventory') {
      this.el.menuContent.querySelectorAll('.use').forEach(b => b.onclick = () => { this.hooks.useItem?.(b.dataset.id); this._renderTab('inventory'); });
      this.el.menuContent.querySelectorAll('.equipw').forEach(b => b.onclick = () => { (this.hooks.equipWeapon ?? ((id) => this.state.equipWeapon(id)))(b.dataset.id); this._renderTab('inventory'); });
      this.el.menuContent.querySelectorAll('.equipg').forEach(b => b.onclick = () => { this.state.equipGear(b.dataset.id); this._renderTab('inventory'); });
    } else if (tab === 'settings') {
      q('set-preset').onchange = (e) => this.hooks.applySettings?.({ preset: e.target.value });
      q('set-res').oninput = (e) => this.hooks.applySettings?.({ resolutionScale: parseFloat(e.target.value) });
      q('set-master').oninput = (e) => this.hooks.applySettings?.({ masterVolume: parseFloat(e.target.value) });
      q('set-music').oninput = (e) => this.hooks.applySettings?.({ musicVolume: parseFloat(e.target.value) });
      q('set-sens').oninput = (e) => this.hooks.applySettings?.({ sensitivity: parseFloat(e.target.value) });
      q('set-aimsens').oninput = (e) => this.hooks.applySettings?.({ aimSensitivity: parseFloat(e.target.value) });
      q('set-shake').oninput = (e) => this.hooks.applySettings?.({ cameraShake: parseFloat(e.target.value) });
      q('set-invert').onchange = (e) => this.hooks.applySettings?.({ invertY: e.target.checked });
      q('set-shoulder').onchange = (e) => this.hooks.applySettings?.({ shoulderSide: parseInt(e.target.value, 10) });
      q('set-togglecrouch').onchange = (e) => this.hooks.applySettings?.({ toggleCrouch: e.target.checked });
      q('set-toggleaim').onchange = (e) => this.hooks.applySettings?.({ toggleAim: e.target.checked });
      q('set-autovault').onchange = (e) => this.hooks.applySettings?.({ autoVault: e.target.checked });
    }
  }

  // ---------- Shop ----------
  openShop(shopId) {
    const shop = SHOPS[shopId]; if (!shop) return;
    this.shopOpen = true; this._shopId = shopId;
    this.el.shop.classList.remove('hidden');
    this.el.shopName.textContent = shop.name;
    this._renderShop();
  }
  closeShop() { this.shopOpen = false; this.el.shop.classList.add('hidden'); this.hooks.onShopClose?.(); }
  _renderShop() {
    const shop = SHOPS[this._shopId];
    this.el.shopMoney.textContent = 'Your money: $' + this.state.money;
    // buy
    this.el.shopBuy.innerHTML = '';
    for (const id of shop.stock) {
      const it = ITEMS[id]; const price = Math.max(1, Math.round(it.price * shop.buyMul * this.state.priceFactor()));
      const row = document.createElement('div'); row.className = 'shop-item';
      row.innerHTML = `<div class="info">${it.icon} <b>${it.name}</b><small>${it.desc}</small></div><span class="price">$${price}</span><button class="btn">Buy</button>`;
      row.querySelector('button').onclick = () => { this.hooks.buyItem?.(id, price); this._renderShop(); };
      this.el.shopBuy.appendChild(row);
    }
    // sell
    this.el.shopSell.innerHTML = '';
    for (const id of Object.keys(this.state.inventory)) {
      const it = ITEMS[id]; if (!it || it.price === 0) continue;
      const price = Math.max(1, Math.round(it.price * shop.sellMul * this.state.sellFactor()));
      const row = document.createElement('div'); row.className = 'shop-item';
      row.innerHTML = `<div class="info">${it.icon} <b>${it.name}</b> x${this.state.inventory[id]}</div><span class="price">$${price}</span><button class="btn secondary">Sell</button>`;
      row.querySelector('button').onclick = () => { this.hooks.sellItem?.(id, price); this._renderShop(); };
      this.el.shopSell.appendChild(row);
    }
  }

  // ---------- Fade ----------
  fade(show) { this.el.fade.classList.toggle('show', show); }

  // ---------- Minimap ----------
  drawMinimap(player, npcMgr, markerTarget, camYaw) {
    const ctx = this.mmCtx; const size = 180; const cx = size / 2, cy = size / 2;
    const range = 90; const scale = (size / 2) / range;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#1a2417'; ctx.fillRect(0, 0, size, size);
    // roads (approx grid)
    ctx.strokeStyle = '#3a3d44'; ctx.lineWidth = 4;
    const toMap = (wx, wz) => [cx + (wx - player.pos.x) * scale, cy + (wz - player.pos.z) * scale];
    for (const z of [-30, 10, 50, 90]) { const [ax, ay] = toMap(-140, z), [bx, by] = toMap(140, z); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); }
    for (const x of [-110, -40, 20, 70, 110]) { const [ax, ay] = toMap(x, -120), [bx, by] = toMap(x, 130); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); }
    // buildings
    for (const b of BUILDINGS) {
      const [mx, my] = toMap(b.x, b.z);
      ctx.fillStyle = b.enterable ? '#6a7280' : '#454a52';
      ctx.fillRect(mx - b.w * scale / 2, my - b.d * scale / 2, b.w * scale, b.d * scale);
    }
    // npcs
    for (const n of npcMgr.all) {
      if (n.dead) continue;
      const [mx, my] = toMap(n.pos.x, n.pos.z);
      if (Math.hypot(mx - cx, my - cy) > size / 2) continue;
      ctx.fillStyle = n.isEnemy ? '#ef476f' : (n.isNamed ? '#ffca3a' : '#8fbf8f');
      ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
    }
    // mission marker
    if (markerTarget) {
      const [mx, my] = toMap(markerTarget.x, markerTarget.z);
      const ex = Math.max(8, Math.min(size - 8, mx)), ey = Math.max(8, Math.min(size - 8, my));
      ctx.fillStyle = '#ffca3a'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('★', ex, ey + 5);
    }
    ctx.restore();
    // player arrow (center)
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(player.rot);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  _drawBigMap() {
    const cv = document.getElementById('menu-mapcanvas'); if (!cv) return;
    const ctx = cv.getContext('2d'); const W = cv.width, H = cv.height;
    ctx.fillStyle = '#0c1018'; ctx.fillRect(0, 0, W, H);
    // world bounds approx -140..140 x, -120..130 z
    const minX = -145, maxX = 145, minZ = -125, maxZ = 135;
    const sx = W / (maxX - minX), sz = H / (maxZ - minZ);
    const toMap = (wx, wz) => [(wx - minX) * sx, (wz - minZ) * sz];
    // roads
    ctx.strokeStyle = '#2b2d33'; ctx.lineWidth = 6;
    for (const z of [-30, 10, 50, 90]) { const [ax, ay] = toMap(-140, z), [bx, by] = toMap(140, z); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); }
    for (const x of [-110, -40, 20, 70, 110]) { const [ax, ay] = toMap(x, -120), [bx, by] = toMap(x, 130); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); }
    // buildings + labels
    ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    for (const b of BUILDINGS) {
      const [mx, my] = toMap(b.x, b.z);
      ctx.fillStyle = b.enterable ? '#5a6470' : '#3a3f47';
      ctx.fillRect(mx - b.w * sx / 2, my - b.d * sz / 2, b.w * sx, b.d * sz);
      if (b.label) { ctx.fillStyle = '#cdd3e0'; ctx.fillText(b.label.slice(0, 14), mx, my - b.d * sz / 2 - 2); }
    }
    // points of interest
    for (const [k, l] of Object.entries(LOCATIONS)) {
      const [mx, my] = toMap(l.x, l.z);
      ctx.fillStyle = '#4cc9f0'; ctx.beginPath(); ctx.arc(mx, my, 2, 0, Math.PI * 2); ctx.fill();
    }
    // mission marker
    const mt = this.hooks.markerTarget?.();
    if (mt) { const [mx, my] = toMap(mt.x, mt.z); ctx.fillStyle = '#ffca3a'; ctx.font = '18px sans-serif'; ctx.fillText('★', mx, my + 5); }
    // player
    const p = this.hooks.playerPos?.();
    if (p) { const [mx, my] = toMap(p.x, p.z); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#000'; ctx.stroke(); }
  }
}
