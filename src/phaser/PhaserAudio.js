import { Howl, Howler } from 'howler';
import { settings } from '../game/services/SettingsService.js';

/**
 * Sound via howler (the original's audio library). No audio files are shipped,
 * so short SFX (shot, bounce, explosion, pickup, beep) are synthesised into WAV
 * data-URIs at startup and loaded as Howls, then triggered off the event bus.
 */
export class PhaserAudio {
  /** @param {import('../core/events/EventBus.js').EventBus} bus */
  constructor(bus) {
    // Honour the stored preference from the first frame (the toggle/slider used
    // to do nothing — the classic "settings ignored" bug).
    this.enabled = settings.get('soundEnabled') !== false;
    this._volume = clampVol(settings.get('volume'));
    Howler.volume(this._volume);
    Howler.mute(!this.enabled);
    this.sounds = {
      shot: this._howl(synthShot(), 0.35),
      shotgun: this._howl(synthNoise(0.18, 2200), 0.4),
      laser: this._howl(synthLaser(), 0.35),
      rocket: this._howl(synthRocket(), 0.4),
      mine: this._howl(synthMine(), 0.3),
      gatling: this._howl(synthGatling(), 0.28),
      explosion: this._howl(synthExplosion(), 0.5),
      bounce: this._howl(synthTone(880, 0.05, 'triangle'), 0.18),
      thud: this._howl(synthThud(), 0.22),
      hit: this._howl(synthTone(420, 0.05, 'square'), 0.22),
      pickup: this._howl(synthPickup(), 0.3),
      ability: this._howl(synthAbility(), 0.35),
      beep: this._howl(synthTone(880, 0.1, 'square'), 0.25),
      go: this._howl(synthTone(990, 0.18, 'square'), 0.3),
    };
    // Distinct sound per weapon kind (falls back to the basic shot).
    const WEAPON_SFX = { shotgun: 'shotgun', laser: 'laser', homing: 'rocket', mine: 'mine', gatling: 'gatling' };
    this._unsub = [
      bus.on('weapon:fire', (e) => this.play(WEAPON_SFX[e?.weapon] || 'shot')),
      bus.on('ability:activate', () => this.play('ability')),
      bus.on('projectile:bounce', () => this.play('bounce')),
      bus.on('tank:bump', () => this.play('thud')),
      bus.on('tank:damaged', () => this.play('hit')),
      bus.on('tank:destroyed', () => this.play('explosion')),
      bus.on('mine:detonated', () => this.play('explosion')),
      bus.on('collectible:picked', () => this.play('pickup')),
      bus.on('round:countdown:tick', () => this.play('beep')),
      bus.on('round:start', () => this.play('go')),
    ];
  }

  _howl(dataUri, volume) {
    return new Howl({ src: [dataUri], volume, format: ['wav'] });
  }

  play(name) {
    if (!this.enabled) return;
    const s = this.sounds[name];
    if (s) s.play();
  }

  setEnabled(on) {
    this.enabled = !!on;
    Howler.mute(!this.enabled);
  }

  /** Master volume 0..1 (independent of the enable toggle). */
  setVolume(v) {
    this._volume = clampVol(v);
    Howler.volume(this._volume);
  }

  /** Resume a suspended WebAudio context (mobile browsers gate audio behind a
   *  first user gesture). Safe to call repeatedly / when already running. */
  unlock() {
    try {
      const ctx = Howler.ctx;
      if (ctx && ctx.state === 'suspended') ctx.resume();
    } catch {
      /* ignore — audio just stays silent until the next gesture */
    }
  }

  dispose() {
    for (const off of this._unsub) off();
    for (const k in this.sounds) this.sounds[k].unload();
  }
}

/** Clamp a stored/UI volume to a valid 0..1 gain, defaulting to 0.5. */
function clampVol(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

// ── tiny WAV synthesiser ────────────────────────────────────────────────────
const RATE = 22050;

function toWav(samples) {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, v * 32767, true);
  }
  return 'data:audio/wav;base64,' + bytesToBase64(new Uint8Array(buffer));
}

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function envelope(i, n, attack = 0.01) {
  const t = i / n;
  const a = Math.min(1, t / attack);
  return a * (1 - t);
}

