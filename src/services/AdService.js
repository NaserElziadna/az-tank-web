import { log } from '../core/log/Logger.js';

const adlog = log.scope('ads');

/**
 * Ad abstraction. Ads are ~90% of .io revenue and their first job is to cover
 * the server, so this is deliberately provider-agnostic: it auto-detects the
 * CrazyGames SDK when the game runs on that portal and otherwise falls back to a
 * dev stub (no real ad; the reward is granted so the flow stays testable).
 *
 * Two formats:
 *  - interstitial(placement): a single non-rewarded ad at a round/match
 *    transition, frequency-capped to ~1 per 3 min and NEVER mid-round.
 *  - rewarded(placement) → Promise<boolean>: opt-in "watch to earn"; resolves
 *    true only if the ad completed. Rewards must be cosmetic/QoL (double coins,
 *    reroll, skip timer) — NEVER a combat advantage in authoritative PvP.
 *
 * Optional {onAdStart,onAdFinish} hooks let the app mute game audio during ads.
 */
export class AdService {
  constructor({ onAdStart = () => {}, onAdFinish = () => {}, minInterstitialGapMs = 3 * 60 * 1000 } = {}) {
    this._onStart = onAdStart;
    this._onFinish = onAdFinish;
    this.minInterstitialGapMs = minInterstitialGapMs;
    this._lastInterstitial = -Infinity;
    this._sdk = detectSdk();
    adlog.info('ad provider', { provider: this._sdk ? 'crazygames' : 'stub' });
  }

  get available() {
    return !!this._sdk;
  }

  /** Show a transition interstitial if the frequency cap allows. Never rejects. */
  async interstitial(placement = 'transition') {
    const now = nowMs();
    if (now - this._lastInterstitial < this.minInterstitialGapMs) {
      adlog.debug('interstitial skipped (frequency cap)', { placement });
      return;
    }
    this._lastInterstitial = now;
    await this._run('midgame', placement).catch(() => {});
  }

  /** Show an opt-in rewarded ad; resolves true if the reward should be granted. */
  async rewarded(placement = 'reward') {
    try {
      return await this._run('rewarded', placement, true);
    } catch (err) {
      adlog.info('rewarded ad failed — no reward', { placement, message: err?.message });
      return false;
    }
  }

  /** Bridge to the concrete provider (or the stub). */
  _run(type, placement, isReward = false) {
    this._onStart(type);
    const done = (v) => {
      this._onFinish(type);
      return v;
    };
    if (!this._sdk) {
      // Dev stub: no real ad. Grant rewarded (so the reward flow is testable);
      // interstitials are a no-op. Real portals gate the reward properly.
      adlog.info('stub ad', { type, placement, reward: isReward });
      return Promise.resolve(done(isReward));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        resolve(done(ok));
      };
      const fail = (e) => {
        if (settled) return;
        settled = true;
        this._onFinish(type);
        reject(e instanceof Error ? e : new Error(String(e)));
      };
      try {
        this._sdk.ad.requestAd(type, {
          adStarted: () => adlog.info('ad started', { type, placement }),
          adFinished: () => finish(isReward ? true : undefined),
          adError: (e) => (isReward ? finish(false) : fail(e)),
        });
      } catch (e) {
        fail(e);
      }
    });
  }
}

/** The CrazyGames SDK, if the portal injected it; else null (stub mode). */
function detectSdk() {
  try {
    return (typeof window !== 'undefined' && window.CrazyGames && window.CrazyGames.SDK) || null;
  } catch {
    return null;
  }
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
