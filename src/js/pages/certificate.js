/* Сертификат за финиш (публичная страница проверки) и карточки для соцсетей. Картинки рисуются в canvas. */
import { api } from '../api/index.js';
import { SITE } from '../content.js';
import { t, tn, date, localize } from '../i18n/index.js';
import { esc } from '../lib/util.js';
import { icon, empty } from '../ui/markup.js';
import { $, href, toast, copyText, Modal } from '../ui/runtime.js';

const C = { bg: '#0F172A', card: '#162036', fg: '#F1F5F9', muted: '#94A3B8', blue: '#3B82F6', blue2: '#60A5FA', green: '#10B981', amber: '#F59E0B' };
const FONT = (w, s, fam = "'Onest', 'Segoe UI', system-ui, sans-serif") => `${w} ${s}px ${fam}`;
const DISPLAY = "'Unbounded', 'Segoe UI', system-ui, sans-serif";

function wrap(g, text, x, y, maxW, lh, maxLines = 3) {
  const words = String(text).split(/\s+/); let line = '', lines = [];
  for (const w of words) { const test = line ? line + ' ' + w : w; if (g.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test; }
  if (line) lines.push(line);
  lines = lines.slice(0, maxLines);
  lines.forEach((l, i) => g.fillText(l, x, y + i * lh));
  return lines.length * lh;
}
function logo(g, x, y, s) {
  [[0.55, 0.4], [0.85, 0.7], [1, 1]].forEach(([op, h], i) => { g.globalAlpha = op; g.fillStyle = i === 2 ? C.green : C.blue; g.beginPath(); g.roundRect(x + i * s * 0.38, y + s * (1 - h), s * 0.26, s * h, s * 0.06); g.fill(); });
  g.globalAlpha = 1;
}

export async function drawCertificate(d) {
  await document.fonts?.ready;
  const W = 1600, H = 1130, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
  const grad = g.createRadialGradient(W * 0.85, -100, 50, W * 0.85, -100, 900); grad.addColorStop(0, 'rgba(59,130,246,.35)'); grad.addColorStop(1, 'rgba(59,130,246,0)');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(148,163,184,.25)'; g.lineWidth = 2; g.beginPath(); g.roundRect(40, 40, W - 80, H - 80, 28); g.stroke();
  g.strokeStyle = C.blue; g.lineWidth = 6; g.beginPath(); g.moveTo(120, 40); g.lineTo(420, 40); g.stroke();
  logo(g, 120, 120, 56); g.fillStyle = C.fg; g.font = FONT(700, 34, DISPLAY); g.fillText(t(SITE.name), 200, 166);
  g.fillStyle = C.blue2; g.font = FONT(600, 22); g.fillText(t('СЕРТИФИКАТ О ПРОХОЖДЕНИИ').split('').join(String.fromCharCode(8202)), 120, 290);
  g.fillStyle = C.fg; g.font = FONT(700, 74, DISPLAY); wrap(g, d.name, 120, 390, W - 240, 84, 1);
  g.fillStyle = C.muted; g.font = FONT(400, 30); g.fillText(t('успешно прошел(ла) челлендж'), 120, 460);
  g.fillStyle = C.fg; g.font = FONT(700, 54, DISPLAY); const h = wrap(g, '«' + d.title + '»', 120, 550, W - 240, 66, 2);
  const y = 550 + h + 40;
  g.font = FONT(500, 28); g.fillStyle = C.muted;
  const facts = [[t('Длительность'), tn(d.days, 'день')], [t('Отметок'), String(d.checkins)], [t('Финиш'), date(d.completedAt.slice(0, 10))]];
  facts.forEach(([k, v], i) => { const x = 120 + i * 440; g.fillStyle = C.muted; g.font = FONT(500, 24); g.fillText(k, x, y); g.fillStyle = C.green; g.font = FONT(700, 40, DISPLAY); g.fillText(v, x, y + 52); });
  g.fillStyle = 'rgba(148,163,184,.2)'; g.fillRect(120, H - 190, W - 240, 2);
  g.fillStyle = C.muted; g.font = FONT(400, 22);
  g.fillText(`${t('Проверить подлинность')}: ${d.verifyUrl}`, 120, H - 135);
  g.fillText(`ID ${d.id}`, 120, H - 100);
  // печать
  g.save(); g.translate(W - 230, H - 330); g.strokeStyle = C.amber; g.lineWidth = 4; g.beginPath(); g.arc(0, 0, 92, 0, Math.PI * 2); g.stroke();
  g.setLineDash([4, 8]); g.beginPath(); g.arc(0, 0, 76, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  g.fillStyle = C.amber; g.font = FONT(700, 54, DISPLAY); g.textAlign = 'center'; g.fillText('✓', 0, 18); g.restore();
  return cv;
}

export async function drawStreakCard(d) {
  await document.fonts?.ready;
  const S = 1080, cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = C.bg; g.fillRect(0, 0, S, S);
  const grad = g.createRadialGradient(S, 0, 50, S, 0, 900); grad.addColorStop(0, 'rgba(245,158,11,.3)'); grad.addColorStop(1, 'rgba(245,158,11,0)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  logo(g, 90, 90, 48); g.fillStyle = C.fg; g.font = FONT(700, 30, DISPLAY); g.fillText(t(SITE.name), 160, 132);
  g.fillStyle = C.amber; g.font = FONT(700, 220, DISPLAY); g.fillText(String(d.streak), 90, 470);
  g.fillStyle = C.fg; g.font = FONT(700, 54, DISPLAY); g.fillText(t('дней подряд'), 90, 550);
  g.fillStyle = C.muted; g.font = FONT(400, 34); wrap(g, t('в челлендже «{title}»', { title: d.title }), 90, 620, S - 180, 44, 2);
  // сетка дней
  const cols = Math.min(d.days, 15), cell = Math.floor((S - 180 - (cols - 1) * 10) / cols), rows = Math.ceil(d.days / cols);
  for (let i = 0; i < d.days; i++) {
    const x = 90 + (i % cols) * (cell + 10), yy = 760 + Math.floor(i / cols) * (cell + 10);
    if (yy + cell > S - 90) break;
    g.fillStyle = i < d.day && i >= d.day - d.streak ? C.green : i < d.day ? 'rgba(16,185,129,.35)' : 'rgba(148,163,184,.12)';
    g.beginPath(); g.roundRect(x, yy, cell, cell, 8); g.fill();
  }
  g.fillStyle = C.muted; g.font = FONT(500, 26); g.fillText(`${d.name} · ${t('день {n} из {total}', { n: d.day, total: d.days })}`, 90, S - 60 + (rows > 2 ? 0 : 0));
  return cv;
}

const toBlob = cv => new Promise(r => cv.toBlob(r, 'image/png'));
function download(blob, name) { const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click(); a.remove(); }
async function share(blob, name, text, url) {
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], text, url }); return true; } catch { return false; } }
  if (navigator.share) { try { await navigator.share({ text, url }); return true; } catch { return false; } }
  return false;
}

