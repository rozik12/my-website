import { describe, expect, it } from 'vitest';
import { buildIcs, deadlinesForMonth, shiftToWorkingDay, upcomingDeadlines } from './calendar.js';

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
});
