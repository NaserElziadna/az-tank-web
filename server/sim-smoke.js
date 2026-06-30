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
import { ControllerType, Difficulty } from '../src/models/enums.js';
import { colorForSlot } from '../src/rendering/Palette.js';
import { C } from '../src/constants/GameConstants.js';

const PLAYER_COUNT = 4; // exercise the max-player path
const SIM_SECONDS = 12;
const totalSteps = Math.ceil(SIM_SECONDS / C.STEP);

const bus = new EventBus();
let rounds = 0;
let kills = 0;
bus.on('round:created', ({ round }) => console.log(`  ▸ round:created #${round}`));
bus.on('round:start', () => console.log('  ▸ round:start'));
bus.on('round:decided', (e) => { rounds++; console.log('  ▸ round:decided', JSON.stringify(e ?? {})); });
bus.on('tank:destroyed', () => { kills++; });

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

console.log(`Booting headless B2Match with ${PLAYER_COUNT} AI bots…`);
const match = new B2Match(bus);
match.configure(players, { pointsToWin: 3 });
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
console.log(`rounds completed : ${rounds}`);
console.log(`tank kills       : ${kills}`);
console.log(`match over       : ${match.matchOver}  winner: ${match.matchWinner?.name ?? '—'}`);
console.log(match.matchOver || rounds > 0 ? '\n✅ Headless sim works.' : '\n⚠️  Sim ran but no round resolved — inspect.');
