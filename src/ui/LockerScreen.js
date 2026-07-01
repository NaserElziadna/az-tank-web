import { el, clear } from './dom.js';
import { profile } from '../game/services/ProfileService.js';
import { cosmeticsOfType } from '../game/cosmetics/catalog.js';

/**
 * The Locker — the unlock ladder. Shows the player's coins/level/streak and a
 * grid of cosmetics (tank colours + movement trails) to buy with coins and
 * equip. LOOKS only: nothing here touches gameplay stats. Pure DOM; it reads and
 * mutates the {@link profile} singleton and re-renders on change.
 */
export class LockerScreen {
  /** @param {{onBack:()=>void}} handlers */
  constructor({ onBack }) {
    this.onBack = onBack;
    this.root = el('div.screen.menu.locker', {}, []);
    this._unsub = profile.onChange(() => this._render());
    this._render();
  }

  dispose() {
    this._unsub?.();
  }

  _render() {
    clear(this.root);
    const lp = profile.levelProgress;
    this.root.appendChild(
      el('div.locker__wrap', {}, [
        el('div.menu__logo', {}, [el('span.tank', { text: 'THE' }), el('span.trouble', { text: 'LOCKER' })]),
        el('div.locker__stats', {}, [
          this._stat('🪙', `${profile.coins}`, 'coins'),
          this._stat('⭐', `Lv ${lp.level}`, `${lp.into}/${lp.need} XP`),
          this._stat('🔥', `${profile.streak.count}`, 'day streak'),
        ]),
        el('div.locker__level'),
        this._section('Tank Colour', 'color'),
        this._section('Movement Trail', 'trail'),
        el('div.menu__actions', { style: { marginTop: '10px' } }, [el('button.btn.btn--ghost', { text: '← Back', on: { click: () => this.onBack() } })]),
      ]),
    );
    // XP progress bar under the stats.
    const bar = this.root.querySelector('.locker__level');
    if (bar) {
      const pct = Math.round((lp.into / lp.need) * 100);
      bar.appendChild(el('div.locker__level-fill', { style: { width: `${pct}%` } }));
    }
  }

  _stat(icon, big, small) {
    return el('div.locker__stat', {}, [el('span.locker__stat-ico', { text: icon }), el('span.locker__stat-big', { text: big }), el('span.locker__stat-small', { text: small })]);
  }

  _section(title, type) {
    const cards = cosmeticsOfType(type).map((c) => this._card(c));
    return el('div.locker__section', {}, [el('div.locker__section-title', { text: title }), el('div.locker__grid', {}, cards)]);
  }

  _card(item) {
    const owned = profile.isUnlocked(item.id);
    const equipped = profile.equippedId(item.type) === item.id;
    const preview = item.type === 'color' ? el('div.locker__swatch', { style: { background: item.color.base } }) : this._trailPreview(item);

    let action;
    if (equipped) {
      action = el('div.locker__badge locker__badge--on', { text: '✓ Equipped' });
    } else if (owned) {
      action = el('button.locker__btn', { text: 'Equip', on: { click: () => profile.equip(item.id) } });
    } else {
      const afford = profile.coins >= item.cost;
      const btn = el('button.locker__btn' + (afford ? '' : ' locker__btn--locked'), { text: `🪙 ${item.cost}` });
      btn.addEventListener('click', () => {
        if (profile.unlock(item.id)) profile.equip(item.id);
        else this._flash(btn, 'Not enough 🪙');
      });
      action = btn;
    }

    return el('div.locker__card' + (equipped ? ' locker__card--on' : ''), {}, [preview, el('span.locker__name', { text: item.name }), action]);
  }

  _trailPreview(item) {
    const bg = item.rgb === 'rainbow'
      ? 'linear-gradient(90deg,#ff5b5b,#f7d154,#4cd07a,#37b7d0,#7a6cff)'
      : item.rgb
        ? `linear-gradient(90deg, rgba(${item.rgb},0), rgb(${item.rgb}))`
        : 'repeating-linear-gradient(45deg,#2a2d34,#2a2d34 6px,#22252b 6px,#22252b 12px)';
    return el('div.locker__swatch locker__swatch--trail', { style: { background: bg } });
  }

  _flash(btn, msg) {
    const prev = btn.textContent;
    btn.textContent = msg;
    setTimeout(() => (btn.textContent = prev), 1200);
  }
}
