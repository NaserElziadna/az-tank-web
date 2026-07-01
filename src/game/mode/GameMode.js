import { C } from '../../constants/GameConstants.js';
import { GameModeId, CollectibleType } from '../../models/enums.js';

/**
 * Game-mode strategy. A mode owns *only* the rules that differ between modes —
 * when a round/match ends, who wins, how points accrue, and the respawn policy.
 * The simulation, physics, AI, weapons and netcode are all mode-agnostic and
 * call into these hooks. All mode state lives on the round/match objects, so a
 * mode instance is effectively stateless (safe to share).
 *
 * The BASE class *is* Classic (last tank standing each round, first to N
 * round-wins) — reproducing the original engine's behaviour exactly — so other
 * modes need only override the handful of hooks that actually change.
 */
export class GameMode {
  get id() {
    return GameModeId.CLASSIC;
  }
  get name() {
    return 'Last Tank Standing';
  }
  get blurb() {
    return 'Be the last tank rolling each round. First to the target wins.';
  }

  /** Round wall-clock cap in seconds (0 = decided by elimination, not a timer). */
  get roundTimeLimit() {
    return 0;
  }
  /** Whether the "first to N" points selector applies (hidden for timed modes). */
  get usesPointsToWin() {
    return true;
  }
  get defaultPointsToWin() {
    return 5;
  }
  /** Team modes split slots into sides; the base game is a free-for-all. */
  get isTeam() {
    return false;
  }

  // ── round lifecycle ────────────────────────────────────────────────────────
  /** Called once when a fresh round's tanks are placed (before the countdown). */
  onRoundStart(_round) {}

  /**
   * A tank was just killed. Return nothing — mutate score here (frag modes) and
   * let {@link respawnFor} decide re-spawning. Classic scores per round, not per
   * kill, so the base does nothing.
   */
  onKill(_round, _victim, _killerSlot) {}

  /** Per-tick hook for modes that score over time (KotH) or watch a clock. */
  onTick(_round, _dt) {}

  /** A tank picked up a collectible (gold rush turns gold/diamonds into points). */
  onPickup(_round, _tank, _collectible) {}

  /**
   * Should a just-killed tank be queued to respawn? Return `{delay, shield}` or
   * null. Classic only respawns bots online (revive-bots), and only while a
   * genuine ≥2-human match still has a live human — so a bots-only duel can
   * never decide a human-vs-human round, and a solo game stays winnable.
   */
  respawnFor(round, tank) {
    if (round.reviveBots && round.humanCount >= 2 && !tank.player.isHuman && round.humansAlive > 0) {
      return { delay: C.FLOW.REVIVE_DELAY, shield: false };
    }
    return null;
  }

  /** Gate applied when a queued respawn comes due (re-checked at that moment). */
  allowRevive(round, _slot) {
    return round.humansAlive > 0;
  }

  /**
   * Decide whether the round is over. Return `{over, winnerSlot, allHumansDead}`
   * or null/`{over:false}`. This is the classic elimination rule: online is
   * player-vs-player, so a round resolves on human elimination (last human
   * alive wins); with <2 humans it's the classic last-tank-standing rule.
   */
  evaluateRound(round) {
    // A lone tank can't be resolved by the elimination rules, so end directly —
    // a match must never hang. Winner is the survivor, if any.
    if (round.tanks.length <= 1) {
      const s = round.tanks.find((t) => t.alive);
      return { over: true, winnerSlot: s ? s.slot : null };
    }
    const humanCount = round.humanCount;
    if (humanCount >= 2) {
      const alive = round.humansAlive;
      if (alive === 0) return { over: true, winnerSlot: null, allHumansDead: true };
      if (alive <= 1) {
        const s = round.tanks.find((t) => t.alive && t.player.isHuman);
        return { over: true, winnerSlot: s ? s.slot : null };
      }
      return null;
    }
    if (round.aliveCount <= 1 && round.tanks.length > 1) {
      const s = round.tanks.find((t) => t.alive);
      return { over: true, winnerSlot: s ? s.slot : null };
    }
    return null;
  }

