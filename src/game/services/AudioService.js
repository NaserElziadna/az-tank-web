/**
 * Procedural sound effects via the Web Audio API.
 *
 * No audio files are shipped — shots, bounces, explosions and pickups are
 * synthesised from oscillators and noise bursts. This keeps the project
 * asset-free while still giving punchy feedback. Subscribes to the
 * {@link EventBus} so gameplay code never calls the audio layer directly.
 */
export class AudioService {
  constructor() {
    /** @type {AudioContext|null} */
    this._ctx = null;
    this._master = null;
    this.enabled = true;
    this.volume = 0.5;
  }

  /** Lazily create the context on first user gesture (autoplay policy). */
  _ensure() {
    if (this._ctx) return this._ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    this._ctx = new Ctx();
    this._master = this._ctx.createGain();
    this._master.gain.value = this.volume;
    this._master.connect(this._ctx.destination);
    return this._ctx;
  }

  resume() {
    this._ensure();
    if (this._ctx?.state === 'suspended') this._ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this._master) this._master.gain.value = v;
  }

  /** Wire up gameplay events. @param {import('../../core/events/EventBus.js').EventBus} bus */
  bind(bus) {
    bus.on('weapon:fire', (e) => this.fire(e?.weapon));
    bus.on('projectile:bounce', () => this.bounce());
    bus.on('tank:destroyed', () => this.explosion());
    bus.on('collectible:picked', (e) => this.pickup(e?.type));
    bus.on('round:countdown:tick', () => this.beep(660, 0.06));
    bus.on('round:start', () => this.beep(990, 0.12));
  }

  // ── primitive synths ──────────────────────────────────────────────────────
  _tone({ freq = 440, type = 'sine', dur = 0.15, gain = 0.3, slideTo = null }) {
    if (!this.enabled) return;
    const ctx = this._ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this._master);
    osc.start(t);
    osc.stop(t + dur);
  }

  _noise({ dur = 0.25, gain = 0.4, lowpass = 1200 }) {
    if (!this.enabled) return;
    const ctx = this._ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const frames = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(lowpass, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this._master);
    src.start(t);
    src.stop(t + dur);
  }

  // ── named effects ─────────────────────────────────────────────────────────
  fire(weapon) {
    if (weapon === 'shotgun') this._noise({ dur: 0.18, gain: 0.35, lowpass: 2200 });
    else if (weapon === 'homing') this._tone({ freq: 520, type: 'sawtooth', dur: 0.22, slideTo: 240, gain: 0.22 });
    else this._tone({ freq: 320, type: 'square', dur: 0.1, slideTo: 160, gain: 0.22 });
  }

  bounce() {
    this._tone({ freq: 880, type: 'triangle', dur: 0.05, gain: 0.12 });
  }

  explosion() {
    this._noise({ dur: 0.45, gain: 0.5, lowpass: 900 });
    this._tone({ freq: 120, type: 'sine', dur: 0.4, slideTo: 40, gain: 0.3 });
  }

  pickup(type) {
    const base = type === 'diamond' ? 1320 : type === 'gold' ? 990 : 740;
    this._tone({ freq: base, type: 'triangle', dur: 0.12, gain: 0.25 });
    this._tone({ freq: base * 1.5, type: 'triangle', dur: 0.14, gain: 0.18 });
  }

  beep(freq, dur) {
    this._tone({ freq, type: 'square', dur, gain: 0.18 });
  }
}