export async function shareStreakCard(d) {
  const cv = await drawStreakCard(d), blob = await toBlob(cv);
  Modal.open({
    title: t('Поделиться серией'), size: 'md',
    body: `<img class="share-preview" src="${URL.createObjectURL(blob)}" alt="${t('Карточка серии')}"><div class="cta-row mt">
      <button class="btn btn-primary" id="sh-share">${icon('share-2')}${t('Поделиться')}</button><button class="btn btn-ghost" id="sh-dl">${icon('download')}${t('Скачать PNG')}</button></div>`,
    onMount: m => {
      $('#sh-dl', m).addEventListener('click', () => download(blob, `rubikon-streak-${d.streak}.png`));
      $('#sh-share', m).addEventListener('click', async () => { if (!await share(blob, 'rubikon-streak.png', t('Серия {n} подряд!', { n: tn(d.streak, 'день') }), location.origin)) download(blob, `rubikon-streak-${d.streak}.png`); });
    }
  });
}

export async function init() {
  const app = $('#app');
  const id = new URLSearchParams(location.search).get('id');
  const d = id ? await api.certificate(id).catch(() => null) : null;
  if (!d) {
    app.innerHTML = `<section class="wrap section">${empty('shield-x', t('Сертификат не найден'), t('Проверьте ссылку: сертификат выдается только за завершенный челлендж.'), `<a class="btn btn-primary" href="${href('/challenges/')}">${t('К каталогу')}</a>`)}</section>`;
    app.setAttribute('aria-busy', 'false');
    return;
  }
  const title = localize({ content: d.title || {}, title: d.titleFallback }).title || d.titleFallback || d.slug;
  const verifyUrl = location.href.split('#')[0];
  const data = { ...d, title, verifyUrl };
  app.innerHTML = `
    <section class="wrap page-head cert-head">
      <p class="eyebrow">${icon('badge-check')}${t('Подлинный сертификат')}</p>
      <h1>${esc(d.name)}</h1>
      <p class="lead">${t('прошел(ла) челлендж «{title}» — {n} отметок за {days}, финиш {date}.', { title: esc(title), n: d.checkins, days: tn(d.days, 'день'), date: date(d.completedAt.slice(0, 10)) })}</p>
      <div class="cta-row">
        <button class="btn btn-primary" id="c-share">${icon('share-2')}${t('Поделиться')}</button>
        <button class="btn btn-ghost" id="c-dl">${icon('download')}${t('Скачать PNG')}</button>
        <button class="btn btn-ghost" id="c-copy">${icon('link')}${t('Скопировать ссылку')}</button>
      </div>
    </section>
    <section class="wrap"><div class="cert-frame card"><canvas id="cert-canvas" class="cert-canvas" role="img" aria-label="${t('Сертификат')}: ${esc(d.name)}, ${esc(title)}"></canvas></div></section>`;
  app.setAttribute('aria-busy', 'false');
  document.title = `${t('Сертификат')} · ${d.name} · ${t(SITE.name)}`;
  const cv = await drawCertificate(data);
  const view = $('#cert-canvas'); view.width = cv.width; view.height = cv.height; view.getContext('2d').drawImage(cv, 0, 0);
  const blob = await toBlob(cv);
  const file = `rubikon-certificate-${d.slug}.png`;
  $('#c-dl').addEventListener('click', () => download(blob, file));
  $('#c-share').addEventListener('click', async () => { if (!await share(blob, file, t('Я прошел(ла) челлендж «{title}» на Рубиконе', { title }), verifyUrl)) toast(await copyText(verifyUrl) ? t('Ссылка скопирована') : verifyUrl); });
  $('#c-copy').addEventListener('click', async () => toast(await copyText(verifyUrl) ? t('Ссылка скопирована') : verifyUrl));
}
