/* Разметка компонентов (HTML-строки). Без DOM: используется при пререндере страниц и в браузере. */
import { SITE } from '../content.js';
import { esc, rng, link, initials, hueOf } from '../lib/util.js';
import { startStatus } from '../lib/logic.js';
import { t, tn, num, money, date, localize } from '../i18n/index.js';

/** Иконка из встроенного SVG-спрайта. */
export const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;

export const catLabel = cat => t(SITE.categories[cat]?.label || cat);
export const levelLabel = level => t(SITE.levels[level]?.label || level);
export const catChip = cat => `<span class="chip chip-cat">${icon(SITE.categories[cat]?.icon || 'target')}${catLabel(cat)}</span>`;

export const levelBars = level =>
  `<span class="level-bars level-${level}" aria-hidden="true">${[1, 2, 3].map(i => `<span class="${i <= (SITE.levels[level]?.bars || 1) ? 'on' : ''}"></span>`).join('')}</span>`;
export const levelChip = level => `<span class="level level-${level}" title="${t('Сложность')}: ${levelLabel(level)}">${levelBars(level)}${levelLabel(level)}</span>`;

export const priceTag = c => c.priceUzs > 0 ? `<span class="tag tag-price">${icon('wallet')}${money(c.priceUzs)}</span>` : '';
export const proofTag = c => c.proof === 'required' ? `<span class="tag" title="${t('Нужно подтверждение: фото или ссылка')}">${icon('camera')}${t('С подтверждением')}</span>` : '';

export const bar = (pct, tone = 'primary', label = '') =>
  `<div class="bar bar-${tone}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"${label ? ` aria-label="${esc(label)}"` : ''}><span style="--w:${pct}%"></span></div>`;

export function ring(pct, size = 64, tone = 'success') {
  const r = (size - 8) / 2, c = 2 * Math.PI * r, h = size / 2;
  return `<svg class="ring ring-${tone}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${pct}%">
    <circle cx="${h}" cy="${h}" r="${r}" class="ring-bg"/>
    <circle cx="${h}" cy="${h}" r="${r}" class="ring-fg" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - pct / 100)).toFixed(2)}" transform="rotate(-90 ${h} ${h})"/>
    <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle">${pct}%</text></svg>`;
}

export const avatar = (name, cls = '') => `<span class="avatar ${cls}" style="--h:${hueOf(name)}" aria-hidden="true">${esc(initials(name))}</span>`;

export function startTag(c, todayIso) {
  const s = startStatus(c.nextStart, todayIso);
  if (s.kind === 'rolling') return `<span class="tag tag-live">${icon('radio')}${t('Старт в любой день')}</span>`;
  return `<span class="tag ${s.kind === 'soon' ? 'tag-hot' : ''}">${icon(s.kind === 'soon' ? 'flame' : 'calendar-days')}${t('Поток с {date}', { date: date(c.nextStart, { year: false }) })}</span>`;
}

/** Обложка: генеративный SVG-паттерн по категории. */
export function cover(c, h = 104, extra = '') {
  const r = rng(c.slug), W = 400, H = h;
  let art = '';
  if (c.category === 'sport') {
    for (let i = 0; i < 7; i++) art += `<ellipse cx="${W * 0.78}" cy="${H * 0.95}" rx="${60 + i * 34}" ry="${26 + i * 17}"/>`;
  } else if (c.category === 'business') {
    for (let i = 0; i < 12; i++) { const bh = (14 + i * 7 + r() * 22).toFixed(1); art += `<rect x="${170 + i * 19}" y="${(H - bh).toFixed(1)}" width="11" height="${bh}" rx="3"/>`; }
  } else if (c.category === 'habits') {
    for (let y = 0; y < 6; y++) for (let x = 0; x < 16; x++) art += `<rect x="${150 + x * 16}" y="${12 + y * 18}" width="11" height="11" rx="3"${r() > 0.35 && x > 4 ? ' class="on"' : ''}/>`;
  } else {
    for (let i = 0; i < 8; i++) { const y = 20 + i * 14, a = (10 + r() * 14).toFixed(1); art += `<path d="M120 ${y} C 200 ${y - a}, 260 ${y + +a}, 400 ${y - a / 2}"/>`; }
  }
  return `<div class="cover cover-${c.category} ${extra}" style="height:${h}px" aria-hidden="true">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMaxYMid slice">${art}</svg>
    <span class="cover-ic">${icon(c.icon || 'target')}</span></div>`;
}

