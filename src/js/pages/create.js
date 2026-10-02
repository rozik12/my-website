/* Конструктор своего (закрытого) челленджа: для себя, друзей или команды. */
import { api } from '../api/index.js';
import { SITE } from '../content.js';
import { t, tn, localize } from '../i18n/index.js';
import { esc } from '../lib/util.js';
import { icon, catLabel, levelLabel } from '../ui/markup.js';
import { $, $$, href, withBusy, toast } from '../ui/runtime.js';
import { requireLogin } from '../ui/shell.js';
import { track } from '../analytics.js';

const ICONS = ['target', 'flame', 'dumbbell', 'footprints', 'book-open', 'brain', 'rocket', 'briefcase', 'heart', 'sun', 'moon', 'droplets', 'apple', 'pen-line', 'code', 'music'];
const TEMPLATES = [
  { key: 'habit', label: 'Привычка на 21 день', d: { title: 'Утро без телефона', days: 21, category: 'habits', level: 'easy', icon: 'sun', proof: 'none', short: 'Первые 30 минут после пробуждения — без телефона.', tasks: ['30 минут утром без телефона', 'Стакан воды и короткая зарядка', 'Запишите три дела на день'] } },
  { key: 'sport', label: 'Спорт на 30 дней', d: { title: 'Планка каждый день', days: 30, category: 'sport', level: 'medium', icon: 'dumbbell', proof: 'optional', short: 'Ежедневная планка с постепенным увеличением времени.', tasks: ['Планка 60 секунд', 'Планка 75 секунд', 'Боковая планка 2 × 30 секунд', 'Планка 90 секунд'] } },
  { key: 'team', label: 'Командный спринт на 14 дней', d: { title: 'Спринт отдела продаж', days: 14, category: 'business', level: 'medium', icon: 'briefcase', proof: 'required', short: 'Две недели ежедневной активности с отчетом.', tasks: ['10 звонков клиентам', '5 писем с предложением', 'Встреча или демо с клиентом', 'Отчет в CRM и выводы дня'] } }
];

