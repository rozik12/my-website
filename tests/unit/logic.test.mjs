import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentDay, streak, bestStreak, dayTasks, progressPct, xpSummary, badges, startStatus, summarize, activityByDate, passwordProblems, EMAIL_RE, diffDays, addDaysIso, isoInTz } from '../../src/js/lib/logic.js';

test('currentDay: день программы ограничен 1…days', () => {
  assert.equal(currentDay('2026-10-01', 30, '2026-10-01'), 1);
  assert.equal(currentDay('2026-10-01', 30, '2026-10-10'), 10);
  assert.equal(currentDay('2026-10-01', 7, '2026-12-01'), 7);
  assert.equal(currentDay('2026-10-05', 7, '2026-10-01'), 1);
});

test('дни считаются корректно через переход на летнее время и конец года', () => {
  assert.equal(diffDays('2026-03-28', '2026-03-30'), 2);
  assert.equal(diffDays('2026-12-31', '2027-01-01'), 1);
  assert.equal(addDaysIso('2026-02-28', 1), '2026-03-01');
  assert.equal(addDaysIso('2028-02-28', 1), '2028-02-29');
});

test('isoInTz учитывает часовой пояс', () => {
  const d = new Date('2026-10-01T20:30:00Z');
  assert.equal(isoInTz(d, 'UTC'), '2026-10-01');
  assert.equal(isoInTz(d, 'Asia/Tashkent'), '2026-10-02');
});

test('streak: серия до сегодняшнего или вчерашнего дня', () => {
  assert.equal(streak([1, 2, 3], 3), 3);
  assert.equal(streak([1, 2, 3], 4), 3, 'сегодня еще не отмечено — серия не сгорает');
  assert.equal(streak([1, 2, 3], 5), 0, 'пропущен вчерашний день');
  assert.equal(streak([1, 3, 4], 4), 2);
  assert.equal(streak([], 1), 0);
});

test('bestStreak: самая длинная серия', () => {
  assert.equal(bestStreak([1, 2, 3, 5, 6, 7, 8, 10]), 4);
  assert.equal(bestStreak([]), 0);
  assert.equal(bestStreak([3, 1, 2, 2]), 3);
});

test('dayTasks: задание на каждый день, фазы по порядку', () => {
  const c = { days: 10, phases: [{ title: 'A', tasks: ['a1', 'a2'] }, { title: 'B', tasks: ['b1'] }] };
  const t = dayTasks(c);
  assert.equal(t.length, 10);
  assert.deepEqual(t.slice(0, 3).map(x => x.task), ['a1', 'a2', 'a1']);
  assert.equal(t[5].phase, 'B');
  assert.ok(t.every((x, i) => x.day === i + 1 && x.task));
});

test('progressPct и опыт', () => {
  assert.equal(progressPct(15, 30), 50);
  assert.equal(progressPct(40, 30), 100);
  const x = xpSummary({ checkins: 50, finished: [{ days: 30 }] });
  assert.equal(x.xp, 50 * 10 + 250 + 150);
  assert.equal(x.level, 1);
  assert.equal(x.toNext, 100);
});

test('badges: прогресс к цели не превышает цель', () => {
  const b = badges({ totalCheckins: 150, bestStreak: 8, active: 1, finished: 0, finishedHard: 0 });
  const by = Object.fromEntries(b.map(x => [x.title, x]));
  assert.equal(by['Сотня'].earned, true);
  assert.equal(by['Сотня'].value, 100);
  assert.equal(by['Неделя огня'].earned, true);
  assert.equal(by['Финишер'].earned, false);
});

test('startStatus', () => {
  assert.equal(startStatus(null, '2026-10-01').kind, 'rolling');
  assert.equal(startStatus('2026-09-01', '2026-10-01').kind, 'rolling');
  assert.deepEqual(startStatus('2026-10-05', '2026-10-01'), { kind: 'soon', days: 4 });
  assert.equal(startStatus('2026-11-05', '2026-10-01').kind, 'later');
});

test('summarize: активные, завершенные, статистика', () => {
  const catalog = [{ slug: 'a', days: 10, level: 'easy' }, { slug: 'b', days: 7, level: 'hard' }];
  const enr = [
    { slug: 'a', startDate: '2026-10-01', status: 'active', checkins: [1, 2, 3, 5].map(day => ({ day })) },
    { slug: 'b', startDate: '2026-08-01', status: 'completed', completedAt: '2026-08-07T10:00:00Z', checkins: [1, 2, 3, 4, 5, 6, 7].map(day => ({ day })) },
    { slug: 'deleted', startDate: '2026-08-01', status: 'active', checkins: [] }
  ];
  const s = summarize(enr, catalog, '2026-10-05');
  assert.equal(s.active.length, 1);
  assert.equal(s.active[0].cur, 5);
  assert.equal(s.active[0].doneToday, true);
  assert.equal(s.active[0].streak, 1);
  assert.equal(s.stats.finished, 1);
  assert.equal(s.stats.finishedHard, 1);
  assert.equal(s.stats.bestStreak, 7);
  assert.equal(s.stats.rate, 80);
  assert.equal(s.stats.totalCheckins, 11);
});

test('activityByDate: дата чекина или вычисленная по дню', () => {
  const m = activityByDate([{ startDate: '2026-10-01', checkins: [{ day: 1 }, { day: 2, date: '2026-10-02' }, { day: 3 }] }, { startDate: '2026-10-02', checkins: [{ day: 1 }] }]);
  assert.deepEqual(m, { '2026-10-01': 1, '2026-10-02': 2, '2026-10-03': 1 });
});

test('валидация почты и пароля совпадает с правилами Supabase', () => {
  assert.ok(EMAIL_RE.test('a.b@site.uz'));
  assert.ok(!EMAIL_RE.test('a@b'));
  assert.ok(!EMAIL_RE.test('a b@site.com'));
  assert.deepEqual(passwordProblems('Demo1234'), []);
  assert.equal(passwordProblems('short').length, 3);
  assert.ok(passwordProblems('Пароль123').some(p => p.includes('латинские')));
});
