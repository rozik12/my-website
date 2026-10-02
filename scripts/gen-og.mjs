#!/usr/bin/env node
/* Генерирует картинку для соцсетей (src/assets/og.png, 1200×630) и иконки приложения (src/assets/icons/*.png). Запуск: npm run og */
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cells = Array.from({ length: 30 }, (_, i) => `<span style="aspect-ratio:1;border-radius:8px;background:${i < 17 && i !== 6 ? '#10B981' : i === 6 ? 'rgba(244,63,94,.25)' : i === 17 ? 'rgba(59,130,246,.25)' : 'rgba(148,163,184,.12)'};${i === 17 ? 'outline:3px solid #60A5FA;outline-offset:-3px;' : ''}"></span>`).join('');
const og = `<html><body style="margin:0;width:1200px;height:630px;background:radial-gradient(900px 500px at 90% -10%,rgba(59,130,246,.35),transparent 60%),#0F172A;font-family:system-ui,sans-serif;color:#F1F5F9;display:flex;align-items:center;padding:0 80px;box-sizing:border-box;gap:60px">
<div style="flex:1"><div style="display:flex;align-items:flex-end;gap:6px;height:44px;margin-bottom:28px"><i style="width:12px;height:18px;background:#3B82F6;opacity:.55;border-radius:3px"></i><i style="width:12px;height:30px;background:#3B82F6;opacity:.8;border-radius:3px"></i><i style="width:12px;height:44px;background:#10B981;border-radius:3px"></i><b style="font-size:34px;margin-left:12px">Рубикон</b></div>
<div style="font-size:64px;font-weight:700;line-height:1.08;letter-spacing:-1px">Доведите цель до финиша.<br><span style="color:#60A5FA">День за днём.</span></div>
<div style="font-size:26px;color:#94A3B8;margin-top:24px">Челленджи и марафоны с планом по дням</div></div>
<div style="width:330px;padding:26px;border-radius:24px;background:rgba(30,41,59,.7);border:1px solid rgba(148,163,184,.2)"><div style="font-size:22px;font-weight:600;margin-bottom:16px">30 дней холодного душа</div>
<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px">${cells}</div></div></body></html>`;
const iconHtml = (size, pad) => `<html><body style="margin:0;width:${size}px;height:${size}px;background:#0F172A;display:grid;place-items:center">
<div style="display:flex;align-items:flex-end;gap:${size * 0.04}px;height:${size * (1 - pad * 2) * 0.62}px">
<i style="width:${size * 0.13}px;height:40%;background:#3B82F6;opacity:.6;border-radius:${size * 0.03}px"></i>
<i style="width:${size * 0.13}px;height:70%;background:#3B82F6;opacity:.85;border-radius:${size * 0.03}px"></i>
<i style="width:${size * 0.13}px;height:100%;background:#10B981;border-radius:${size * 0.03}px"></i></div></body></html>`;
const b = await chromium.launch();
const shot = async (html, w, h, file) => { const p = await b.newPage({ viewport: { width: w, height: h } }); await p.setContent(html); await p.screenshot({ path: file }); await p.close(); };
await mkdir(path.join(ROOT, 'src/assets/icons'), { recursive: true });
await shot(og, 1200, 630, path.join(ROOT, 'src/assets/og.png'));
await shot(iconHtml(192, 0.12), 192, 192, path.join(ROOT, 'src/assets/icons/icon-192.png'));
await shot(iconHtml(512, 0.12), 512, 512, path.join(ROOT, 'src/assets/icons/icon-512.png'));
await shot(iconHtml(512, 0.22), 512, 512, path.join(ROOT, 'src/assets/icons/maskable-512.png'));
await b.close();
console.log('✓ og.png и иконки приложения');
