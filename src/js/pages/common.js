/* Общая гидратация: живые показатели на карточках челленджей. */
import { api } from '../api/index.js';
import { num, t } from '../i18n/index.js';
import { bar } from '../ui/markup.js';
import { $$ } from '../ui/runtime.js';
import { report } from '../monitor.js';

let statsPromise;
export function loadStats() {
  statsPromise = statsPromise || api.challengeStats().catch(e => { report(e, { action: 'challenge_stats' }); return {}; });
  return statsPromise;
}
export const resetStats = () => { statsPromise = null; };

export async function hydrateCards(root = document) {
  const stats = await loadStats();
  $$('[data-slug]', root).forEach(card => {
    const s = stats[card.dataset.slug];
    if (!s) return;
    card.dataset.participants = s.participants;
    card.dataset.finish = s.finish ?? -1;
    const set = (k, v) => { const el = card.querySelector(`[data-stat="${k}"]`); if (el) el.textContent = v; };
    set('participants', num(s.participants));
    set('finish', s.finish === null ? '—' : s.finish + '%');
    set('avg', s.participants ? s.avg + '%' : '—');
    const b = card.querySelector('[data-stat-bar="avg"]');
    if (b) b.innerHTML = bar(s.avg, 'primary', t('Средний прогресс участников'));
  });
  return stats;
}
