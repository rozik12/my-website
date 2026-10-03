import './style.css';
import { DEFAULT_RATES, SOCIAL_TAX_PRESETS, calculate, scale } from './lib/tax.js';
import { formatPercent, formatSum, groupDigits, parseDigits } from './lib/format.js';
import { buildIcs, deadlinesForMonth, upcomingDeadlines } from './lib/calendar.js';

const $ = (sel) => document.querySelector(sel);
const STORAGE_KEY = 'hisobchi.calc.v1';

const state = {
  mode: 'gross',
  amount: 5_000_000,
  period: 1,
  socialPreset: 'standard',
  customSocial: 12,
  ...loadState(),
};

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}

/* ---------- Калькулятор ---------- */

const amountInput = $('#amount');
const clearBtn = $('#clear');
const socialSelect = $('#social-preset');
const customSocialWrap = $('#custom-social-wrap');
const customSocialInput = $('#custom-social');

socialSelect.innerHTML = SOCIAL_TAX_PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('');

function socialRate() {
  const preset = SOCIAL_TAX_PRESETS.find((p) => p.id === state.socialPreset) ?? SOCIAL_TAX_PRESETS[0];
  if (preset.rate !== null) return preset.rate;
  const pct = Math.min(100, Math.max(0, Number(state.customSocial) || 0));
  return pct / 100;
}

function setAmountDisplay(value) {
  amountInput.value = value === null ? '' : groupDigits(value, ' ');
  const long = amountInput.value.length > 11;
  amountInput.classList.toggle('text-2xl', !long);
  amountInput.classList.toggle('sm:text-3xl', !long);
  amountInput.classList.toggle('text-lg', long);
  amountInput.classList.toggle('sm:text-2xl', long);
}

function formatWhileTyping() {
  const { value, selectionStart } = amountInput;
  const digitsBeforeCaret = value.slice(0, selectionStart ?? value.length).replace(/\D/g, '').length;
  const parsed = parseDigits(value);
  state.amount = parsed;
  setAmountDisplay(parsed);

  let pos = 0;
  let seen = 0;
  const formatted = amountInput.value;
  while (pos < formatted.length && seen < digitsBeforeCaret) {
    if (/\d/.test(formatted[pos])) seen += 1;
    pos += 1;
  }
  amountInput.setSelectionRange(pos, pos);
  render();
}

// Big result figures shrink with length; group separators are regular spaces so an overlong value wraps between groups, never inside one.
function setFittedSum(el, value, sizes) {
  const text = formatSum(value, ' ');
  el.textContent = text;
  const all = sizes.flatMap(([, cls]) => cls.split(' '));
  el.classList.remove(...all);
  const [, cls] = sizes.find(([max]) => text.length <= max);
  el.classList.add(...cls.split(' '));
}

function render() {
  const rates = { ...DEFAULT_RATES, social: socialRate() };
  const monthly = calculate({ amount: state.amount ?? 0, mode: state.mode, rates });
  const r = scale(monthly, state.period);

  document.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === state.mode)));
  document.querySelectorAll('.period-btn').forEach((b) => b.setAttribute('aria-selected', String(Number(b.dataset.period) === state.period)));
  $('#amount-label').textContent = state.mode === 'gross' ? 'Сумма оклада в месяц (до налогов)' : 'Желаемая сумма на руки в месяц';
  clearBtn.classList.toggle('hidden', state.amount === null);
  socialSelect.value = state.socialPreset;
  customSocialWrap.classList.toggle('hidden', state.socialPreset !== 'custom');

  setFittedSum($('#r-net'), r.net, [
    [13, 'text-3xl sm:text-4xl'],
    [17, 'text-2xl sm:text-4xl'],
    [21, 'text-xl sm:text-3xl'],
    [Infinity, 'text-lg sm:text-2xl'],
  ]);
  $('#r-gross-top').textContent = formatSum(r.gross);
  $('#r-gross').textContent = formatSum(r.gross);
  $('#r-pit').textContent = `− ${formatSum(r.pitTotal)}`;
  $('#r-pit-budget').textContent = formatSum(r.pitToBudget);
  $('#r-inps').textContent = formatSum(r.inps);
  $('#r-net-row').textContent = formatSum(r.net);
  $('#r-social').textContent = `+ ${formatSum(r.socialTax)}`;
  $('#r-social-rate').textContent = formatPercent(rates.social);
  setFittedSum($('#r-total'), r.totalCost, [
    [13, 'text-lg sm:text-xl'],
    [21, 'text-base sm:text-xl'],
    [Infinity, 'text-sm sm:text-lg'],
  ]);

  const total = r.totalCost || 1;
  const pct = (v) => `${((v / total) * 100).toFixed(2)}%`;
  $('#bar-net').style.width = r.totalCost ? pct(r.net) : '0%';
  $('#bar-pit').style.width = r.totalCost ? pct(r.pitToBudget) : '0%';
  $('#bar-inps').style.width = r.totalCost ? pct(r.inps) : '0%';
  $('#bar-social').style.width = r.totalCost ? pct(r.socialTax) : '0%';

  const share = r.totalCost ? ((r.allTaxes / r.totalCost) * 100).toFixed(1).replace('.', ',') : '0';
  $('#r-tax-share').textContent = `Налоги и взносы: ${share}% от затрат работодателя`;

  saveState();
}

amountInput.addEventListener('input', formatWhileTyping);
amountInput.addEventListener('focus', () => amountInput.select());

clearBtn.addEventListener('click', () => {
  state.amount = null;
  setAmountDisplay(null);
  amountInput.focus();
  render();
});

