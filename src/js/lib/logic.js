/* Чистая доменная логика: без DOM и сети, покрыта юнит-тестами (tests/unit/logic.test.mjs). */

export const DAY_MS = 86400000;

/** Дата YYYY-MM-DD в заданном часовом поясе (по умолчанию — пояс браузера). */
export function isoInTz(date = new Date(), timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Разница в календарных днях между двумя датами YYYY-MM-DD. */
export function diffDays(fromIso, toIso) {
  return Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / DAY_MS);
}

export function addDaysIso(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Текущий день программы (1…days) для участника, начавшего startIso. */
export function currentDay(startIso, days, todayIso) {
  return Math.max(1, Math.min(days, diffDays(startIso, todayIso) + 1));
}

/** Серия: подряд выполненные дни, заканчивая сегодняшним или вчерашним. */
export function streak(doneDays, cur) {
  const set = new Set(doneDays);
  let d = set.has(cur) ? cur : cur - 1;
  let s = 0;
  while (d > 0 && set.has(d)) { s++; d--; }
  return s;
}

/** Самая длинная серия за всю программу. */
export function bestStreak(doneDays) {
  const sorted = [...new Set(doneDays)].sort((a, b) => a - b);
  let best = 0, run = 0, prev = null;
  for (const d of sorted) { run = prev !== null && d === prev + 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  return best;
}

export function progressPct(doneCount, days) {
  return days > 0 ? Math.min(100, Math.round(doneCount / days * 100)) : 0;
}

/** Раскладка заданий по дням из фаз программы. */
export function dayTasks(challenge) {
  const { days, phases } = challenge;
  const per = Math.ceil(days / phases.length);
  const list = [];
  for (let d = 1; d <= days; d++) {
    const pi = Math.min(phases.length - 1, Math.floor((d - 1) / per));
    const ph = phases[pi];
    list.push({ day: d, phase: ph.title, phaseIndex: pi, task: ph.tasks[((d - 1) - pi * per) % ph.tasks.length] });
  }
  return list;
}

/** Опыт и уровень. 1000 XP на уровень. */
export const XP = { checkin: 10, finish: 250, perProgramDay: 5, perLevel: 1000 };

export function xpSummary({ checkins, finished }) {
  // finished: массив { days }
  const xp = checkins * XP.checkin + finished.reduce((s, f) => s + XP.finish + f.days * XP.perProgramDay, 0);
  const level = Math.floor(xp / XP.perLevel) + 1;
  return { xp, level, levelPct: Math.round((xp % XP.perLevel) / XP.perLevel * 100), toNext: XP.perLevel - xp % XP.perLevel };
}

export const LEVEL_TITLES = ['Новичок', 'Практик', 'Стайер', 'Марафонец', 'Мастер', 'Легенда'];
export const levelTitle = level => LEVEL_TITLES[Math.min(LEVEL_TITLES.length - 1, level - 1)];

/** Бейджи по агрегированной статистике пользователя. */
export function badges(s) {
  return [
    ['zap', 'Первый шаг', 'Сделайте первый чекин', s.totalCheckins, 1],
    ['flame', 'Неделя огня', '7 дней подряд без пропусков', s.bestStreak, 7],
    ['target', 'Многозадачность', '3 активных челленджа одновременно', s.active, 3],
    ['trophy', 'Финишер', 'Завершите первый челлендж', s.finished, 1],
    ['star', 'Сотня', 'Накопите 100 чекинов', s.totalCheckins, 100],
    ['award', 'Ветеран', 'Завершите 5 челленджей', s.finished, 5],
    ['gem', 'Безупречно', '30 дней подряд без пропусков', s.bestStreak, 30],
    ['mountain', 'Хардкор', 'Завершите челлендж уровня «Хардкор»', s.finishedHard, 1]
  ].map(([icon, title, desc, value, goal]) => ({ icon, title, desc, value: Math.min(value, goal), goal, earned: value >= goal }));
}

/** Статус старта потока относительно сегодняшней даты. */
export function startStatus(nextStart, todayIso) {
  if (!nextStart) return { kind: 'rolling', days: 0 };
  const d = diffDays(todayIso, nextStart);
  if (d <= 0) return { kind: 'rolling', days: 0 };
  return { kind: d <= 7 ? 'soon' : 'later', days: d };
}

/** Агрегирует участия пользователя в статистику кабинета. */
export function summarize(enrollments, catalog, todayIso) {
  const bySlug = Object.fromEntries(catalog.map(c => [c.slug, c]));
  const active = [], finished = [];
  let checkins = 0, elapsed = 0, best = 0, maxCurrent = 0;
  for (const e of enrollments) {
    const c = bySlug[e.slug];
    if (!c) continue;
    const done = e.checkins.map(x => x.day);
    checkins += done.length;
    best = Math.max(best, bestStreak(done));
    if (e.status === 'completed') { finished.push({ ...e, challenge: c, days: c.days }); continue; }
    const cur = currentDay(e.startDate, c.days, todayIso);
    elapsed += cur;
    const st = streak(done, cur);
    maxCurrent = Math.max(maxCurrent, st);
    active.push({ ...e, challenge: c, cur, done, streak: st, pct: progressPct(done.length, c.days), doneToday: done.includes(cur) });
  }
  const activeCheckins = active.reduce((s, a) => s + a.done.length, 0);
  return {
    active, finished,
    stats: {
      active: active.length,
      finished: finished.length,
      finishedHard: finished.filter(f => f.challenge.level === 'hard').length,
      totalCheckins: checkins,
      currentStreak: maxCurrent,
      bestStreak: best,
      rate: elapsed ? Math.round(activeCheckins / elapsed * 100) : 0,
      ...xpSummary({ checkins, finished })
    }
  };
}

/** Количество чекинов по датам { 'YYYY-MM-DD': n } для тепловой карты. */
export function activityByDate(enrollments) {
  const map = {};
  for (const e of enrollments) for (const c of e.checkins) {
    const k = c.date || addDaysIso(e.startDate, c.day - 1);
    map[k] = (map[k] || 0) + 1;
  }
  return map;
}

/* Валидация форм */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function passwordProblems(pw) {
  const p = [];
  if (pw.length < 8) p.push('не меньше 8 символов');
  // Совпадает с правилом Supabase Auth "lower_upper_letters_digits" (латиница)
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) p.push('строчные и заглавные латинские буквы');
  if (!/\d/.test(pw)) p.push('хотя бы одну цифру');
  return p;
}
