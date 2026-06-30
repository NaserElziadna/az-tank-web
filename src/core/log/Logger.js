/**
 * Unified logger for both the browser client and the Node server.
 *
 * The point: one place to read everything. In the browser, entries are mirrored
 * to the console AND shipped (batched) to the server's `/log` endpoint; on the
 * server they're written to `logs/az-tank.log`. So a single file captures the
 * whole system — no need to open devtools to see what the client did.
 *
 * Usage:
 *   import { log } from '.../Logger.js';
 *   const net = log.scope('net');
 *   net.info('connected', { url });
 *   net.debug('snapshot', { n });   // high-frequency → debug
 *   net.error('send failed', err);  // Errors are unwrapped to {message, stack}
 *
 * The server swaps in a file sink via `log.setSink(...)`; the browser keeps the
 * default console+ship sink. Keep this module free of Node/DOM-only imports so
 * it bundles cleanly for the browser.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

/** Normalise the optional data arg so Errors survive JSON serialisation. */
function normalizeData(data) {
  if (data == null) return undefined;
  if (data instanceof Error) return { message: data.message, stack: data.stack, name: data.name };
  if (typeof data !== 'object') return { value: data };
  // Shallow-copy and unwrap any nested Error fields.
  const out = {};
  for (const [k, v] of Object.entries(data)) out[k] = v instanceof Error ? { message: v.message, stack: v.stack } : v;
  return out;
}

/** A formatted one-line representation used by both console and file output. */
export function formatEntry(e) {
  const t = e.t.slice(11, 23); // HH:MM:SS.mmm
  const tag = `${e.src}/${e.scope}`;
  let line = `${t} ${e.lvl.toUpperCase().padEnd(5)} [${tag}] ${e.msg}`;
  if (e.data !== undefined) {
    let d;
    try {
      d = JSON.stringify(e.data);
    } catch {
      d = String(e.data);
    }
    line += `  ${d}`;
  }
  return line;
}

class BrowserShipper {
  constructor() {
    this.queue = [];
    this.timer = null;
    this.url = httpBase() + '/log';
    if (isBrowser) {
      window.addEventListener('pagehide', () => this.flush(true));
      window.addEventListener('beforeunload', () => this.flush(true));
    }
  }

  push(entry) {
    this.queue.push(entry);
    if (entry.lvl === 'error' || this.queue.length >= 25) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), 800);
  }

  flush(useBeacon = false) {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.queue.length) return;
    const batch = this.queue;
    this.queue = [];
    const body = JSON.stringify(batch);
    try {
      // text/plain keeps it a CORS "simple request" (no preflight) for dev,
      // where the client (5173) and server (8080) differ in origin.
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(this.url, body);
      } else {
        fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: true }).catch(() => {});
      }
    } catch {
      /* logging must never throw into the app */
    }
  }
}

function httpBase() {
  if (!isBrowser) return '';
  // Dev: Vite serves the client on 5173; the game server is on 8080.
  if (window.location.port === '5173') return `${window.location.protocol}//${window.location.hostname}:8080`;
  return ''; // prod: same origin
}

/** Default sink: console always, plus ship-to-server in the browser. */
function makeDefaultSink() {
  const shipper = isBrowser ? new BrowserShipper() : null;
  return (entry) => {
    const line = formatEntry(entry);
    const fn = entry.lvl === 'error' ? console.error : entry.lvl === 'warn' ? console.warn : console.log;
    fn(line);
    if (shipper) shipper.push(entry);
  };
}

export class Logger {
  constructor({ scope = 'app', src = isBrowser ? 'client' : 'server', sink = makeDefaultSink(), minLevel = 'debug' } = {}) {
    this._scope = scope;
    this._src = src;
    this._sink = sink;
    this._min = LEVELS[minLevel] ?? 10;
  }

  /** Child logger with a different scope, sharing this logger's sink/level. */
  scope(name) {
    const child = new Logger({ scope: name, src: this._src, sink: this._sink, minLevel: 'debug' });
    child._min = this._min;
    child._shared = this;
    return child;
  }

  setSink(sink) {
    this._sink = sink;
  }
  setMinLevel(name) {
    this._min = LEVELS[name] ?? this._min;
  }

  _log(lvl, msg, data) {
    if (LEVELS[lvl] < this._effectiveMin()) return;
    const entry = { t: new Date().toISOString(), lvl, src: this._src, scope: this._scope, msg: String(msg), data: normalizeData(data) };
    try {
      this._effectiveSink()(entry);
    } catch {
      /* never let logging crash the caller */
    }
  }

  // Children defer to the root so setSink/setMinLevel on the root affect all.
  _effectiveSink() {
    return this._shared ? this._shared._sink : this._sink;
  }
  _effectiveMin() {
    return this._shared ? this._shared._min : this._min;
  }

  debug(msg, data) {
    this._log('debug', msg, data);
  }
  info(msg, data) {
    this._log('info', msg, data);
  }
  warn(msg, data) {
    this._log('warn', msg, data);
  }
  error(msg, data) {
    this._log('error', msg, data);
  }

  /** Ingest a pre-built entry (used by the server to write client batches). */
  raw(entry) {
    try {
      this._effectiveSink()(entry);
    } catch {
      /* ignore */
    }
  }
}

/** Process-wide root logger. Import this everywhere. */
export const log = new Logger();
