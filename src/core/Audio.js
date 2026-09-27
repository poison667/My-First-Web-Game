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

  ui() { this.blip(720, 0.05, 'square', 0.15); }
  confirm() { this.blip(880, 0.09, 'square', 0.2); this.blip(1174, 0.09, 'square', 0.15); }
  hit() { this.blip(120, 0.12, 'sawtooth', 0.3); }
  hurt() { this.blip(90, 0.18, 'sawtooth', 0.35); }
  cash() { this.blip(988, 0.06, 'triangle', 0.2); this.blip(1318, 0.08, 'triangle', 0.2); }
  fail() { this.blip(200, 0.2, 'sawtooth', 0.25); this.blip(140, 0.25, 'sawtooth', 0.25); }
  jump() { this.blip(520, 0.08, 'sine', 0.15); }
}