/** Карточка челленджа. Живые показатели подставляются гидратацией по data-stat. */
export function card(raw, ctx) {
  const c = localize(raw);
  const href = link(`/challenges/${c.slug}/`, ctx.base, ctx.explicit);
  return `
  <a class="card ch-card reveal" href="${href}" data-slug="${c.slug}" data-cat="${c.category}" data-level="${c.level}" data-days="${c.days}" data-start="${c.nextStart || ''}" data-price="${c.priceUzs || 0}" data-search="${esc((c.title + ' ' + c.short + ' ' + catLabel(c.category)).toLowerCase())}">
    ${cover(c)}
    <div class="ch-body">
      <div class="ch-top">
        <div class="ch-chips">${catChip(c.category)}${levelChip(c.level)}</div>
        <span data-slot="status">${startTag(c, ctx.today)}</span>
      </div>
      <h3 class="ch-title">${esc(c.title)}</h3>
      <p class="ch-short">${esc(c.short)}</p>
      ${c.priceUzs || c.proof === 'required' ? `<div class="ch-chips">${priceTag(c)}${proofTag(c)}</div>` : ''}
      <div class="ch-progress">
        <div class="row-between small"><span class="muted">${t('Средний прогресс потока')}</span><span class="mono" data-stat="avg">—</span></div>
        <div data-stat-bar="avg">${bar(0, 'primary', t('Средний прогресс участников'))}</div>
      </div>
      <div class="ch-meta">
        <span>${icon('calendar-days')}${tn(c.days, 'день')}</span>
        <span title="${t('Участники')}">${icon('users')}<span data-stat="participants">—</span></span>
        <span title="${t('Доходят до финиша')}">${icon('flag')}<span data-stat="finish">—</span></span>
        <span class="ch-go">${icon('arrow-up-right')}</span>
      </div>
    </div>
  </a>`;
}

export function dayGrid(days, done, current, { compact = false, cols = 10 } = {}) {
  const set = new Set(done);
  let cells = '';
  for (let d = 1; d <= days; d++) {
    const cls = set.has(d) ? 'done' : d < current ? 'miss' : d === current ? 'today' : '';
    const st = set.has(d) ? t('выполнен') : d < current ? t('пропущен') : d === current ? t('сегодня') : t('впереди');
    cells += `<span class="cell ${cls}" style="--i:${d}" title="${t('День {n}', { n: d })}: ${st}"></span>`;
  }
  return `<div class="day-grid ${compact ? 'compact' : ''}" style="--cols:${cols}" role="img" aria-label="${t('Выполнено {done} из {total}', { done: set.size, total: tn(days, 'день') })}">${cells}</div>`;
}

export const empty = (ic, title, text, action = '') =>
  `<div class="empty">${icon(ic)}<h3>${title}</h3><p class="muted">${text}</p>${action}</div>`;

export const MOODS = [[1, 'frown', 'Тяжело'], [2, 'annoyed', 'С трудом'], [3, 'meh', 'Нормально'], [4, 'smile', 'Хорошо'], [5, 'laugh', 'Отлично']];
export const REACTIONS = [['fire', 'flame', 'Огонь'], ['clap', 'hand-metal', 'Круто'], ['heart', 'heart', 'Поддерживаю']];

/** Относительное время: «5 мин назад». */
export function ago(iso) {
  const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 60) return t('{n} назад', { n: tn(m, 'минута') });
  const h = Math.round(m / 60);
  if (h < 24) return t('{n} назад', { n: tn(h, 'час') });
  const d = Math.round(h / 24);
  return d < 30 ? t('{n} назад', { n: tn(d, 'день') }) : date(iso.slice(0, 10), { year: false });
}

/** Публикация в ленте потока. */
export function post(p, { photoUrl, titleOf, personHref, showChallenge = false }) {
  return `
  <article class="post card" data-post="${p.id}">
    <header class="post-head">
      ${avatar(p.author)}
      <div class="post-who">
        ${p.userId && p.handle !== undefined && personHref ? `<a href="${personHref(p.userId)}"><b>${esc(p.author)}</b></a>` : `<b>${esc(p.author)}</b>`}
        <span class="muted small">${t('День {n}', { n: p.day })}${showChallenge && titleOf ? ` · ${esc(titleOf(p.slug))}` : ''} · ${ago(p.at)}</span>
      </div>
      <button class="icon-btn icon-btn-sm" data-report="checkin" data-id="${p.id}" aria-label="${t('Пожаловаться')}" title="${t('Пожаловаться')}">${icon('flag')}</button>
    </header>
    ${p.text ? `<p class="post-text">${esc(p.text)}</p>` : ''}
    ${p.photo ? `<a class="post-photo" href="${esc(photoUrl(p.photo))}" target="_blank" rel="noopener"><img src="${esc(photoUrl(p.photo))}" alt="${t('Фото-подтверждение')}" loading="lazy"></a>` : ''}
    ${p.proofUrl ? `<a class="post-link small" href="${esc(p.proofUrl)}" target="_blank" rel="noopener nofollow ugc">${icon('link')}${esc(p.proofUrl.replace(/^https:\/\//, '').slice(0, 60))}</a>` : ''}
    <footer class="post-foot">
      ${REACTIONS.map(([k, ic, l]) => `<button class="react ${p.mine?.includes(k) ? 'on' : ''}" data-react="${k}" data-id="${p.id}" aria-pressed="${!!p.mine?.includes(k)}" title="${t(l)}">${icon(ic)}<span class="mono">${p[k] || 0}</span></button>`).join('')}
      <button class="react" data-comments="${p.id}" aria-expanded="false">${icon('message-circle')}<span class="mono">${p.comments || 0}</span><span class="sr-only">${t('Комментарии')}</span></button>
    </footer>
    <div class="comments" data-comments-box="${p.id}" hidden></div>
  </article>`;
}

export { num, tn, money, esc, link, t, date, localize };