  // ── match lifecycle ──────────────────────────────────────────────────────
  /** Award match points for a just-ended round. Classic: +1 to the round winner. */
  onRoundEnd(match, winnerSlot) {
    if (winnerSlot == null) return;
    match.score.award(winnerSlot);
    const w = match.players.find((p) => p.slot === winnerSlot);
    if (w) w.score = match.score.get(winnerSlot);
    match.bus.emit('score:changed', { slot: winnerSlot, score: match.score.get(winnerSlot) });
  }

  /** Is the whole match decided? Classic: someone reached the points target. */
  isMatchOver(match) {
    return match.score.winnerSlot != null;
  }

  matchWinnerSlot(match) {
    return match.score.winnerSlot;
  }

  /** Seconds left on the round clock for the HUD, or null when untimed. */
  timeRemaining(_match) {
    return null;
  }
}

/**
 * Shared base for the timed, always-active modes (deathmatch, KotH, gold rush):
 * a round clock, everyone respawns with brief spawn protection, and the top
 * scorer when the clock hits zero wins. The winner is locked the instant the
 * clock expires, so an in-flight bullet during the result screen can't flip it.
 */
class TimedMode extends GameMode {
  constructor({ duration = 120, respawnDelay = 2.0 } = {}) {
    super();
    this._duration = duration;
    this._respawnDelay = respawnDelay;
  }
  get roundTimeLimit() {
    return this._duration;
  }
  get usesPointsToWin() {
    return false;
  }
  respawnFor() {
    return { delay: this._respawnDelay, shield: true };
  }
  allowRevive() {
    return true;
  }
  evaluateRound(round) {
    if (round.playTime >= this._duration) {
      this._lockedWinner = topScoreSlot(round.tanks.map((t) => t.player));
      return { over: true, winnerSlot: this._lockedWinner };
    }
    return null;
  }
  onRoundEnd() {
    /* timed modes score continuously, not at round end */
  }
  isMatchOver() {
    return true; // a single timed round decides the match
  }
  matchWinnerSlot(match) {
    return this._lockedWinner !== undefined ? this._lockedWinner : topScoreSlot(match.players);
  }
  timeRemaining(match) {
    const t = match.round ? match.round.playTime : 0;
    return Math.max(0, this._duration - t);
  }
}

/**
 * Deathmatch — a timed frag-fest. A kill is +1, a suicide/self-ricochet is −1,
 * everyone respawns; most frags at the buzzer wins. Fixes "eliminated players
 * sit idle" and gives fast, always-active matches.
 */
export class DeathmatchMode extends TimedMode {
  get id() {
    return GameModeId.DEATHMATCH;
  }
  get name() {
    return 'Deathmatch';
  }
  get blurb() {
    return 'Most kills before the clock runs out. Respawn and keep fighting.';
  }
  onKill(round, victim, killerSlot) {
    const suicide = killerSlot == null || killerSlot === victim.slot;
    if (suicide) {
      victim.player.score = Math.max(0, (victim.player.score || 0) - 1);
    } else {
      const killer = round.getTank(killerSlot);
      if (killer && killer.player) killer.player.score = (killer.player.score || 0) + 1;
    }
  }
}

/**
 * King of the Hill — hold the central tile. Score ticks up (1/s) while you're
 * the *sole* tank on the hill; contested or empty = no score. Everyone respawns.
 */
export class KingMode extends TimedMode {
  constructor(opts = {}) {
    super({ duration: 90, ...opts });
  }
  get id() {
    return GameModeId.KING;
  }
  get name() {
    return 'King of the Hill';
  }
  get blurb() {
    return 'Hold the centre alone to score. Contested = frozen. Most time wins.';
  }
  onTick(round, dt) {
    const cx = round.maze.worldWidth / 2;
    const cy = round.maze.worldHeight / 2;
    const r2 = (C.MAZE.TILE_SIZE * 1.15) ** 2;
    let holder = null;
    let contested = false;
    for (const t of round.tanks) {
      if (!t.alive) continue;
      const dx = t.position.x - cx;
      const dy = t.position.y - cy;
      if (dx * dx + dy * dy <= r2) {
        if (holder === null) holder = t;
        else contested = true;
      }
    }
    if (holder && !contested) {
      holder._hillTime = (holder._hillTime || 0) + dt;
      holder.player.score = Math.floor(holder._hillTime); // integer seconds for the HUD
    }
  }
}

