import { log } from '../../core/log/Logger.js';

const blog = log.scope('balance');

/**
 * Weapon/game-balance telemetry. Subscribes once (per bus lifetime) to the sim's
 * gameplay events and writes structured lines into the unified log under the
 * `balance` scope, so a later pass can compute per-weapon win-contribution,
 * ricochet/self-kill rates, and pickup frequency — a diagnostic, not a decider.
 *
 * Attach one per bus (the App owns the client bus; a Room owns the server bus),
 * NOT per match — the events flow from whatever B2Match/B2Round runs on the bus,
 * and re-subscribing per match would duplicate every line.
 */
export class BalanceTelemetry {
  /** @param {import('../../core/events/EventBus.js').EventBus} bus */
  constructor(bus, { context = {} } = {}) {
    this._ctx = context; // e.g. { code } on the server
    this._unsub = [
      bus.on('round:created', (e) => blog.info('round_start', { ...this._ctx, round: e && e.round, mode: e && e.mode })),
      bus.on('round:ended', (e) => blog.info('round_end', { ...this._ctx, round: e && e.round, winnerSlot: e && e.winnerSlot, mode: e && e.mode })),
      bus.on('collectible:picked', (e) => blog.info('crate_pickup', { ...this._ctx, slot: e && e.slot, type: e && e.type, kind: e && e.kind })),
      bus.on('tank:destroyed', (e) => {
        if (!e) return;
        blog.info('kill', {
          ...this._ctx,
          victim: e.slot,
          killer: e.killerSlot ?? null,
          cause: e.cause || 'unknown',
          weaponKind: e.weaponKind || null,
          bounceCount: e.bounceCount || 0,
        });
        if (e.cause === 'self') blog.info('self_kill', { ...this._ctx, slot: e.slot, weaponKind: e.weaponKind || null });
      }),
    ];
  }

  dispose() {
    for (const off of this._unsub) off?.();
    this._unsub.length = 0;
  }
}
