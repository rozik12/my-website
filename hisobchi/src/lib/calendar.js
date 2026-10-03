// Ключевые сроки по НК РУз. Если срок выпадает на выходной или праздник,
// он переносится на следующий рабочий день (ст. 10 НК РУз).
export const DEADLINE_RULES = [
  {
    id: 'payroll',
    day: 15,
    months: 'all',
    title: 'НДФЛ, соц. налог и ИНПС',
    description: 'Расчёт и уплата за прошлый месяц по зарплате сотрудников',
    tag: 'Зарплата',
    color: 'emerald',
  },
  {
    id: 'vat',
    day: 20,
    months: 'all',
    title: 'НДС',
    description: 'Декларация и уплата за прошлый месяц (для плательщиков НДС)',
    tag: 'НДС',
    color: 'sky',
  },
  {
    id: 'turnover',
    day: 15,
    months: [0, 3, 6, 9],
    title: 'Налог с оборота',
    description: 'Расчёт и уплата за прошедший квартал',
    tag: 'Квартал',
    color: 'amber',
  },
  {
    id: 'income-declaration',
    day: 1,
    months: [3],
    title: 'Декларация о доходах физлица',
    description: 'Годовая декларация за прошлый год (если обязаны подавать)',
    tag: 'Год',
    color: 'violet',
  },
];

// Фиксированные нерабочие праздничные дни [месяц (0-11), число].
// Рамазан и Курбан хайит плавающие — их нужно сверять отдельно.
const FIXED_HOLIDAYS = [
  [0, 1],
  [2, 8],
  [2, 21],
  [4, 9],
  [8, 1],
  [9, 1],
  [11, 8],
];

export function isNonWorkingDay(date) {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return true;
  return FIXED_HOLIDAYS.some(([m, d]) => date.getMonth() === m && date.getDate() === d);
}

export function shiftToWorkingDay(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  while (isNonWorkingDay(d)) d.setDate(d.getDate() + 1);
  return d;
}

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export function deadlinesForMonth(year, month) {
  return DEADLINE_RULES.filter((r) => r.months === 'all' || r.months.includes(month))
    .map((rule) => {
      const nominal = new Date(year, month, rule.day);
      const date = shiftToWorkingDay(nominal);
      return { ...rule, nominal, date, shifted: date.getTime() !== nominal.getTime() };
    })
    .sort((a, b) => a.date - b.date);
}

export function upcomingDeadlines(today = new Date(), count = 5) {
  const from = startOfDay(today);
  const result = [];
  let y = from.getFullYear();
  let m = from.getMonth();
  for (let i = 0; i < 14 && result.length < count; i += 1) {
    for (const d of deadlinesForMonth(y, m)) {
      if (d.date >= from && result.length < count) {
        result.push({ ...d, daysLeft: Math.round((d.date - from) / 86_400_000) });
      }
    }
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return result.sort((a, b) => a.date - b.date);
}

const escapeText = (text) => String(text).replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n');

// RFC 5545 §3.1: lines longer than 75 octets are folded (CRLF + space), without splitting UTF-8 characters.
export function foldLine(line) {
  const encoder = new TextEncoder();
  const parts = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const pad = (n) => String(n).padStart(2, '0');
const icsDate = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

export function buildIcs(today = new Date(), months = 12) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hisobchi//Tax Calendar UZ//RU', 'CALSCALE:GREGORIAN'];
  const from = startOfDay(today);
  for (let i = 0; i < months; i += 1) {
    const ref = new Date(from.getFullYear(), from.getMonth() + i, 1);
    for (const d of deadlinesForMonth(ref.getFullYear(), ref.getMonth())) {
      if (d.date < from) continue;
      const end = new Date(d.date);
      end.setDate(end.getDate() + 1);
      lines.push(
        'BEGIN:VEVENT',
        `UID:${d.id}-${icsDate(d.date)}@hisobchi`,
        `DTSTAMP:${icsDate(from)}T000000Z`,
        `DTSTART;VALUE=DATE:${icsDate(d.date)}`,
        `DTEND;VALUE=DATE:${icsDate(end)}`,
        `SUMMARY:${escapeText(`${d.title} — срок`)}`,
        `DESCRIPTION:${escapeText(d.description)}`,
        'BEGIN:VALARM',
        'TRIGGER:-P2D',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText(`Через 2 дня: ${d.title}`)}`,
        'END:VALARM',
        'END:VEVENT',
      );
    }
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
