import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collectKeys } from '../../scripts/i18n-keys.mjs';
import uz from '../../src/js/i18n/uz.js';
import en from '../../src/js/i18n/en.js';
import { setLang, t, tn, date, money, localize } from '../../src/js/i18n/index.js';

const keys = await collectKeys();
const params = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

for (const [name, dict] of [['uz', uz], ['en', en]]) {
  test(`${name}: перевод есть для каждой строки интерфейса`, () => {
    const miss = keys.filter(k => !(k in dict));
    assert.deepEqual(miss, []);
  });
  test(`${name}: параметры {x} совпадают с исходной строкой`, () => {
    const bad = Object.entries(dict).filter(([k, v]) => !v || params(k) !== params(v)).map(([k]) => k);
    assert.deepEqual(bad, []);
  });
  test(`${name}: нет кириллицы в переводе`, () => {
    assert.deepEqual(Object.entries(dict).filter(([, v]) => /[А-Яа-яЁё]/.test(v)).map(([k]) => k), []);
  });
}

test('склонения и даты на трех языках', () => {
  setLang('ru'); assert.equal(tn(21, 'день'), '21 день'); assert.equal(tn(3, 'день'), '3 дня'); assert.equal(tn(11, 'день'), '11 дней');
  assert.equal(date('2026-10-02'), '2 октября 2026');
  setLang('en'); assert.equal(tn(1, 'день'), '1 day'); assert.equal(tn(5, 'день'), '5 days'); assert.equal(date('2026-10-02'), '2 October 2026');
  setLang('uz'); assert.equal(tn(5, 'день'), '5 kun'); assert.equal(date('2026-10-02'), '2-oktabr, 2026'); assert.equal(t('Войти'), 'Kirish');
  assert.match(money(49000), /49.000 soʻm/);
  setLang('ru');
});

test('каталог: у каждого челленджа есть uz и en с той же структурой', async () => {
  const list = JSON.parse(await readFile(new URL('../../content/challenges.json', import.meta.url), 'utf8'));
  assert.ok(list.length >= 20);
  for (const c of list) for (const l of ['uz', 'en']) {
    const ru = c.content.ru, tr = c.content[l];
    assert.ok(tr, `${c.slug}: нет ${l}`);
    assert.equal(tr.rules.length, ru.rules.length, `${c.slug}/${l} rules`);
    assert.deepEqual(tr.phases.map(p => p.tasks.length), ru.phases.map(p => p.tasks.length), `${c.slug}/${l} phases`);
    setLang(l); assert.equal(localize(c).title, tr.title);
  }
  setLang('ru');
});
