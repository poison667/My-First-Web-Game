// ---------------------------------------------------------------------------
// Input layer: keyboard + mouse (pointer lock) + gamepad, mapped through named
// actions so the controller never talks to raw key codes.
//
//   input.down('sprint')      held this frame
//   input.pressed('jump')     rising edge (consumed on read)
//   input.released('aim')     falling edge
//   input.move                analog move vector  {x, z} (length <= 1)
//   input.look                accumulated look delta {dx, dy} (mouse + stick)
// ---------------------------------------------------------------------------

export const DEFAULT_BINDINGS = {
  forward:      ['KeyW', 'ArrowUp'],
  back:         ['KeyS', 'ArrowDown'],
  left:         ['KeyA', 'ArrowLeft'],
  right:        ['KeyD', 'ArrowRight'],
  sprint:       ['ShiftLeft', 'ShiftRight'],
  walk:         ['AltLeft', 'AltRight'],
  crouch:       ['ControlLeft', 'ControlRight'],
  crouchToggle: ['KeyC'],
  jump:         ['Space'],
  interact:     ['KeyE'],
  melee:        ['KeyF'],
  attack:       ['Mouse0'],
  aim:          ['Mouse2'],
  reload:       ['KeyR'],
  holster:      ['KeyG'],
  vehicle:      ['KeyV'],
  shoulder:     ['KeyQ'],
  menu:         ['Tab'],
  map:          ['KeyM'],
  pause:        ['Escape'],
};

const DEADZONE = 0.18;

export class Input {
  constructor(canvas, settings = {}) {
    this.canvas = canvas;
    this.settings = settings;
    this.bindings = { ...DEFAULT_BINDINGS };

    this.keys = {};           // code -> bool (keyboard + MouseN)
    this._pressed = {};       // rising edges this frame
    this._released = {};      // falling edges this frame
    this.mouse = { dx: 0, dy: 0, wheel: 0, buttons: [false, false, false] };
    this.locked = false;
    this.enabled = true;

    this.move = { x: 0, z: 0 };
    this.moveMagnitude = 0;
    this.look = { dx: 0, dy: 0 };
    this.pad = null;
    this.usingGamepad = false;
    this._padPrev = {};
    this._dt = 0.016;

    this.trapKeys = new Set(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyM', 'KeyV', 'KeyC', 'KeyG', 'KeyQ', 'KeyR',
      'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft']);

