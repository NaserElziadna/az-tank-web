/**
 * Phase 0 smoke test — proves the simulation runs headless in Node.
 *
 * Imports the real B2Match (Box2D + maze + AI + weapons) with NO Phaser/DOM,
 * fills every slot with an AI bot, and steps the fixed-timestep loop for a few
 * seconds. If box2dweb boots in Node and a round actually progresses (tanks
 * move, the round resolves), the authoritative-server foundation is sound.
 *
 * Run: `node server/sim-smoke.js`
 */
import { EventBus } from '../src/core/events/EventBus.js';
import { B2Match } from '../src/phaser/B2Match.js';
import { Player } from '../src/models/Player.js';
import { ControllerType, Difficulty, GameModeId } from '../src/models/enums.js';
import { colorForSlot } from '../src/rendering/Palette.js';
import { createMode } from '../src/game/mode/GameMode.js';
import { BalanceTelemetry } from '../src/game/telemetry/BalanceTelemetry.js';
import { C } from '../src/constants/GameConstants.js';

// Optional CLI arg selects the mode: `node server/sim-smoke.js <mode>`.
const ARG = (process.argv[2] || 'classic').toLowerCase();
const MODE_IDS = { classic: 'classic', deathmatch: 'deathmatch', dm: 'deathmatch', king: 'king', koth: 'king', goldrush: 'goldRush', gold: 'goldRush', team: 'team', coop: 'coop' };
const modeId = MODE_IDS[ARG] || GameModeId.CLASSIC;
const isTimed = modeId === 'deathmatch' || modeId === 'king' || modeId === 'goldRush';
// Timed modes use a short clock so the timer-end path is exercised quickly.
const mode = isTimed ? createMode(modeId, { duration: 8, respawnDelay: 1.0 }) : modeId === 'team' ? createMode('team', { pointsToWin: 2 }) : createMode(modeId);

const PLAYER_COUNT = 4; // exercise the max-player path
const SIM_SECONDS = isTimed ? 16 : modeId === 'team' ? 24 : 14;
const totalSteps = Math.ceil(SIM_SECONDS / C.STEP);

const bus = new EventBus();
let rounds = 0;
let kills = 0;
let revives = 0;
bus.on('round:created', ({ round }) => console.log(`  ▸ round:created #${round}`));
bus.on('round:start', () => console.log('  ▸ round:start'));
bus.on('round:decided', (e) => { rounds++; console.log('  ▸ round:decided', JSON.stringify(e ?? {})); });
bus.on('tank:destroyed', () => { kills++; });
bus.on('tank:revived', () => { revives++; });
// Exercise the balance telemetry too (writes round_start/kill/pickup lines).
new BalanceTelemetry(bus);

const players = [];
for (let slot = 0; slot < PLAYER_COUNT; slot++) {
  players.push(
    new Player({
      slot,
      name: `BOT${slot}`,
      controller: ControllerType.AI,
      color: colorForSlot(slot),
      difficulty: Difficulty.HARD,
    }),
  );
}

console.log(`Booting headless B2Match with ${PLAYER_COUNT} AI bots (mode: ${mode.name})…`);
const match = new B2Match(bus);
match.configure(players, { pointsToWin: 3, mode });
match.start();
console.log('box2dweb booted OK; stepping the sim…\n');

let lastLog = 0;
for (let i = 0; i < totalSteps && !match.matchOver; i++) {
  match.update(C.STEP);
  const t = i * C.STEP;
  if (t - lastLog >= 2) {
    lastLog = t;
    const pos = match.round.tanks
      .filter((tk) => tk.alive)
      .map((tk) => `${tk.player.name}(${tk.position.x.toFixed(0)},${tk.position.y.toFixed(0)})`)
      .join('  ');
    console.log(`t=${t.toFixed(1)}s  phase=${match.phase}  alive: ${pos}`);
  }
}

console.log(`\n─ RESULT ─`);
console.log(`mode             : ${mode.name}`);
console.log(`rounds completed : ${rounds}`);
console.log(`tank kills       : ${kills}`);
console.log(`respawns         : ${revives}`);
console.log(`scores           : ${match.players.map((p) => `${p.name}=${p.score}`).join('  ')}`);
console.log(`match over       : ${match.matchOver}  winner: ${match.matchWinner?.name ?? '—'}`);
if (isTimed) {
  // Timed modes must end on the clock and respawn the fallen.
  const ok = match.matchOver && revives > 0;
  console.log(ok ? `\n✅ ${mode.name} works (timer ended it, tanks respawned, scored).` : `\n⚠️  ${mode.name} did not resolve as expected — inspect.`);
} else {
  console.log(match.matchOver || rounds > 0 ? `\n✅ ${mode.name} works.` : `\n⚠️  Sim ran but no round resolved — inspect.`);
}
