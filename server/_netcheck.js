/**
 * Headless protocol smoke test (no browser). Connects two WS clients, creates +
 * joins a room, starts the match, streams a little input, and asserts that
 * roundStart + snapshots flow with sane contents. Throwaway — run while the
 * server is up: `node server/_netcheck.js`.
 */
import { WebSocket } from 'ws';
import { MSG } from '../src/net/protocol.js';

const URL = 'ws://localhost:8080/ws';
const log = (...a) => console.log(...a);
const seen = { host: {}, guest: {} };
let code = null;

function open(name) {
  const ws = new WebSocket(URL);
  ws.on('message', (raw) => onMsg(name, ws, JSON.parse(raw.toString())));
  ws.on('error', (e) => log(`${name} error`, e.message));
  return ws;
}

const host = open('host');
let guest = null;

host.on('open', () => {
  log('host connected → createRoom');
  host.send(JSON.stringify({ t: MSG.CREATE_ROOM, name: 'Host' }));
});

function onMsg(who, ws, msg) {
  seen[who][msg.t] = (seen[who][msg.t] || 0) + 1;
  if (msg.t === MSG.JOIN_RESULT && who === 'host') {
    code = msg.code;
    log(`host joined room ${code} slot=${msg.slot} host=${msg.isHost}`);
    guest = open('guest');
    guest.on('open', () => {
      log(`guest connected → joinRoom ${code}`);
      guest.send(JSON.stringify({ t: MSG.JOIN_ROOM, code, name: 'Guest' }));
    });
  }
  if (msg.t === MSG.JOIN_RESULT && who === 'guest') {
    log(`guest joined slot=${msg.slot} → host starts match in 300ms`);
    setTimeout(() => host.send(JSON.stringify({ t: MSG.START_MATCH })), 300);
  }
  if (msg.t === MSG.ROOM_STATE) log(`  roomState: ${msg.members.map((m) => `${m.name}#${m.slot}${m.isHost ? '*' : ''}`).join(', ')}`);
  if (msg.t === MSG.ROUND_START && who === 'host') {
    const tiles = msg.maze?.tiles;
    log(`  roundStart #${msg.round}: maze ${tiles?.length}x${tiles?.[0]?.length}, players=${msg.players.map((p) => `${p.name}/${p.isHuman ? 'H' : 'AI'}`).join(',')}`);
    // start feeding host input (drive forward + fire)
    let n = 0;
    const t = setInterval(() => {
      if (host.readyState !== 1 || n++ > 40) return clearInterval(t);
      host.send(JSON.stringify({ t: MSG.INPUT, drive: 1, turn: 1, fire: true, ability: false }));
    }, 50);
  }
  if (msg.t === MSG.SNAPSHOT && who === 'host' && seen.host[MSG.SNAPSHOT] === 5) {
    const t0 = msg.tanks[0];
    log(`  snapshot#5: phase=${msg.phase} tanks=${msg.tanks.length} alive=${msg.tanks.filter((t) => t.alive).length} proj=${msg.proj.length} t0=(${t0.x},${t0.y}) hp=${t0.hp}`);
  }
}

setTimeout(() => {
  log('\n─ message counts ─');
  log('host :', JSON.stringify(seen.host));
  log('guest:', JSON.stringify(seen.guest));
  const ok = seen.host[MSG.SNAPSHOT] > 10 && seen.host[MSG.ROUND_START] >= 1 && seen.guest[MSG.SNAPSHOT] > 10;
  log(ok ? '\n✅ Protocol flow works (both clients receive maze + snapshots).' : '\n⚠️  Flow incomplete — inspect.');
  process.exit(ok ? 0 : 1);
}, 4000);
