# AZ Tank — Product & Growth Roadmap

From deep web research (8 topics: fun/retention, progression, game modes, growth,
monetization, distribution, scaling, balance), each with cited findings and
recommendations specific to this game. Companion to `ENHANCEMENTS.md` (which covers
the *technical* fixes). This doc is the *product* direction.

**One-line strategy:** the core loop is already good — the wins are **removing
friction (dead time, empty lobbies, cold start), adding reasons to return
(modes + cosmetics), and getting discovered (CrazyGames + shareable links).**

---

## 🎯 Do-next Top 7 (highest impact, ordered)

1. **Kill dead-time between rounds** — the #1 retention lever. Today ≈5s of non-play
   (`BETWEEN_ROUNDS 1.0 + countdown 1.5 + GO 0.5 + ROUND_FINISHING 2.2`) between
   ~20–40s rounds. Target **< 2.5s from kill to next "GO"**: trim `ROUND_FINISHING`
   to ~1.2s, speed the countdown, show the scoreboard *during* the maze fade-in.
2. **Prominent "↻ Rematch / one more" + default "first to 5" + a near-miss beat.**
   Loss-aversion + near-miss drive "one more game." Make rematch the biggest button on
   match-over; show "you were 1 point from the win"; show score bars filling toward the
   target. (Endless `pointsToWin=0` has no climax.)
3. **Instant, invisible bot backfill online.** A room must **never wait for a 2nd
   human** — start immediately with bots (plausible names), hot-swap bot→human on join.
   Solves the empty-Render-lobby problem *and* covers the cold-start window. You already
   have `AIController` + `reviveBots` + `Player.isAI`.
4. **Ship game modes** (currently exactly one). Refactor the fixed win/score logic in
   `B2Match`/`Score` behind a small **GameMode** strategy, then ship **Deathmatch**
   (timed frags + respawn + spawn-shield) first — it fixes "eliminated players sit idle"
   and gives fast always-active matches.
5. **Weighted crate rarity** (today `rng.pick(ALL_CRATES)` is uniform — a game-swinging
   Mega-Laser is as likely as an Aimer). Add a `weight` per crate (common 50 / uncommon
   35 / rare 15). Kills the "lost to a lucky pickup" feel-bad.
6. **PWA + mobile correctness** — half-day, high ROI. Add `vite-plugin-pwa` (manifest +
   service worker), and **add `viewport-fit=cover`** to the viewport meta (without it,
   every `env(safe-area-inset-*)` you wrote resolves to 0 on notched phones).
7. **Launch on CrazyGames + rewarded ads.** It's the "home of .io games," supports your
   authoritative-server + invite-link model, and its ad SDK gives rewarded video with
   **zero traffic minimum** — distribution *and* monetization in one move (ads' first job
   is to cover the server).

---

