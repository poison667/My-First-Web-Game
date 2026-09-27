// Keyboard + mouse input with pointer lock for third-person camera control.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = {};
    this.pressed = {};      // one-shot this frame
    this.mouse = { dx: 0, dy: 0, down: false, wheel: 0 };
    this.locked = false;
    this.enabled = true;

    this.trapKeys = new Set(['Tab','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
      'KeyW','KeyA','KeyS','KeyD','KeyE','KeyF','KeyM','KeyV']);
    window.addEventListener('keydown', (e) => {
      if (this.trapKeys.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      const k = e.code;
      this.keys[k] = true;
      this.pressed[k] = true;
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    canvas.addEventListener('click', () => {
      if (this.enabled && !this.locked) canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (this.locked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    window.addEventListener('mousedown', (e) => { if (this.locked && e.button === 0) this.mouse.down = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.down = false; });
    window.addEventListener('wheel', (e) => { if (this.locked) this.mouse.wheel += Math.sign(e.deltaY); });
  }

  down(code) { return !!this.keys[code]; }
  once(code) { if (this.pressed[code]) { this.pressed[code] = false; return true; } return false; }

  // movement axis from WASD
  moveVector() {
    let x = 0, z = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) z -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) z += 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) x -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) x += 1;
    return { x, z };
  }

  consumeMouse() {
    const m = { dx: this.mouse.dx, dy: this.mouse.dy, wheel: this.mouse.wheel, down: this.mouse.down };
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    return m;
  }

  endFrame() { this.pressed = {}; }
  unlock() { document.exitPointerLock?.(); }
}
