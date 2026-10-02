/* Мультиязычность: русский (по умолчанию), узбекский (латиница), английский.
   Ключ перевода — русская строка: t('Войти'). Параметры — {name}: t('День {n} из {total}', { n, total }).
   Словари: ./uz.js и ./en.js. Полноту переводов проверяет tests/unit/i18n.test.mjs. */
import uz from './uz.js';
import en from './en.js';

export const LANGS = ['ru', 'uz', 'en'];
export const LANG_NAMES = { ru: 'Русский', uz: 'Oʻzbekcha', en: 'English' };
export const LOCALES = { ru: 'ru-RU', uz: 'uz-Latn-UZ', en: 'en-GB' };
const DICTS = { ru: null, uz, en };

let lang = 'ru';
export function setLang(l) { lang = LANGS.includes(l) ? l : 'ru'; return lang; }
export const getLang = () => lang;

export function t(key, params) {
  let s = lang === 'ru' ? key : (DICTS[lang][key] ?? key);
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m));
  return s;
}

/* Склонение существительных после числа */
const NOUNS = {
  день: { ru: ['день', 'дня', 'дней'], uz: ['kun'], en: ['day', 'days'] },
  челлендж: { ru: ['челлендж', 'челленджа', 'челленджей'], uz: ['chellenj'], en: ['challenge', 'challenges'] },
  участник: { ru: ['участник', 'участника', 'участников'], uz: ['ishtirokchi'], en: ['participant', 'participants'] },
  чекин: { ru: ['чекин', 'чекина', 'чекинов'], uz: ['belgi'], en: ['check-in', 'check-ins'] },
  комментарий: { ru: ['комментарий', 'комментария', 'комментариев'], uz: ['izoh'], en: ['comment', 'comments'] },
  подписчик: { ru: ['подписчик', 'подписчика', 'подписчиков'], uz: ['obunachi'], en: ['follower', 'followers'] },
  минута: { ru: ['минуту', 'минуты', 'минут'], uz: ['daqiqa'], en: ['minute', 'minutes'] },
  час: { ru: ['час', 'часа', 'часов'], uz: ['soat'], en: ['hour', 'hours'] }
};
export function word(n, noun) {
  const f = NOUNS[noun][lang];
  if (lang === 'ru') {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? f[0] : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? f[1] : f[2];
  }
  if (lang === 'en') return n === 1 ? f[0] : f[1];
  return f[0];
}
export const tn = (n, noun) => `${num(n)} ${word(n, noun)}`;

const nfCache = {};
export const num = n => (nfCache[lang] ||= new Intl.NumberFormat(LOCALES[lang])).format(n);
export const money = uzs => `${num(uzs)} ${t('сум')}`;

const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const RU_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const UZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Дата YYYY-MM-DD в виде «2 октября 2026» / «2-oktabr, 2026» / «2 October 2026». */
export function date(iso, { year = true, short = false } = {}) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (lang === 'ru') return `${d} ${(short ? RU_SHORT : RU_MONTHS)[m - 1]}${year ? ' ' + y : ''}`;
  if (lang === 'uz') { const mn = short ? UZ_MONTHS[m - 1].slice(0, 3) : UZ_MONTHS[m - 1]; return `${d}-${mn}${year ? ', ' + y : ''}`; }
  const mn = short ? EN_MONTHS[m - 1].slice(0, 3) : EN_MONTHS[m - 1];
  return `${d} ${mn}${year ? ' ' + y : ''}`;
}
export const monthShort = m => lang === 'ru' ? RU_SHORT[m] : lang === 'uz' ? UZ_MONTHS[m].slice(0, 3) : EN_MONTHS[m].slice(0, 3);

/** Тексты челленджа на текущем языке (с запасным русским). */
export function localize(c) {
  if (!c) return c;
  const base = c.content?.ru || {};
  const tr = c.content?.[lang] || {};
  const pick = k => (tr[k] && (!Array.isArray(tr[k]) || tr[k].length) ? tr[k] : base[k]);
  const phases = (base.phases || tr.phases || []).map((p, i) => ({
    title: tr.phases?.[i]?.title || p.title,
    tasks: p.tasks.map((task, j) => tr.phases?.[i]?.tasks?.[j] || task)
  }));
  const anyLang = c.content?.[lang] ? c.content[lang] : (c.content?.ru || Object.values(c.content || {})[0] || {});
  return { ...c, title: pick('title') || anyLang.title || c.title || '', short: pick('short') || anyLang.short || '', goal: pick('goal') || anyLang.goal || '',
    rules: pick('rules') || anyLang.rules || [], phases: phases.length ? phases : (anyLang.phases || []) };
}

/** Префикс адреса для языка: '' для русского, 'uz/' и 'en/' для остальных. */
export const langPrefix = l => (l === 'ru' ? '' : l + '/');
