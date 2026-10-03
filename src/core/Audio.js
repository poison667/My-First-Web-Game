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

  // =========================================================================
  // Continuous vehicle sources
  //
  // A one-shot per frame cannot sound like an engine, so driving gets real
  // sustained nodes: two detuned saws for the crank, a filtered noise bed for
  // induction/tyre roar, and a siren oscillator. They are created on demand
  // and parked at zero gain when idle rather than being rebuilt constantly.
  // =========================================================================

  _ensureEngineRig() {
    if (!this.ctx || this.engineRig) return this.engineRig;
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master);

    // body resonance keeps the saws from sounding like a buzzer
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 0.8;
    lp.connect(out);

    const oscA = ctx.createOscillator(); oscA.type = 'sawtooth';
    const oscB = ctx.createOscillator(); oscB.type = 'square';
    const gA = ctx.createGain(); gA.gain.value = 0.5;
    const gB = ctx.createGain(); gB.gain.value = 0.22;
    oscA.connect(gA); gA.connect(lp);
    oscB.connect(gB); gB.connect(lp);
    oscA.frequency.value = 60; oscB.frequency.value = 30;

    // tyre / wind bed
    const bufferSize = 2 * ctx.sampleRate;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer; noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.frequency.value = 480; nf.Q.value = 0.7;
    const ng = ctx.createGain(); ng.gain.value = 0;
    noise.connect(nf); nf.connect(ng); ng.connect(out);

    oscA.start(); oscB.start(); noise.start();
    this.engineRig = { out, lp, oscA, oscB, gA, gB, noise, nf, ng };
    return this.engineRig;
  }

  /**
   * Drive the engine loop.
   * @param {object} p {rpm01, load, speed01, electric, running, cylinders}
   */
  engineLoop(p = {}) {
    if (!this.ctx) return;
    const rig = this._ensureEngineRig();
    if (!rig) return;
    const now = this.ctx.currentTime;
    const smooth = (param, value, t = 0.08) => {
      param.cancelScheduledValues(now);
      param.setTargetAtTime(value, now, t);
    };

    if (!p.running) {
      smooth(rig.out.gain, 0, 0.12);
      smooth(rig.ng.gain, 0, 0.12);
      return;
    }
    const rpm01 = Math.max(0.05, Math.min(1.1, p.rpm01 || 0));
    const load = Math.max(0, Math.min(1, p.load || 0));
    const speed01 = Math.max(0, Math.min(1, p.speed01 || 0));

    if (p.electric) {
      // EVs whine: a high, clean tone that tracks road speed
      smooth(rig.oscA.frequency, 220 + speed01 * 1500, 0.06);
      smooth(rig.oscB.frequency, 440 + speed01 * 2600, 0.06);
      smooth(rig.gA.gain, 0.10, 0.1);
      smooth(rig.gB.gain, 0.04, 0.1);
      smooth(rig.lp.frequency, 2400 + speed01 * 3000, 0.1);
      smooth(rig.out.gain, (0.05 + load * 0.05) * this.settings.masterVolume, 0.1);
    } else {
      // firing frequency: revs * cylinders / 2
      const cylinders = p.cylinders || 4;
      const base = 11 + rpm01 * 78;
      smooth(rig.oscA.frequency, base * (cylinders / 4), 0.05);
      smooth(rig.oscB.frequency, base * 0.5 * (cylinders / 4), 0.05);
      smooth(rig.gA.gain, 0.34 + load * 0.3, 0.08);
      smooth(rig.gB.gain, 0.14 + load * 0.2, 0.08);
      smooth(rig.lp.frequency, 420 + rpm01 * 1700 + load * 700, 0.08);
      smooth(rig.out.gain, (0.08 + load * 0.07 + rpm01 * 0.03) * this.settings.masterVolume, 0.09);
    }
    smooth(rig.nf.frequency, 300 + speed01 * 1400, 0.1);
    smooth(rig.ng.gain, speed01 * 0.05 * this.settings.masterVolume, 0.12);
  }

  stopEngineLoop() {
    if (!this.engineRig || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.engineRig.out.gain.cancelScheduledValues(now);
    this.engineRig.out.gain.setTargetAtTime(0, now, 0.1);
    this.engineRig.ng.gain.setTargetAtTime(0, now, 0.1);
  }

  /** Two-tone emergency siren. kind: 'police' | 'ambulance' | 'fire'. */
  siren(on, kind = 'police') {
    if (!this.ctx) return;
    if (!this.sirenRig) {
      const ctx = this.ctx;
      const out = ctx.createGain(); out.gain.value = 0; out.connect(this.master);
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      const lfo = ctx.createOscillator(); lfo.type = 'triangle';
      const lfoGain = ctx.createGain();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 2.2;
      lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
      osc.connect(bp); bp.connect(out);
      osc.frequency.value = 700; lfo.frequency.value = 1.2; lfoGain.gain.value = 260;
      osc.start(); lfo.start();
      this.sirenRig = { out, osc, lfo, lfoGain, bp };
    }
    const rig = this.sirenRig;
    const now = this.ctx.currentTime;
    if (!on) { rig.out.gain.setTargetAtTime(0, now, 0.08); return; }
    const presets = {
      police: { f: 700, rate: 1.4, depth: 300, type: 'sawtooth' },
      ambulance: { f: 620, rate: 0.9, depth: 380, type: 'square' },
      fire: { f: 480, rate: 0.5, depth: 220, type: 'sawtooth' },
    };
    const k = presets[kind] || presets.police;
    rig.osc.type = k.type;
    rig.osc.frequency.setTargetAtTime(k.f, now, 0.05);
    rig.lfo.frequency.setTargetAtTime(k.rate, now, 0.05);
    rig.lfoGain.gain.setTargetAtTime(k.depth, now, 0.05);
    rig.out.gain.setTargetAtTime(0.07 * this.settings.masterVolume, now, 0.08);
  }

  /** Vehicle horn — pitch separates a hatchback from a seven-tonne truck. */
  horn(pitch = 1) {
    this.blip(330 * pitch, 0.4, 'square', 0.14);
    this.blip(415 * pitch, 0.4, 'sawtooth', 0.09);
  }

  /** Tyre squeal, scaled by how hard the tyres are being asked to work. */
  skid(amount = 1) {
    this.noise({ dur: 0.22 + amount * 0.2, vol: 0.05 + amount * 0.07, freq: 1100 + amount * 700, q: 5.5, sweep: -300 });
  }

  /** Metal-on-metal crunch for collisions. */
  crash(force = 1) {
    const f = Math.min(1, force);
    this.noise({ dur: 0.18 + f * 0.25, vol: 0.12 + f * 0.2, freq: 220 + f * 260, q: 0.6, sweep: -180 });
    this.blip(70 + f * 50, 0.16, 'square', 0.12 + f * 0.12);
  }

  /** Fuel pump click-and-whir. */
  refuel() {
    this.blip(880, 0.05, 'square', 0.1);
    this.noise({ dur: 0.5, vol: 0.04, freq: 400, q: 1.4, sweep: 60 });
  }
}