function synthTone(freq, dur, type = 'sine') {
  const n = Math.floor(RATE * dur);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ph = (i / RATE) * freq * 2 * Math.PI;
    let v = Math.sin(ph);
    if (type === 'square') v = Math.sign(v);
    else if (type === 'triangle') v = (2 / Math.PI) * Math.asin(Math.sin(ph));
    s[i] = v * 0.5 * envelope(i, n);
  }
  return toWav(s);
}

function synthShot() {
  const dur = 0.12;
  const n = Math.floor(RATE * dur);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const freq = 320 - 200 * (t / dur);
    s[i] = Math.sign(Math.sin(t * freq * 2 * Math.PI)) * 0.4 * envelope(i, n);
  }
  return toWav(s);
}

function synthNoise(dur, lowpass) {
  const n = Math.floor(RATE * dur);
  const s = new Float32Array(n);
  let prev = 0;
  const a = lowpass / RATE;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    prev = prev + a * (white - prev); // crude low-pass
    s[i] = prev * 0.6 * envelope(i, n);
  }
  return toWav(s);
}

function synthExplosion() {
  const dur = 0.45;
  const n = Math.floor(RATE * dur);
  const s = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const white = Math.random() * 2 - 1;
    prev = prev + 0.05 * (white - prev);
    const low = Math.sin(t * (120 - 80 * (t / dur)) * 2 * Math.PI);
    s[i] = (prev * 0.6 + low * 0.4) * envelope(i, n, 0.005);
  }
  return toWav(s);
}

function synthThud() {
  // Short, dull low-frequency knock for wall bumps.
  const dur = 0.1;
  const n = Math.floor(RATE * dur);
  const s = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const white = Math.random() * 2 - 1;
    prev = prev + 0.08 * (white - prev); // low-passed click
    const low = Math.sin(t * (140 - 90 * (t / dur)) * 2 * Math.PI);
    s[i] = (low * 0.7 + prev * 0.3) * envelope(i, n, 0.004);
  }
  return toWav(s);
}

function synthLaser() {
  // High, bright zap with a quick downward sweep.
  const dur = 0.18;
  const n = Math.floor(RATE * dur);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const freq = 1400 - 900 * (t / dur);
    s[i] = Math.sin(t * freq * 2 * Math.PI) * 0.5 * envelope(i, n, 0.005);
  }
  return toWav(s);
}

function synthRocket() {
  // Whoosh: rising filtered noise + low body.
  const dur = 0.35;
  const n = Math.floor(RATE * dur);
  const s = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const white = Math.random() * 2 - 1;
    const a = (0.02 + 0.12 * (t / dur)); // opening filter → whoosh
    prev = prev + a * (white - prev);
    const low = Math.sin(t * 90 * 2 * Math.PI);
    s[i] = (prev * 0.6 + low * 0.3) * envelope(i, n, 0.02);
  }
  return toWav(s);
}

function synthMine() {
  // Two short arming clicks.
  const dur = 0.14;
  const n = Math.floor(RATE * dur);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const click = (t < 0.02 || (t > 0.07 && t < 0.09)) ? 1 : 0;
    s[i] = Math.sin(t * 1200 * 2 * Math.PI) * 0.5 * click;
  }
  return toWav(s);
}

function synthGatling() {
  // Dry low tick for each round.
  const dur = 0.05;
  const n = Math.floor(RATE * dur);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    s[i] = (Math.random() * 2 - 1) * 0.4 * envelope(i, n, 0.003) + Math.sin(t * 180 * 2 * Math.PI) * 0.2 * envelope(i, n);
  }
  return toWav(s);
}

function synthAbility() {
  // Rising two-tone power-up chime.
  const dur = 0.22;
  const n = Math.floor(RATE * dur);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const freq = t < dur / 2 ? 600 : 900;
    s[i] = Math.sin(t * freq * 2 * Math.PI) * 0.45 * envelope(i, n, 0.01);
  }
  return toWav(s);
}

function synthPickup() {
  const dur = 0.16;
  const n = Math.floor(RATE * dur);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const freq = t < dur / 2 ? 740 : 1110;
    s[i] = Math.sin(t * freq * 2 * Math.PI) * 0.4 * envelope(i, n);
  }
  return toWav(s);
}