export async function init() {
  const app = $('#app');
  if (!api.auth.user) return requireLogin(t('Войдите, чтобы создать челлендж'));
  const editSlug = new URLSearchParams(location.search).get('id');
  let d = { title: '', short: '', goal: '', days: 21, category: 'growth', level: 'medium', icon: 'target', proof: 'none', rules: [], tasks: [] };
  if (editSlug) {
    const info = await api.challengeInfo(editSlug).catch(() => null);
    if (!info?.isOwner) { app.innerHTML = `<section class="wrap section"><p class="muted">${t('Редактировать челлендж может только его автор.')}</p></section>`; app.setAttribute('aria-busy', 'false'); return; }
    const c = localize(info);
    d = { title: c.title, short: c.short, goal: c.goal, days: c.days, category: c.category, level: c.level, icon: c.icon, proof: c.proof, rules: c.rules, tasks: c.phases.flatMap(p => p.tasks) };
  }
  const opt = (obj, val, label) => Object.keys(obj).map(k => `<option value="${k}" ${k === val ? 'selected' : ''}>${label(k)}</option>`).join('');
  app.innerHTML = `
  <section class="wrap create">
    ${editSlug ? '' : `<div class="templates"><span class="muted small">${t('Начать с шаблона')}:</span>${TEMPLATES.map(x => `<button class="chip-btn" data-tpl="${x.key}">${t(x.label)}</button>`).join('')}</div>`}
    <form class="card block form" id="create-form" novalidate>
      <label class="field" for="f-title"><span>${t('Название')}</span><input id="f-title" maxlength="80" required value="${esc(d.title)}" placeholder="${t('Например: 30 дней без сахара для отдела')}"></label>
      <label class="field" for="f-short"><span>${t('Коротко о челлендже')}</span><input id="f-short" maxlength="200" value="${esc(d.short)}" placeholder="${t('Одно предложение для карточки')}"></label>
      <label class="field" for="f-goal"><span>${t('Цель')} <span class="muted">(${t('необязательно')})</span></span><textarea id="f-goal" rows="2" maxlength="500">${esc(d.goal)}</textarea></label>
      <div class="form-row form-row-4">
        <label class="field" for="f-days"><span>${t('Дней')}</span><input id="f-days" type="number" min="1" max="100" value="${d.days}"></label>
        <label class="field" for="f-cat"><span>${t('Категория')}</span><select id="f-cat" class="select-input">${opt(SITE.categories, d.category, catLabel)}</select></label>
        <label class="field" for="f-level"><span>${t('Сложность')}</span><select id="f-level" class="select-input">${opt(SITE.levels, d.level, levelLabel)}</select></label>
        <label class="field" for="f-proof"><span>${t('Подтверждение')}</span><select id="f-proof" class="select-input">
          <option value="none" ${d.proof === 'none' ? 'selected' : ''}>${t('Не нужно')}</option><option value="optional" ${d.proof === 'optional' ? 'selected' : ''}>${t('По желанию')}</option><option value="required" ${d.proof === 'required' ? 'selected' : ''}>${t('Обязательно: фото или ссылка')}</option></select></label>
      </div>
      <fieldset class="icon-pick"><legend class="field-label">${t('Иконка')}</legend>${ICONS.map(ic => `<label class="icon-opt"><input type="radio" name="icon" value="${ic}" ${ic === d.icon ? 'checked' : ''}><span title="${ic}">${icon(ic)}</span></label>`).join('')}</fieldset>
      <label class="field" for="f-tasks"><span>${t('Задания по дням — по одному в строке')}</span><textarea id="f-tasks" rows="7" placeholder="${t('День 1: …\nДень 2: …')}">${esc(d.tasks.join('\n'))}</textarea>
        <span class="muted small" id="tasks-info"></span></label>
      <label class="field" for="f-rules"><span>${t('Правила — по одному в строке')} <span class="muted">(${t('необязательно')})</span></span><textarea id="f-rules" rows="3">${esc((d.rules || []).join('\n'))}</textarea></label>
      <p class="form-error" id="f-err" role="alert" hidden></p>
      <div class="cta-row"><button class="btn btn-primary btn-lg" type="submit" data-busy="${t('Сохраняем…')}">${icon(editSlug ? 'save' : 'rocket')}${editSlug ? t('Сохранить изменения') : t('Создать и получить код')}</button>
        <a class="btn btn-ghost btn-lg" href="${href('/dashboard/my/')}">${t('Отмена')}</a></div>
      <p class="muted small">${t('Челлендж будет закрытым: участники вступают по коду приглашения, а вы видите их прогресс в отчете организатора.')}</p>
    </form>
  </section>`;
  app.setAttribute('aria-busy', 'false');

  const info = () => {
    const n = $('#f-tasks').value.split('\n').map(s => s.trim()).filter(Boolean).length, days = +$('#f-days').value || 0;
    $('#tasks-info').textContent = !n ? t('Добавьте хотя бы одно задание') : n >= days ? t('Заданий: {n} — по одному на каждый день', { n }) : t('Заданий: {n}. Они будут повторяться по кругу на все {days}', { n, days: tn(days, 'день') });
  };
  $('#f-tasks').addEventListener('input', info); $('#f-days').addEventListener('input', info); info();
  $$('[data-tpl]').forEach(b => b.addEventListener('click', () => {
    const x = TEMPLATES.find(tp => tp.key === b.dataset.tpl).d;
    $('#f-title').value = t(x.title); $('#f-short').value = t(x.short); $('#f-days').value = x.days; $('#f-cat').value = x.category; $('#f-level').value = x.level; $('#f-proof').value = x.proof;
    $(`input[name=icon][value="${x.icon}"]`).checked = true; $('#f-tasks').value = x.tasks.map(s => t(s)).join('\n'); info();
  }));
  $('#create-form').addEventListener('submit', e => {
    e.preventDefault();
    const err = $('#f-err'), fail = m => { err.textContent = m; err.hidden = false; };
    const data = {
      title: $('#f-title').value.trim(), short: $('#f-short').value.trim(), goal: $('#f-goal').value.trim(), days: +$('#f-days').value,
      category: $('#f-cat').value, level: $('#f-level').value, proof: $('#f-proof').value, icon: $('input[name=icon]:checked').value,
      tasks: $('#f-tasks').value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 100), rules: $('#f-rules').value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 10)
    };
    if (data.title.length < 3) return fail(t('Название: от 3 до 80 символов'));
    if (!(data.days >= 1 && data.days <= 100)) return fail(t('Длительность: от 1 до 100 дней'));
    if (!data.tasks.length) return fail(t('Добавьте от 1 до 100 заданий'));
    withBusy($('#create-form button[type=submit]'), async () => {
      try {
        const slug = await api.saveMyChallenge(editSlug, data);
        if (!editSlug) { await api.join(slug).catch(() => {}); track('create_challenge', { days: data.days }); }
        toast(editSlug ? t('Изменения сохранены') : t('Челлендж создан! Отправьте участникам код приглашения.'));
        location.href = href(`/c/?id=${slug}`);
      } catch (x) { fail(t(x.message)); }
    });
  });
}