/**
 * Gold Rush — grab the most gold before time runs out. Wires the already-defined
 * gold/diamond collectibles into score (gold +1, diamond +3). Everyone respawns.
 */
export class GoldRushMode extends TimedMode {
  constructor(opts = {}) {
    super({ duration: 90, ...opts });
  }
  get id() {
    return GameModeId.GOLD_RUSH;
  }
  get name() {
    return 'Gold Rush';
  }
  get blurb() {
    return 'Collect the most gold before the buzzer — diamonds are worth more.';
  }
  onPickup(round, tank, c) {
    if (c.category === CollectibleType.GOLD) tank.player.score = (tank.player.score || 0) + 1;
    else if (c.category === CollectibleType.DIAMOND) tank.player.score = (tank.player.score || 0) + 3;
  }
}

/**
 * 2v2 Team — slots split into two teams (by parity), friendly fire off (your own
 * ricochet still bites), last team standing takes the round; first team to N.
 */
export class TeamMode extends GameMode {
  constructor({ pointsToWin = 5 } = {}) {
    super();
    this._pts = Math.max(1, pointsToWin || 5);
    this._teamWins = { 0: 0, 1: 0 };
  }
  get id() {
    return GameModeId.TEAM;
  }
  get name() {
    return '2v2 Team';
  }
  get blurb() {
    return 'Teams of two, no friendly fire. Last team standing wins the round.';
  }
  get isTeam() {
    return true;
  }
  get defaultPointsToWin() {
    return this._pts;
  }
  onRoundStart(round) {
    for (const t of round.tanks) t.player.team = t.slot % 2; // alternate seats → two sides
  }
  respawnFor() {
    return null; // last team standing — no respawns within a round
  }
  evaluateRound(round) {
    const teamsPresent = new Set(round.tanks.filter((t) => t.player.team != null).map((t) => t.player.team));
    if (teamsPresent.size < 2) return super.evaluateRound(round); // not actually 2 teams → FFA rule
    const aliveTeams = new Set();
    for (const t of round.tanks) if (t.alive && t.player.team != null) aliveTeams.add(t.player.team);
    if (aliveTeams.size <= 1) {
      const winTeam = aliveTeams.size === 1 ? [...aliveTeams][0] : null;
      this._lastWinTeam = winTeam;
      const rep = winTeam != null ? round.tanks.find((t) => t.player.team === winTeam) : null;
      return { over: true, winnerSlot: rep ? rep.slot : null, allHumansDead: winTeam == null };
    }
    return null;
  }
  onRoundEnd(match, _winnerSlot) {
    const team = this._lastWinTeam;
    if (team == null) return;
    this._teamWins[team] = (this._teamWins[team] || 0) + 1;
    // Show the shared team score on every member of that team.
    for (const p of match.players) if (p.team === team) p.score = this._teamWins[team];
    match.bus.emit('score:changed', { team, score: this._teamWins[team] });
  }
  isMatchOver() {
    return Math.max(this._teamWins[0] || 0, this._teamWins[1] || 0) >= this._pts;
  }
  matchWinnerSlot(match) {
    if (Math.max(this._teamWins[0] || 0, this._teamWins[1] || 0) < this._pts) return null;
    const team = (this._teamWins[0] || 0) >= (this._teamWins[1] || 0) ? 0 : 1;
    const p = match.players.find((pl) => pl.team === team);
    return p ? p.slot : null;
  }
}

