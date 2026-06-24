import { Howl, Howler } from 'howler';

/**
 * Sound via howler (the original's audio library). No audio files are shipped,
 * so short SFX (shot, bounce, explosion, pickup, beep) are synthesised into WAV
 * data-URIs at startup and loaded as Howls, then triggered off the event bus.
 */
export class PhaserAudio {
  /** @param {import('../core/events/EventBus.js').EventBus} bus */
  constructor(bus) {
    this.enabled = true;
    Howler.volume(0.5);
    this.sounds = {
      shot: this._howl(synthShot(), 0.35),
      shotgun: this._howl(synthNoise(0.18, 2200), 0.4),
      explosion: this._howl(synthExplosion(), 0.5),
      bounce: this._howl(synthTone(880, 0.05, 'triangle'), 0.18),
      thud: this._howl(synthThud(), 0.22),
      pickup: this._howl(synthPickup(), 0.3),
      beep: this._howl(synthTone(880, 0.1, 'square'), 0.25),
      go: this._howl(synthTone(990, 0.18, 'square'), 0.3),
    };
    this._unsub = [
      bus.on('weapon:fire', (e) => this.play(e?.weapon === 'shotgun' ? 'shotgun' : 'shot')),
      bus.on('projectile:bounce', () => this.play('bounce')),
      bus.on('tank:bump', () => this.play('thud')),
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
    this.enabled = on;
    Howler.mute(!on);
  }

  dispose() {
    for (const off of this._unsub) off();
    for (const k in this.sounds) this.sounds[k].unload();
  }
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