    this._bindDom();
  }

  _bindDom() {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e) => {
      if (this.trapKeys.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys[e.code] = true;
      this._pressed[e.code] = true;
      this.usingGamepad = false;
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      this._released[e.code] = true;
    });
    window.addEventListener('blur', () => {
      this.keys = {};
      this.mouse.buttons = [false, false, false];
    });

    const c = this.canvas;
    if (!c) return;
    c.addEventListener('click', () => { if (this.enabled && !this.locked) c.requestPointerLock?.(); });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === c;
      if (!this.locked) {
        this.mouse.buttons = [false, false, false];
        this.keys['Mouse0'] = this.keys['Mouse1'] = this.keys['Mouse2'] = false;
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
      this.usingGamepad = false;
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      e.preventDefault();
      const code = 'Mouse' + e.button;
      if (!this.keys[code]) this._pressed[code] = true;
      this.keys[code] = true;
      this.mouse.buttons[e.button] = true;
    });
    window.addEventListener('mouseup', (e) => {
      const code = 'Mouse' + e.button;
      this.keys[code] = false;
      this._released[code] = true;
      this.mouse.buttons[e.button] = false;
    });
    window.addEventListener('wheel', (e) => {
      if (this.locked) { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }
    }, { passive: false });
    window.addEventListener('gamepadconnected', () => { this.usingGamepad = true; });
    window.addEventListener('gamepaddisconnected', () => { this.pad = null; this.usingGamepad = false; });
  }

  // -------------------------------------------------------------------------
  // Frame lifecycle
  // -------------------------------------------------------------------------

  /** Call once per frame, before reading state. */
  update(dt = 0.016) {
    this._dt = dt;
    this._pollGamepad();
    this._buildMove();
    this._buildLook();
  }

  /** Call at the very end of the frame to clear edge events. */
  endFrame() {
    this._pressed = {};
    this._released = {};
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    if (this.pad) this.pad.pressed = {};
  }

  // -------------------------------------------------------------------------
  // Action queries
  // -------------------------------------------------------------------------

  down(action) {
    const codes = this.bindings[action];
    if (!codes) return !!this.keys[action];                 // raw code fallback
    for (const c of codes) if (this.keys[c]) return true;
    return !!(this.pad && this.pad.down[action]);
  }

  /** Rising edge. Consumed so each press is handled exactly once. */
  pressed(action) {
    const codes = this.bindings[action];
    if (!codes) return this.pressedCode(action);
    let hit = false;
    for (const c of codes) if (this._pressed[c]) { this._pressed[c] = false; hit = true; }
    if (!hit && this.pad && this.pad.pressed[action]) { this.pad.pressed[action] = false; hit = true; }
    return hit;
  }

  released(action) {
    const codes = this.bindings[action];
    if (!codes) return !!this._released[action];
    for (const c of codes) if (this._released[c]) return true;
    return false;
  }

  /** Rising edge for a raw key code (used by menus). */
  pressedCode(code) {
    if (this._pressed[code]) { this._pressed[code] = false; return true; }
    return false;
  }

  // Legacy helpers kept for older systems
  once(code) { return this.pressedCode(code); }
  keyDown(code) { return !!this.keys[code]; }

  // -------------------------------------------------------------------------
  // Derived input
  // -------------------------------------------------------------------------

  _buildMove() {
    let x = 0, z = 0;
    if (this.down('forward')) z -= 1;
    if (this.down('back')) z += 1;
    if (this.down('left')) x -= 1;
    if (this.down('right')) x += 1;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    if (this.pad && (this.pad.moveX !== 0 || this.pad.moveZ !== 0)) {
      x = this.pad.moveX; z = this.pad.moveZ;
      const l = Math.hypot(x, z);
      if (l > 1) { x /= l; z /= l; }
    }
    this.move.x = x; this.move.z = z;
    this.moveMagnitude = Math.min(1, Math.hypot(x, z));
  }

  _buildLook() {
    this.look.dx = this.mouse.dx;
    this.look.dy = this.mouse.dy;
    if (this.pad) {
      // Stick look is frame-rate independent, scaled to feel like mouse pixels.
      const curve = (v) => v * Math.abs(v);   // finer control near centre
      this.look.dx += curve(this.pad.lookX) * 900 * this._dt;
      this.look.dy += curve(this.pad.lookY) * 700 * this._dt;
    }
  }

  _pollGamepad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) { this.pad = null; return; }
    let gp = null;
    const pads = navigator.getGamepads();
    for (const p of pads) { if (p && p.connected) { gp = p; break; } }
    if (!gp) { this.pad = null; return; }

    const dz = (v) => (Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE));
    const btn = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const axis = (i) => dz(gp.axes[i] || 0);
    const trig = (i) => (gp.buttons[i] ? gp.buttons[i].value > 0.35 : false);

    // Xbox-style layout. Every action gets its own button so nothing
    // double-fires (Start must not open and close the menu in one frame).
    const downMap = {
      jump: btn(0),                 // A
      crouch: btn(1),               // B
      melee: btn(2),                // X
      interact: btn(3),             // Y
      holster: btn(4),              // LB  draw / stow firearm
      vehicle: btn(5),              // RB  enter / exit vehicle
      aim: trig(6) || btn(6),       // LT
      attack: trig(7) || btn(7),    // RT
      map: btn(8),                  // Back
      menu: btn(9),                 // Start
      sprint: btn(10),              // L3
      shoulder: btn(11),            // R3
      walk: btn(13),                // D-pad down
      reload: btn(14),              // D-pad left
      crouchToggle: btn(12),        // D-pad up
      pause: false,                 // keyboard only; Start already opens the menu
    };
    const prev = this._padPrev;
    const pressedMap = {};
    for (const k of Object.keys(downMap)) pressedMap[k] = downMap[k] && !prev[k];
    this._padPrev = downMap;

    this.pad = { moveX: axis(0), moveZ: axis(1), lookX: axis(2), lookY: axis(3), down: downMap, pressed: pressedMap };
    if (this.pad.moveX || this.pad.moveZ || this.pad.lookX || this.pad.lookY ||
        Object.values(downMap).some(Boolean)) this.usingGamepad = true;
  }

  consumeWheel() { const w = this.mouse.wheel; this.mouse.wheel = 0; return w; }

  unlock() { if (typeof document !== 'undefined') document.exitPointerLock?.(); }
  lock() { if (this.enabled) this.canvas?.requestPointerLock?.(); }
}
