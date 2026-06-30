/**
 * Shared network protocol for online multiplayer.
 *
 * Imported by BOTH the browser client and the Node game server, so it must stay
 * pure (no DOM, no Node APIs, no Phaser). v1 uses plain JSON messages — the
 * payloads for 2–4 tanks are tiny, so binary packing is a later optimisation.
 */

import { C } from '../constants/GameConstants.js';

export const PROTOCOL_VERSION = 1;

/** Message types. Client→Server and Server→Client share one flat namespace. */
export const MSG = Object.freeze({
  // client → server
  CREATE_ROOM: 'createRoom',
  JOIN_ROOM: 'joinRoom',
  LEAVE_ROOM: 'leaveRoom',
  START_MATCH: 'startMatch',
  SET_FILL_BOTS: 'setFillBots', // host toggles AI filling empty seats (lobby + in-game)
  INPUT: 'input',
  PING: 'ping',
  // server → client
  ROOM_STATE: 'roomState', // lobby roster changed
  JOIN_RESULT: 'joinResult', // ok/err + your slot + room code
  ROUND_START: 'roundStart', // new maze (tiles) + player meta
  SNAPSHOT: 'snapshot', // per-frame authoritative state
  EVENT: 'event', // discrete one-shot (kill, pickup, …) — Phase 2
  MATCH_OVER: 'matchOver',
  PONG: 'pong',
  ERROR: 'error',
});

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 ambiguity

/** @param {() => number} rand 0..1 source (injectable so the server controls it) */
export function genRoomCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
  return s;
}

/** Serialise just what the client needs to rebuild the maze: the tile grid. */
export function serializeMaze(maze) {
  return { tiles: maze.tiles };
}

/**
 * Build a per-frame authoritative snapshot from a live server-side B2Match.
 * Positions are absolute (metres); the client interpolates between snapshots.
 */
export function buildSnapshot(match) {
  const round = match.sim;
  const tanks = round
    ? round.tanks.map((t) => ({
        slot: t.slot,
        x: round_num(t.position.x),
        y: round_num(t.position.y),
        rot: round_num(t.rotation),
        alive: t.alive,
        hp: t.hp,
        maxHp: t.maxHp,
        color: t.colorKey,
        lethal: t.lethal,
        phasing: t.phasing,
        recon: t.reconTimer > 0,
        shieldRatio: t.shield ? t.shield.time / C.UPGRADES.SHIELD.lifetime : null,
        wType: t.activeWeapon ? t.activeWeapon.type : 'normal',
        wLabel: t.activeWeapon && t.activeWeapon.hudLabel ? t.activeWeapon.hudLabel() : '',
        ability: t.ability || null,
        abilityActive: !!t.abilityActive,
      }))
    : [];
  const proj = round
    ? round.projectiles.filter((p) => !p.dead).map((p) => ({ id: p.id, x: round_num(p.position.x), y: round_num(p.position.y), rot: round_num(p.rotation), kind: p.kind, color: p.colorKey }))
    : [];
  const mines = round
    ? round.mines.filter((m) => !m.dead).map((m) => ({ id: m.id, x: round_num(m.position.x), y: round_num(m.position.y), state: m.state, color: m.colorKey }))
    : [];
  const cols = round
    ? round.collectibles.filter((c) => !c.dead).map((c) => ({ id: c.id, x: round_num(c.position.x), y: round_num(c.position.y), cat: c.category, kind: c.kind, rot: round_num(c.rotation), anim: round_num(c.spawnAnim) }))
    : [];
  const beams = round ? round.beams.map((b) => ({ points: b.points, life: b.life, max: b.max, color: b.colorKey, mega: !!b.mega })) : [];

  return {
    t: MSG.SNAPSHOT,
    phase: match.phase,
    cd: match.countdownValue,
    go: match.showGo,
    rn: match.roundNumber,
    mo: match.matchOver,
    mw: match.matchWinner ? match.matchWinner.slot : null,
    rr: match.roundResult ? match.roundResult.winnerSlot : null,
    players: match.players.map((p) => ({ slot: p.slot, name: p.name, isHuman: p.isHuman, score: p.score, color: p.color })),
    tanks,
    proj,
    mines,
    cols,
    beams,
  };
}

function round_num(n) {
  // 0.01m precision keeps JSON compact without visible snapping after interpolation.
  return Math.round(n * 100) / 100;
}
