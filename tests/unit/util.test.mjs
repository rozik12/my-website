import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, link, initials } from '../../src/js/lib/util.js';

test('esc экранирует HTML', () => {
  assert.equal(esc('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
});

test('link: относительные ссылки для любых хостингов', () => {
  assert.equal(link('/', ''), './');
  assert.equal(link('/challenges/run-100/', '../'), '../challenges/run-100/');
  assert.equal(link('/challenges/', '../../', true), '../../challenges/index.html');
  assert.equal(link('/', '../', true), '../index.html');
  assert.equal(link('/#how', '../'), '../#how');
  assert.equal(link('/404.html', '/'), '/404.html');
});

test('initials', () => {
  assert.equal(initials('алексей смирнов'), 'АС');
});
