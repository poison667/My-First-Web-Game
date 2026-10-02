// Lightweight procedural audio using the Web Audio API — no external files.
// Generates ambient pad + UI blips + hit sounds so the game ships self-contained.
export class AudioManager {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.musicNodes = [];
    this.started = false;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.settings.masterVolume;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.settings.musicVolume * 0.25;
    this.musicGain.connect(this.master);
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setVolumes(master, music) {
    if (this.master) this.master.gain.value = master;
    if (this.musicGain) this.musicGain.gain.value = music * 0.25;
  }

  // Simple evolving ambient chord as background music.
  startMusic() {
    if (!this.ctx || this.started) return;
    this.started = true;
    const notes = [130.81, 164.81, 196.0, 246.94]; // Cmaj-ish
    notes.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = i % 2 ? 'sine' : 'triangle';
      osc.frequency.value = f;
      g.gain.value = 0.0;
      osc.connect(g); g.connect(this.musicGain);
      osc.start();
      // slow swell
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.frequency.value = 0.03 + i * 0.01;
      lfoGain.gain.value = 0.09;
      lfo.connect(lfoGain); lfoGain.connect(g.gain);
      g.gain.value = 0.09;
      lfo.start();
      this.musicNodes.push(osc, lfo);
    });
  }

  blip(freq = 660, dur = 0.08, type = 'square', vol = 0.25) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g); g.connect(this.master);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    o.stop(this.ctx.currentTime + dur);
  }

  // --- Noise burst used for footsteps, landings and gunshots ---------------
  _noiseBuffer() {
    if (this._noise) return this._noise;
    const len = Math.floor(this.ctx.sampleRate * 0.4);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  noise({ dur = 0.08, vol = 0.2, freq = 900, q = 1.1, type = 'bandpass', sweep = 0 } = {}) {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = this.ctx.createGain();
    const now = this.ctx.currentTime;
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    if (sweep) filt.frequency.exponentialRampToValueAtTime(Math.max(60, freq + sweep), now + dur);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  ui() { this.blip(720, 0.05, 'square', 0.15); }
  confirm() { this.blip(880, 0.09, 'square', 0.2); this.blip(1174, 0.09, 'square', 0.15); }
  hit() { this.blip(120, 0.12, 'sawtooth', 0.3); }
  hurt() { this.blip(90, 0.18, 'sawtooth', 0.35); }
  cash() { this.blip(988, 0.06, 'triangle', 0.2); this.blip(1318, 0.08, 'triangle', 0.2); }
  fail() { this.blip(200, 0.2, 'sawtooth', 0.25); this.blip(140, 0.25, 'sawtooth', 0.25); }
  jump() { this.noise({ dur: 0.09, vol: 0.09, freq: 420, q: 0.8 }); this.blip(520, 0.07, 'sine', 0.08); }

  // --- Player controller feedback -----------------------------------------
  footstep(intensity = 0.6, crouch = false) {
    const v = (crouch ? 0.045 : 0.1) * (0.6 + intensity * 0.7);
    this.noise({ dur: crouch ? 0.05 : 0.075, vol: v, freq: 320 + Math.random() * 180, q: 0.9, sweep: -180 });
  }
  land(hard = false) {
    this.noise({ dur: hard ? 0.22 : 0.12, vol: hard ? 0.3 : 0.15, freq: hard ? 180 : 280, q: 0.7, sweep: -140 });
    if (hard) this.blip(70, 0.18, 'sine', 0.22);
  }
  whoosh(power = 1) {
    this.noise({ dur: 0.16 * power, vol: 0.08 * power, freq: 1200, q: 0.6, sweep: -900 });
  }
  climb() { this.noise({ dur: 0.14, vol: 0.09, freq: 520, q: 0.8, sweep: -260 }); }
  shot(heavy = false) {
    this.noise({ dur: heavy ? 0.22 : 0.14, vol: heavy ? 0.4 : 0.3, freq: heavy ? 900 : 1500, q: 0.5, sweep: -1200 });
    this.blip(heavy ? 90 : 140, 0.08, 'square', 0.18);
  }
  slide() { this.noise({ dur: 0.3, vol: 0.09, freq: 700, q: 0.5, sweep: -400 }); }
  engine(speed01 = 0) {
    // short tick whose pitch rises with speed — called sparsely while driving
    this.blip(80 + speed01 * 160, 0.05, 'sawtooth', 0.05);
  }
}