## 1. Fun & retention
Core loop is strong; progression/meta is weak. Sources: agar/slither (cosmetic meta),
Valorant DM (1.5s respawn = anti-dead-time), Battlefield 6 (bot backfill).
- **Dead-time cut** (see #1) — biggest lever, minimize time between rounds not lengthen rounds.
- **Near-miss / loss-aversion beats** at round/match end (#2).
- **Teach-by-playing onboarding**: first launch drops straight into a bot round with tiny
  contextual prompts ("grab the crate", "fire!"), a satisfying kill within ~15s, < 1 min, skippable. No tutorial wall.
- **Juice, with restraint**: reserve screen-shake for **kills/explosions only** (never per
  bullet — that's your most common action and induces nausea); add ~60–100ms hit-pause on
  kills, muzzle flash + burst on fire, debris on death, eased scoreboard/countdown pops.
  Add a "reduce motion / low FX" toggle.
- **Cold-start hider**: show an **instant local vs-bots game on first load** while the
  socket warms in the background, then offer "play online."
- **Instrument the funnel** in `logs/az-tank.log`: session start, first-round latency,
  rounds/session, rematch clicks, invite copies, drop points.

## 2. Progression & cosmetics (account-light)
Rule: **unlock LOOKS, never STATS** (authoritative PvP — any earned advantage = pay/grind-to-win).
- Phase-1 = **localStorage only** (you already have `SettingsService`): `xp, level, coins,
  unlocked[], equipped{color,trail,projectile,killFx}, dailyStreak`. Per-device, editable —
  fine for a friendly cosmetic-only game.
- **Earn loop (copy Tank Trouble):** coins + XP on round win (scale by human opponents;
  bots give less); occasionally spawn a coin collectible via `CrateSpawner`.
- **Cheapest cosmetics for your engine first:** extra tank **colors** (nearly free via
  `TankIconCompositor` palette) + movement **trails** (additive via `ParticleSystem`), then
  projectile skins + kill-effect variants, then turret decals.
- Generous **free starter set** (never "naked"); gate only flashy/rare/seasonal.
- **"Unlock ladder"** (fixed ~15–25 tiers), not a seasonal battle-pass treadmill.
- **Daily streak** with a **forgiveness buffer** (one miss ≠ reset); reward = coins, never
  gate play.
- Only add a **signed-anonymous backend** (deviceId + server-signed token, no
  email/password) later if cross-device sync/leaderboards matter — needs a durable DB
  (Render free has none). Offer an export/import code meanwhile.

## 3. Game modes (biggest replayability gap — currently zero)
Refactor first, then each mode sits on top with no engine/physics/AI/net changes:
- **GameMode strategy** in `enums.js` + hooks (`onKill`, `onTick`, `isRoundOver`,
  `roundWinner`, `isMatchOver`, respawn policy). Move the "last-tank / first-to-N" decision
  out of `B2Match._endRound`/`Score`.
- **Deathmatch** (timed frags, ~90–120s, respawn ~2s w/ spawn-shield, +1 kill / −1 suicide) — ship first.
- **2v2 Team** (cheapest: add `team` to `Player`, team-aware win/damage; 2 humans + bot each).
- **King of the Hill** (central maze tile, tick to sole holder, pause when contested).
- **Gold Rush** — wire up the **already-defined** `CollectibleType.GOLD/DIAMOND` (currently
  don't affect score) into a gem-grab mode.
- **Co-op Waves** (invert `reviveBots`: humans vs escalating AI) — PvE pillar, fills empty
  lobbies, best hedge for low population.
- **Maze variety:** per-mode presets (tight vs open), **symmetric** layout for team modes,
  2–3 palette **themes**, and **seeded/shareable maps** in the `#/room/CODE` link.
- Use the existing `RoundPhase.ENDING` window for a scoreboard beat + hidden catch-up
  (bias next crate toward the trailing player).

## 4. Growth & discovery (near-zero budget)
- **Portals are the #1 channel.** **CrazyGames first** — "home of .io games," supports
  external-backend multiplayer + invite links (Smash Karts launched there), and a 2-stage
  launch lets you go live *without* SDK/refactor to validate retention. (Poki pushes a
  WebRTC-P2P `netlib` model that would mean rewriting your authoritative server — a "later,
  maybe" that likely costs a refactor.)
- **Before submitting:** allow the portal's iframe **origins** in the WS check, HTTPS/WSS
  everywhere, and **mitigate cold start** (a 30–60s wake fails the "land directly in
  gameplay" bar — instant local vs-bots + keep-warm/"waking server" state).
- **Treat the room link as the growth feature:** one-tap Copy-Link / Web-Share on the
  match-over + lobby (Skribbl/Agar grew almost entirely on this).
- **Exclusivity fork:** Path A (recommended) = CrazyGames + cross-portal + embeds
  (GameDistribution/GameMonetize) for max free reach; Path B = Poki 5-yr web-exclusive
  (great "you bring the player = 100%" economics but ad-only + likely P2P rewrite).
- **Landing page** (aztank.io) that's instant-play + names the genre; **community**: post to
  r/playmygame, participate in r/WebGames & r/iogames *before* self-promoting, clips on X,
  cold-email micro .io streamers; seed a Discord for game nights (bots keep rooms full).
- **Instrument retention** (DAU, session length, return rate) — exactly what portal ranking
  rewards.

## 5. Monetization (realistic)
- **Ads are ~90% of .io revenue; web IAP is hard.** Plan around ads; IAP is a bonus.
- **Rewarded video is the best format** (opt-in 50–65%, +~20% retention, eCPM ~$8–28).
  Ethical hooks that fit AZ Tank: "watch to respawn now / skip timer", "reroll your starting
  weapon", "double end-of-round score", "unlock a one-time cosmetic" — **never a combat
  advantage.**
- **One interstitial** at the round/match transition, capped ~1 per 3 min, never mid-round.
- **Intrinsic in-game ad** (sponsor banner on arena walls) — modest eCPM, ad-block-proof,
  non-interruptive.
- **Defer IAP** (needs accounts + cloud saves — LocalStorage cosmetics = chargebacks).
  **Skip battle passes/loot boxes** (too heavy for solo + FOMO backlash).
- **Ads' first job is to cover the server**, not profit: at $1–5 RPM you need hundreds of
  thousands of plays/mo — which is exactly what portals provide.

## 6. Mobile distribution & PWA
- **Manifest + service worker** via `vite-plugin-pwa` (~half a day): `standalone`,
  `orientation:'landscape'`, 192/512 + maskable icons from the tank SVG; precache the
  Phaser/JS/CSS/sprite/audio bundle, **NetworkOnly** for the WS.
- **Fix mobile HTML/CSS:** add `viewport-fit=cover`; `apple-mobile-web-app-capable`,
  `black-translucent` status bar, `apple-touch-icon`; `height:100vh` (not 100%/100dvh);
  `overscroll-behavior:none`; keep ≥20px clearance from the top edge (iOS landscape
  touch dead-zone).
- **Deferred install button** (capture `beforeinstallprompt`, show after a match, not on
  load — ~6× install uplift); **iOS coached "Add to Home Screen" hint** (no API on iOS).
- **Google Play via TWA** (Bubblewrap/PWABuilder — reuses your live URL, real Chrome
  engine, $25 one-time); **skip the iOS App Store** (Capacitor/WKWebView is slower for a
  canvas game + $99/yr + review risk). **Push** is a later, install-gated bonus.

## 7. Scaling on cheap hosting
- **CPU is the limit, not bandwidth.** A full-state JSON snapshot is ~1.5–2.5 KB; 100 GB/mo
  covers ~140–230 room-hours. You'll hit the **0.1 vCPU** wall (≈1–3 concurrent rooms) first.
- **Your architecture is already right:** single `JSON.stringify` per tick broadcast to all,
  bounded `_pendingEvents`, 60 Hz sim / 20 Hz snapshots + interpolation (the Valve model).
  **Don't** add delta/binary/AOI (net-negative at this scale) and **don't** raise snapshot Hz.
- **Measure** a per-tick timing probe (p50/p99 vs the 16.6ms budget) → your exact "rooms
  until saturation" number. If CPU-bound, **drop sim to 30 Hz** (slow tanks, interpolated —
  likely imperceptible, ~2× rooms/instance). Cut per-tick GC in `buildSnapshot`; heartbeat
  (2–4 Hz) during lobby/countdown.
- **Hosting jump:** free → a small **always-on VPS (Hetzner CX22, ~€4–5/mo, 2 vCPU)** is the
  best value (≈20× the CPU of Render free, no spin-down). Render Starter ($7)/Fly remove
  spin-down too but give less CPU/$.
- **Scale-out (v2, only if needed):** PM2 **fork** mode (not cluster), sticky `/ws` routing,
  a shared Redis **room directory** (`CODE → host:port`); rooms never span processes.
- **Harden free tier now:** cap `MAX_ACTIVE_ROOMS` + graceful "server busy"; a deploy wipes
  in-memory rooms (the 120s reconnect grace survives socket drops, **not** restarts) — deploy
  in quiet hours. Keep `permessage-deflate` **off** (CPU trap on a tiny box).

## 8. Weapon & game balance
- **Keep the restitution-1 bounce + first-bounce self-kill** — that's the core skill and the
  genre's identity. Don't add per-bounce falloff / hard low bounce caps to the default bullet.
- **Resolve the one-hit-vs-health inconsistency** (comment says one-hit, but `HEALTH.normal=3`
  with fractional damage): recommended — a **direct bullet is lethal**, keep fractional damage
  for spray (shotgun/gatling/shrapnel). Pick one identity; the current middle is weakest.
- **Weighted crate rarity** (see #5 of top-7): common = Aimer/Speed/Double/Mines; uncommon =
  Shotgun/Gatling/Shield/Recon; rare (round-deciders) = Laser/Homing/Mega-Laser/Rapid/Phase.
- **Give abilities counterplay:** Phase (block firing while phasing, telegraph the exit,
  shorten); Mega-Laser (add a wind-up tell); Rapid-Fire (still respect the on-field bullet
  cap). Recon (info-only) is fine.
- **Catch-up = spawn/pickup access only** (bias next crate toward the trailing tank), never
  stat buffs. The fresh-maze-per-round is your fairness reset.
- **Telemetry events** into the unified log: `round_start`, `kill{cause=direct|ricochet|self|
  mine|ability, weaponKind, bounceCount}`, `crate_pickup`, `round_end`, `self_kill`. Compute
  **non-mirror win contribution** to separate power from popularity; treat data as a
  diagnostic, not the decider.

---

## Suggested sequencing
- **Sprint A (feel & funnel):** cut dead-time; rematch button + first-to-5 + near-miss;
  instant bot backfill; tighter juice + reduce-motion toggle; instant local-vs-bots on load.
- **Sprint B (depth):** GameMode refactor → Deathmatch; weighted crate rarity; resolve
  one-hit/health; balance telemetry events.
- **Sprint C (reach):** PWA manifest + `viewport-fit=cover` + install prompt; CrazyGames
  submission (harden origins/cold-start) + rewarded-ad hooks + shareable-link share sheet.
- **Sprint D (retain):** cosmetic meta (colors/trails + coins-on-win + unlock ladder + daily
  streak); more modes (2v2, KotH, Co-op Waves, Gold Rush); landing page + Discord.
- **When it grows:** paid VPS/Render Starter; signed-anonymous backend for cross-device +
  leaderboards; TWA on Google Play.