/**
 * Co-op Waves — humans (who respawn) vs escalating waves of AI (who don't). Clear
 * a wave and a bigger, tougher one spawns. Score = waves survived; the round ends
 * when every human is down. The PvE pillar that keeps empty lobbies fun.
 */
export class CoopMode extends GameMode {
  constructor({ waveSize = 2 } = {}) {
    super();
    this._waveSize = waveSize;
    this._wave = 1;
  }
  get id() {
    return GameModeId.COOP;
  }
  get name() {
    return 'Co-op Waves';
  }
  get blurb() {
    return 'You (and friends) vs endless AI waves. Survive as long as you can.';
  }
  get usesPointsToWin() {
    return false;
  }
  onRoundStart() {
    this._wave = 1; // the initial roster of bots is wave 1
  }
  respawnFor(round, tank) {
    return tank.player.isHuman ? { delay: 2.0, shield: true } : null;
  }
  allowRevive(round, slot) {
    const t = round.getTank(slot);
    return !!t && t.player.isHuman;
  }
  onTick(round) {
    if (round.humanCount === 0 || round.humansAlive <= 0) return;
    const botsAlive = round.tanks.some((t) => t.alive && !t.player.isHuman);
    if (botsAlive) return;
    // Wave cleared — bank it on the humans, then spawn a bigger, tougher wave.
    for (const t of round.tanks) if (t.player.isHuman) t.player.score = this._wave;
    this._wave++;
    const count = this._waveSize + this._wave;
    const difficulty = this._wave >= 5 ? 'hard' : this._wave >= 3 ? 'medium' : 'easy';
    round.spawnWave(count, difficulty);
  }
  evaluateRound(round) {
    if (round.humanCount === 0) return super.evaluateRound(round); // no humans (e.g. tests) → FFA
    if (round.humansAlive === 0) return { over: true, winnerSlot: null, allHumansDead: true };
    return null;
  }
  onRoundEnd() {}
  isMatchOver() {
    return true; // survival is a single (long) round
  }
  matchWinnerSlot() {
    return null; // co-op has no PvP winner — the score is the waves survived
  }
}

/** Slot of the single highest scorer, or null if nobody scored / it's a tie. */
function topScoreSlot(players) {
  let best = null;
  let bestScore = 0;
  let tie = false;
  for (const p of players) {
    const s = p.score || 0;
    if (s > bestScore) {
      bestScore = s;
      best = p.slot;
      tie = false;
    } else if (s === bestScore && s > 0 && best != null && p.slot !== best) {
      tie = true;
    }
  }
  return tie ? null : best;
}

/** Modes available to build. */
const MODE_FACTORIES = {
  [GameModeId.CLASSIC]: () => new GameMode(),
  [GameModeId.DEATHMATCH]: (opts) => new DeathmatchMode(opts),
  [GameModeId.KING]: (opts) => new KingMode(opts),
  [GameModeId.GOLD_RUSH]: (opts) => new GoldRushMode(opts),
  [GameModeId.TEAM]: (opts) => new TeamMode(opts),
  [GameModeId.COOP]: (opts) => new CoopMode(opts),
};

/**
 * Build a mode strategy from an id (or pass through an existing instance).
 * Unknown ids fall back to Classic so a bad value can never brick a match.
 * @param {string|GameMode} idOrInstance
 */
export function createMode(idOrInstance, opts = {}) {
  if (idOrInstance && typeof idOrInstance === 'object' && typeof idOrInstance.evaluateRound === 'function') {
    return idOrInstance;
  }
  const make = MODE_FACTORIES[idOrInstance] || MODE_FACTORIES[GameModeId.CLASSIC];
  return make(opts);
}

/** Modes offered in the UI, in display order (with id/name/blurb metadata). */
export const MODE_MENU = [GameModeId.CLASSIC, GameModeId.DEATHMATCH, GameModeId.KING, GameModeId.GOLD_RUSH, GameModeId.TEAM, GameModeId.COOP].map((id) => {
  const m = createMode(id);
  return { id: m.id, name: m.name, blurb: m.blurb, usesPointsToWin: m.usesPointsToWin };
});
