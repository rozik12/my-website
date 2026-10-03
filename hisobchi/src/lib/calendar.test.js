import { describe, expect, it } from 'vitest';
import { buildIcs, foldLine, deadlinesForMonth, shiftToWorkingDay, upcomingDeadlines } from './calendar.js';

describe('calendar', () => {
  it('shifts weekend deadlines to Monday', () => {
    // 15 Nov 2026 is a Sunday
    expect(shiftToWorkingDay(new Date(2026, 10, 15))).toEqual(new Date(2026, 10, 16));
  });

  it('skips holidays', () => {
    // 1 Jan 2027 is a Friday (holiday) -> Monday 4 Jan
    expect(shiftToWorkingDay(new Date(2027, 0, 1))).toEqual(new Date(2027, 0, 4));
  });

  it('includes quarterly turnover tax only in quarter-following months', () => {
    expect(deadlinesForMonth(2026, 9).some((d) => d.id === 'turnover')).toBe(true);
    expect(deadlinesForMonth(2026, 10).some((d) => d.id === 'turnover')).toBe(false);
  });

  it('returns sorted upcoming deadlines with days left', () => {
    const list = upcomingDeadlines(new Date(2026, 9, 3), 4);
    expect(list).toHaveLength(4);
    expect(list[0].id).toMatch(/payroll|turnover/);
    expect(list[0].daysLeft).toBe(12);
    for (let i = 1; i < list.length; i += 1) expect(list[i].date >= list[i - 1].date).toBe(true);
  });

  it('builds a valid ics file', () => {
    const ics = buildIcs(new Date(2026, 9, 3), 2);
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g).length).toBeGreaterThan(2);
  });

  it('escapes text, folds long lines and ends with CRLF', () => {
    const ics = buildIcs(new Date(2026, 9, 3), 2);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('SUMMARY:НДФЛ\\, соц. налог и ИНПС — срок');
    const enc = new TextEncoder();
    for (const line of ics.split('\r\n')) expect(enc.encode(line).length).toBeLessThanOrEqual(75);
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('DESCRIPTION:Расчёт и уплата за прошлый месяц по зарплате сотрудников');
  });

  it('folds without splitting multibyte characters', () => {
    const folded = foldLine('DESCRIPTION:' + 'ж'.repeat(100));
    expect(folded.replace(/\r\n /g, '')).toBe('DESCRIPTION:' + 'ж'.repeat(100));
  });
});
