/* Каталог: фильтрация, сортировка, вид и пагинация поверх пререндеренных карточек (контент доступен поисковикам). */
import { t, tn } from '../i18n/index.js';
import { startStatus } from '../lib/logic.js';
import { $, $$, ctx } from '../ui/runtime.js';
import { hydrateCards } from './common.js';

const KEY = 'rb.catalog.filters';
const PAGE = 9;
const DEFAULTS = { q: '', cat: 'all', level: 'all', dur: 'all', price: 'all', sort: 'popular', view: 'grid' };
const PRICE = { all: () => true, free: p => !p, paid: p => p > 0 };
const DUR = { all: () => true, short: d => d <= 14, month: d => d > 14 && d <= 30, long: d => d > 30 };

export async function init() {
  let f = { ...DEFAULTS };
  try { f = { ...f, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* */ }
  const qs = new URLSearchParams(location.search);
  if (qs.get('cat')) f = { ...f, cat: qs.get('cat'), level: 'all', dur: 'all', price: 'all', q: '' };
  let shown = PAGE;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* */ } };

  const list = $('#list'), cards = $$('.ch-card', list);
  const order = new Map(cards.map((c, i) => [c, i]));

  const sorters = {
    popular: (a, b) => (+b.dataset.participants || 0) - (+a.dataset.participants || 0) || order.get(a) - order.get(b),
    soon: (a, b) => startStatus(a.dataset.start || null, ctx.today).days - startStatus(b.dataset.start || null, ctx.today).days,
    short: (a, b) => a.dataset.days - b.dataset.days,
    finish: (a, b) => (+b.dataset.finish) - (+a.dataset.finish)
  };

  function apply() {
    const q = f.q.trim().toLowerCase();
    const match = cards.filter(c =>
      (f.cat === 'all' || c.dataset.cat === f.cat) && (f.level === 'all' || c.dataset.level === f.level) &&
      DUR[f.dur](+c.dataset.days) && PRICE[f.price || 'all'](+c.dataset.price) && (!q || c.dataset.search.includes(q)));
    match.sort(sorters[f.sort]);
    cards.forEach(c => { c.hidden = true; });
    match.forEach((c, i) => { list.appendChild(c); c.hidden = i >= shown; });

    list.classList.toggle('as-list', f.view === 'list');
    $('#count').textContent = t('Найдено: {n}', { n: tn(match.length, 'челлендж') });
    $('#empty').hidden = match.length > 0;
    const rest = match.length - Math.min(shown, match.length);
    const more = $('#more');
    more.hidden = rest <= 0;
    more.textContent = t('Показать еще {n} из {total}', { n: Math.min(rest, PAGE), total: rest });

    $$('[data-filter]').forEach(g => $$('.fchip', g).forEach(b => {
      const on = f[g.dataset.filter] === b.dataset.v; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on);
    }));
    $$('[data-view]').forEach(b => { const on = b.dataset.view === f.view; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
    $('#sort').value = f.sort;
    const n = ['cat', 'level', 'dur', 'price'].filter(k => f[k] !== 'all').length + (q ? 1 : 0);
    $('#fcount').textContent = n || '';
    $('#reset-top').hidden = !n;
  }

  const reset = () => { f = { ...DEFAULTS, sort: f.sort, view: f.view }; shown = PAGE; $('#q').value = ''; save(); apply(); };
  let timer;
  $('#q').value = f.q;
  $('#q').addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => { f.q = e.target.value; shown = PAGE; save(); apply(); }, 120); });
  $('#sort').addEventListener('change', e => { f.sort = e.target.value; save(); apply(); });
  $$('[data-view]').forEach(b => b.addEventListener('click', () => { f.view = b.dataset.view; save(); apply(); }));
  $$('[data-filter]').forEach(g => g.addEventListener('click', e => {
    const b = e.target.closest('.fchip'); if (!b) return;
    f[g.dataset.filter] = b.dataset.v; shown = PAGE; save(); apply();
  }));
  $('#more').addEventListener('click', () => { shown += PAGE; apply(); });
  $('#reset-top').addEventListener('click', reset);
  $('#reset-empty').addEventListener('click', reset);
  const tg = $('#ftoggle'), panel = $('#fpanel');
  tg.addEventListener('click', () => tg.setAttribute('aria-expanded', String(panel.classList.toggle('open'))));

  apply();
  await hydrateCards(list);
  apply();
}
