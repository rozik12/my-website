/* Главная: живая статистика платформы, лента активности, отзывы. */
import { api } from '../api/index.js';
import { CHALLENGES } from '../content.js';
import { t, tn, localize } from '../i18n/index.js';
import { avatar, icon, ago, esc } from '../ui/markup.js';
import { $, $$, countTo, href } from '../ui/runtime.js';
import { hydrateCards } from './common.js';
import { report } from '../monitor.js';

const titleOf = slug => localize(CHALLENGES.find(c => c.slug === slug))?.title;

export async function init() {
  $$('.seg-btn[data-tab]').forEach(btn => btn.addEventListener('click', () => {
    $$('.seg-btn[data-tab]').forEach(b => { b.classList.toggle('active', b === btn); b.setAttribute('aria-selected', b === btn); });
    $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== btn.dataset.tab; });
  }));

  const [stats] = await Promise.all([
    hydrateCards(),
    api.platformStats().then(p => {
      if (!p.participants) { $('#platform-stats').innerHTML = `<p class="muted small new-platform">${icon('sparkles')}${t('Платформа только запустилась — станьте одним из первых участников.')}</p>`; return; }
      countTo($('[data-pstat="participants"]'), p.participants);
      countTo($('[data-pstat="finish"]'), p.finishRate, '%');
      countTo($('[data-pstat="checkins"]'), p.checkins24h);
    }).catch(e => report(e, { action: 'platform_stats' })),
    api.recentActivity().then(items => {
      const feed = $('#feed');
      const html = items.filter(i => titleOf(i.slug)).map(i =>
        `<span class="feed-item">${avatar(i.name, 'avatar-xs')}<b>${esc(i.name)}</b> ${t('отметил(а) день {n} в «{title}»', { n: i.day, title: esc(titleOf(i.slug)) })} <span class="muted">· ${ago(i.at)}</span></span>`).join('');
      if (!html) return;
      $('.feed-track', feed).innerHTML = html + html;
      feed.hidden = false;
    }).catch(e => report(e, { action: 'recent_activity' })),
    api.testimonials().then(list => {
      if (!list.length) return;
      $('#quotes').innerHTML = list.slice(0, 3).map(x => `
        <figure class="card quote">${icon('quote', 'quote-ic')}<blockquote>${esc(x.text)}</blockquote>
          <figcaption>${avatar(x.name)}<span><b>${esc(x.name)}</b><a class="small muted" href="${href(`/challenges/${x.slug}/`)}">${esc(titleOf(x.slug) || '')}</a></span></figcaption></figure>`).join('');
      $('#reviews').hidden = false;
    }).catch(e => report(e, { action: 'testimonials' }))
  ]);

  if (stats) $$('[data-cat-count]').forEach(el => {
    const n = CHALLENGES.filter(c => c.category === el.dataset.catCount).reduce((s, c) => s + (stats[c.slug]?.participants || 0), 0);
    if (n) { el.innerHTML = `${icon('users')}${tn(n, 'участник')}`; el.hidden = false; }
  });
}
