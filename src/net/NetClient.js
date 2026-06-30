import { MSG } from './protocol.js';
import { log } from '../core/log/Logger.js';

const nlog = log.scope('net');

/**
 * Browser-side WebSocket wrapper for the AZ Tank game server.
 *
 * Owns the socket and exposes small intent-named send helpers plus an
 * `on(type, fn)` subscription for server messages. Connection URL defaults to
 * the page's host (so prod "just works" behind the same origin) and can be
 * overridden for local dev where Vite (5173) and the game server (8080) differ.
 */
export class NetClient {
  constructor(url = NetClient.defaultUrl()) {
    this.url = url;
    this.ws = null;
    this._handlers = new Map();
    this._open = false;
    /** Smoothed round-trip time in ms (null until first pong). */
    this.rtt = null;
    this._pingTimer = null;
  }

  static defaultUrl() {
    if (typeof window === 'undefined') return 'ws://localhost:8080/ws';
    const env = import.meta?.env?.VITE_WS_URL;
    if (env) return env;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    // Dev: Vite serves the client on a non-8080 port; talk to the game server.
    const host = window.location.port === '5173' ? `${window.location.hostname}:8080` : window.location.host;
    return `${proto}://${host}/ws`;
  }

  connect() {
    nlog.info('connecting', { url: this.url });
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
      } catch (e) {
        nlog.error('connect threw', e);
        return reject(e);
      }
      this.ws.onopen = () => {
        this._open = true;
        this._startPing();
        nlog.info('connected', { url: this.url });
        resolve();
      };
      this.ws.onerror = (e) => {
        nlog.error('socket error', { open: this._open, type: e && e.type });
        if (!this._open) reject(new Error('Could not connect to game server'));
        this._emit('netError', e);
      };
      this.ws.onclose = (e) => {
        this._open = false;
        this._stopPing();
        nlog.warn('socket closed', { code: e && e.code, reason: e && e.reason });
        this._emit('netClose');
      };
      this.ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.t === MSG.PONG && msg.time != null) {
          const sample = performance.now() - msg.time;
          this.rtt = this.rtt == null ? sample : this.rtt * 0.8 + sample * 0.2;
          return;
        }
        this._logIncoming(msg);
        this._emit(msg.t, msg);
      };
    });
  }

  /** Log incoming messages, throttling the high-frequency snapshot stream. */
  _logIncoming(msg) {
    if (msg.t === MSG.SNAPSHOT) {
      this._snapN = (this._snapN || 0) + 1;
      if (this._snapN === 1) nlog.info('first snapshot', { phase: msg.phase, tanks: msg.tanks?.length });
      else if (this._snapN % 100 === 0) nlog.debug('snapshots', { n: this._snapN });
      return;
    }
    nlog.info(`recv ${msg.t}`, msg.t === MSG.ROUND_START ? { round: msg.round } : msg.t === MSG.JOIN_RESULT ? { ok: msg.ok, slot: msg.slot } : undefined);
  }

  on(type, fn) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(fn);
    return () => this._handlers.get(type)?.delete(fn);
  }

  _emit(type, msg) {
    const set = this._handlers.get(type);
    if (set) for (const fn of set) fn(msg);
  }

  send(obj) {
    if (this._open && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  // ── intent-named helpers ───────────────────────────────────────────────────
  createRoom(name) {
    this.send({ t: MSG.CREATE_ROOM, name });
  }
  joinRoom(code, name) {
    this.send({ t: MSG.JOIN_ROOM, code, name });
  }
  startMatch() {
    this.send({ t: MSG.START_MATCH });
  }
  leaveRoom() {
    this.send({ t: MSG.LEAVE_ROOM });
  }
  sendInput(intent) {
    this.send({ t: MSG.INPUT, drive: intent.drive, turn: intent.turn, fire: intent.fire, ability: intent.ability });
  }

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => this.send({ t: MSG.PING, time: performance.now() }), 2000);
  }
  _stopPing() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = null;
  }

  close() {
    this._stopPing();
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}