document.querySelectorAll('.seg-btn').forEach((btn) =>
  btn.addEventListener('click', () => {
    state.mode = btn.dataset.mode;
    render();
  }),
);

document.querySelectorAll('.period-btn').forEach((btn) =>
  btn.addEventListener('click', () => {
    state.period = Number(btn.dataset.period);
    render();
  }),
);

$('#presets').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-value]');
  if (!chip) return;
  state.amount = Number(chip.dataset.value);
  setAmountDisplay(state.amount);
  render();
});

socialSelect.addEventListener('change', () => {
  state.socialPreset = socialSelect.value;
  render();
  if (state.socialPreset === 'custom') customSocialInput.focus();
});

customSocialInput.addEventListener('input', () => {
  const cleaned = customSocialInput.value.replace(',', '.').replace(/[^\d.]/g, '');
  state.customSocial = Number(cleaned);
  render();
});

customSocialInput.value = String(state.customSocial).replace('.', ',');
setAmountDisplay(state.amount);
render();

/* ---------- Календарь ---------- */

const COLORS = {
  emerald: { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700', ring: 'ring-emerald-200' },
  sky: { dot: 'bg-sky-500', badge: 'bg-sky-50 text-sky-700', ring: 'ring-sky-200' },
  amber: { dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700', ring: 'ring-amber-200' },
  violet: { dot: 'bg-violet-500', badge: 'bg-violet-50 text-violet-700', ring: 'ring-violet-200' },
};

const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const weekdayFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });
const monthFmt = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });

function daysLabel(n) {
  if (n === 0) return 'Сегодня';
  if (n === 1) return 'Завтра';
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11 ? 'день' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'дня' : 'дней';
  return `через ${n} ${word}`;
}

function urgencyClass(n) {
  if (n <= 3) return 'bg-rose-500 text-white';
  if (n <= 7) return 'bg-amber-400 text-amber-950';
  return 'bg-slate-100 text-slate-600';
}

const today = new Date();

function renderDeadlines() {
  const list = upcomingDeadlines(today, 5);
  $('#deadline-list').innerHTML = list
    .map((d, i) => {
      const c = COLORS[d.color];
      const highlight = i === 0 ? `ring-2 ${c.ring}` : 'ring-1 ring-slate-100';
      return `
        <li class="flex items-start gap-3 sm:items-center sm:gap-4 rounded-2xl bg-white p-3.5 ${highlight} sm:p-4">
          <div class="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-slate-50 text-center">
            <div>
              <div class="text-xl font-extrabold leading-none">${d.date.getDate()}</div>
              <div class="mt-0.5 text-[10px] font-medium uppercase text-slate-400">${weekdayFmt.format(d.date)}</div>
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-semibold">${d.title}</span>
              <span class="rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${c.badge}">${d.tag}</span>
            </div>
            <div class="mt-0.5 text-sm text-slate-500">${d.description}</div>
            <div class="mt-1 text-xs text-slate-400">до ${dayFmt.format(d.date)}${d.shifted ? ` · перенесено с ${dayFmt.format(d.nominal)} (выходной)` : ''}</div>
            <span class="mt-2 inline-block rounded-full px-2.5 py-1 text-xs font-semibold sm:hidden ${urgencyClass(d.daysLeft)}">${daysLabel(d.daysLeft)}</span>
          </div>
          <span class="hidden shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold sm:inline-block ${urgencyClass(d.daysLeft)}">${daysLabel(d.daysLeft)}</span>
        </li>`;
    })
    .join('');
}

let viewYear = today.getFullYear();
let viewMonth = today.getMonth();

function renderMonth() {
  const first = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const events = deadlinesForMonth(viewYear, viewMonth);
  const byDay = new Map();
  for (const e of events) {
    if (e.date.getMonth() !== viewMonth) continue;
    const key = e.date.getDate();
    byDay.set(key, [...(byDay.get(key) ?? []), e]);
  }
  $('#cal-month').textContent = monthFmt.format(first).replace(' г.', '');

  const cells = [];
  for (let i = 0; i < offset; i += 1) cells.push('<div></div>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(viewYear, viewMonth, day);
    const isToday = date.toDateString() === today.toDateString();
    const evs = byDay.get(day) ?? [];
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const base = isToday
      ? 'bg-slate-900 text-white'
      : evs.length
        ? 'bg-white font-semibold text-slate-900 ring-1 ring-slate-200'
        : weekend
          ? 'text-slate-300'
          : 'text-slate-600';
    const dots = evs.map((e) => `<i class="h-1 w-1 rounded-full ${COLORS[e.color].dot}"></i>`).join('');
    const title = evs.map((e) => e.title).join(', ');
    cells.push(`
      <div class="flex aspect-square flex-col items-center justify-center rounded-lg text-xs ${base}" ${title ? `title="${title}"` : ''}>
        <span>${day}</span>
        <span class="mt-0.5 flex h-1 gap-0.5">${dots}</span>
      </div>`);
  }
  $('#cal-grid').innerHTML = cells.join('');
}

$('#cal-prev').addEventListener('click', () => {
  viewMonth -= 1;
  if (viewMonth < 0) {
    viewMonth = 11;
    viewYear -= 1;
  }
  renderMonth();
});

$('#cal-next').addEventListener('click', () => {
  viewMonth += 1;
  if (viewMonth > 11) {
    viewMonth = 0;
    viewYear += 1;
  }
  renderMonth();
});

$('#ics').addEventListener('click', () => {
  const blob = new Blob([buildIcs(today, 12)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: 'nalogovyj-kalendar-uz.ics' });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

renderDeadlines();
renderMonth();
