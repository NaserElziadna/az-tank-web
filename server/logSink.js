/**
 * Node sink for the shared {@link Logger}: appends every entry (server's own
 * plus the browser batches forwarded via /log) to one readable file, so the
 * whole system's behaviour is in `logs/az-tank.log`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatEntry } from '../src/core/log/Logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LOG_DIR = path.join(__dirname, '..', 'logs');
export const LOG_FILE = path.join(LOG_DIR, 'az-tank.log');

let ready = false;

function ensureDir() {
  if (ready) return;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  ready = true;
}

/** Truncate the log at server boot so each run starts clean. */
export function resetLogFile() {
  ensureDir();
  fs.writeFileSync(LOG_FILE, '');
}

/**
 * A sink function for Logger.setSink(): file + stdout mirror. Uses a synchronous
 * append so the on-disk file is ALWAYS current — a buffered write stream (made
 * worse by OneDrive sync) can otherwise serve a stale/empty read when inspected
 * on demand, which defeats the purpose of the log.
 */
export function fileSink(entry) {
  const line = formatEntry(entry) + '\n';
  try {
    ensureDir();
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    /* ignore file errors */
  }
  process.stdout.write(line);
}
