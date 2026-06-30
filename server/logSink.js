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

let stream = null;

function ensureStream() {
  if (stream) return stream;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  return stream;
}

/** Truncate the log at server boot so each run starts clean. */
export function resetLogFile() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, '');
  if (stream) {
    stream.end();
    stream = null;
  }
}

/** A sink function for Logger.setSink(): file + stdout mirror. */
export function fileSink(entry) {
  const line = formatEntry(entry);
  try {
    ensureStream().write(line + '\n');
  } catch {
    /* ignore file errors */
  }
  process.stdout.write(line + '\n');
}
