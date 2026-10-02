# Рубикон — платформа челленджей и марафонов

Многоязычный (RU / UZ / EN) сайт с пререндером страниц для SEO и бэкендом на Supabase.

Что есть на платформе:

- Вход по почте с подтверждением, через Google и через Telegram.
- Потоки с общим стартом и чатом.
- Лента с реакциями, комментариями и подписками.
- Подтверждение выполнения фото или ссылкой.
- Платные челленджи через Payme и Click.
- Свои закрытые челленджи по коду приглашения, с отчетом организатора и выгрузкой в CSV.
- Сертификаты и карточки серии для соцсетей.
- Админ-панель и модерация.
- PWA: работает офлайн, ставится как приложение.
- Аналитика, которая включается только после согласия на cookie.

```
content/              Каталог (challenges.json: 20 челленджей × 3 языка) и тексты сайта (site.json)
src/js/
  i18n/               Словари uz.js / en.js (ключ — русская строка), склонения, даты
  lib/                Доменная логика (серии, XP, бейджи, даты) — покрыта юнит-тестами
  api/                Клиент Supabase на fetch, боевой бэкенд, демо-бэкенд, офлайн-очередь
  ui/ pages/          Компоненты и страницы (каталог, челлендж, кабинет, лента, админка…)
  analytics.js        Согласие на cookie + Яндекс Метрика / GA4
  monitor.js          Ошибки → таблица error_logs (+ Sentry по желанию)
src/sw.js             Service worker (PWA)
supabase/
  migrations/         Схема, RLS, все RPC (init + platform)
  functions/          Edge Functions: payments, payme, click, telegram-auth, rebuild-site
  templates/          Письма подтверждения и смены пароля
  seed.sql            Каталог (генерируется сборкой из content/challenges.json)
scripts/              Сборка, сервер, иконки, проверка переводов
tests/                unit (node:test), e2e (Playwright), sql (PostgreSQL)
```

## Быстрый старт (демо, без бэкенда)

```bash
npm install
npm run build:demo && npm run serve      # http://localhost:4173
```

В демо-режиме данные хранятся в браузере, а письма и оплата имитируются. Демо-аккаунт `demo@rubikon.app` / `Demo1234` — администратор (страница `/admin/`).

## Запуск в продакшен — по шагам

### 1. Supabase

1. Создайте проект на supabase.com. **Регион выбирайте с учетом требований к данным** (см. «Юридическое» ниже).
2. Примените миграции и каталог:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push                      # supabase/migrations/*
   npm run build                              # перегенерирует supabase/seed.sql
   psql "$DATABASE_URL" -f supabase/seed.sql  # первичный каталог
   ```
3. Откройте **Authentication → URL Configuration**:
   - Site URL: `https://ваш-домен`.
   - Redirect URLs: `https://ваш-домен/auth/callback/`, `https://ваш-домен/uz/auth/callback/`, `https://ваш-домен/en/auth/callback/`, `https://ваш-домен/reset-password/` (и uz/en-варианты).
4. Откройте **Authentication → Email Templates** и вставьте `supabase/templates/confirmation.html` и `recovery.html`.
5. Назначьте себя администратором (после регистрации на сайте):
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'you@example.com');
   ```
6. Storage-бакет `proofs` (для фото-подтверждений) создается миграцией. Проверьте, что он есть в Storage.

### 2. Сборка и хостинг

Скопируйте `.env.example` в `.env` (или переменные окружения хостинга), заполните `SITE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` и выполните `npm run build`. Результат будет в `dist/`.

- **Vercel / Netlify:** конфиги `vercel.json` и `netlify.toml` уже лежат в репозитории.
- Каталог при сборке берется из базы (`CATALOG_SOURCE=db`), то есть из того, что редактируется в админке. Чтобы изменения появились на страницах, нажмите в админке «Пересобрать сайт». Для этого нужен секрет `DEPLOY_HOOK_URL` — Deploy Hook из Vercel или Netlify.

### 3. Edge Functions и секреты

```bash
cp .env.example supabase/.env.functions   # оставьте только секреты функций, раскомментируйте
npx supabase secrets set --env-file supabase/.env.functions
npx supabase functions deploy payments payme click telegram-auth rebuild-site
```

| Функция | Назначение | JWT |
|---|---|---|
| `payments` | создает заказ и возвращает ссылку на оплату Payme/Click | пользователя |
| `payme` | Merchant API Payme (JSON-RPC, Basic-авторизация `Paycom:KEY`) | нет |
| `click` | SHOP API Click (Prepare/Complete, подпись md5) | нет |
| `telegram-auth` | обмен кода Telegram OIDC на сессию Supabase | нет |
| `rebuild-site` | вызывает Deploy Hook (только админ) | пользователя |

### 4. Оплата: Payme и Click

Сначала нужно заключить договор и получить кабинет мерчанта: Payme Business и Click Merchant. Это делает владелец бизнеса (ИП или юрлицо в Узбекистане).

**Payme** (кабинет business.paycom.uz):

1. В поле «Endpoint URL» укажите `https://<ref>.supabase.co/functions/v1/payme`.
2. Поле счета (account) назовите `order_id`.
3. Добавьте секреты: `PAYME_MERCHANT_ID` и `PAYME_KEY` (для тестов — тестовый ключ и `PAYME_TEST=1`, оплата пойдет через checkout.test.paycom.uz).
4. Пройдите все сценарии в песочнице Payme (test.paycom.uz). Без этого вас не переведут в боевой режим.
5. Уберите `PAYME_TEST` и поставьте боевой ключ.

**Click** (кабинет merchant.click.uz):

1. В полях Prepare URL и Complete URL укажите `https://<ref>.supabase.co/functions/v1/click`.
2. Добавьте секреты: `CLICK_SERVICE_ID`, `CLICK_MERCHANT_ID`, `CLICK_SECRET_KEY`.

Суммы хранятся в сумах (`price_uzs`), Payme получает их в тийинах. Доступ к платному челленджу открывается только после подтверждения оплаты от платежной системы (`mark_order_paid` в SQL). Повторы и отмены обрабатываются идемпотентно. Все это покрыто тестами в `tests/sql/test_v2.sql` и `tests/unit/edge.test.mjs`.

### 5. Вход через Google

1. В Google Cloud Console откройте **APIs & Services → Credentials** и создайте OAuth Client ID типа «Web application».
2. В Authorized redirect URI укажите `https://<ref>.supabase.co/auth/v1/callback`.
3. В Supabase откройте **Authentication → Providers → Google**, включите провайдер и вставьте Client ID и Secret.
4. На OAuth consent screen укажите домен, политику конфиденциальности (`/privacy/`) и отправьте приложение на проверку.

### 6. Вход через Telegram

1. В @BotFather выполните `/newbot`, затем откройте **Bot Settings → Web Login**:
   - Укажите домен сайта.
   - Allowed redirect URI: `https://ваш-домен/auth/telegram/`.
   - Получите Client ID и Client Secret.
2. Пропишите `TELEGRAM_CLIENT_ID` в переменных сборки, а `TELEGRAM_CLIENT_ID`, `TELEGRAM_CLIENT_SECRET` и `SITE_URL` — в секретах функций.

Как это работает: браузер проходит OIDC с PKCE, функция `telegram-auth` проверяет `id_token` по JWKS Telegram, создает или находит пользователя и выдает одноразовую ссылку входа Supabase.

### 7. Почта со своего домена (SMTP)

Встроенная почта Supabase отправляет всего несколько писем в час. Для продакшена это не годится.

1. Подключите SMTP-провайдера (Resend, Postmark, Mailgun, Amazon SES, Unisender) и подтвердите домен.
2. Добавьте в DNS:
   - **SPF:** `v=spf1 include:<провайдер> ~all`.
   - **DKIM:** CNAME- или TXT-записи из кабинета провайдера.
   - **DMARC:** `_dmarc` TXT `v=DMARC1; p=quarantine; rua=mailto:dmarc@ваш-домен`.
3. В Supabase откройте **Authentication → SMTP Settings**:
   - Хост, порт и логин провайдера.
   - Отправитель `no-reply@ваш-домен`.
   - Поднимите Rate Limits для писем.
4. Проверьте результат через mail-tester.com: оценка должна быть не ниже 9/10.

### 8. Аналитика и мониторинг

- В переменные сборки добавьте `YANDEX_METRIKA_ID` и/или `GA_MEASUREMENT_ID`.
- Счетчики загружаются только после согласия в баннере cookie. События: `sign_up`, `login`, `join_challenge`, `check_in`, `complete_challenge`, `create_challenge`, `begin_checkout`, `purchase`.
- Ошибки браузера пишутся в таблицу `error_logs` (видно в админке → «Ошибки»). Если задан `SENTRY_DSN`, они дополнительно уходят в Sentry.

### 9. Staging, бэкапы, проверка перед запуском

- **Staging:** отдельный проект Supabase и отдельный деплой с `ENVIRONMENT=staging`. На staging все страницы получают `noindex`, а `robots.txt` закрывает сайт целиком. Миграции сначала применяйте на staging.
- **Бэкапы:**
  - На тарифе Pro Supabase делает ежедневные бэкапы. Для восстановления на любую минуту включите PITR (Database → Backups).
  - Дополнительно делайте еженедельный `pg_dump` во внешнее хранилище. Пример для GitHub Actions по расписанию: `pg_dump "$DATABASE_URL" -Fc > backup.dump`, затем загрузка в S3 или R2.
  - Раз в квартал проверяйте восстановление на staging.
- **Живая проверка перед запуском:**
  1. Регистрация → письмо пришло (не в спам) → подтверждение.
  2. Смена пароля.
  3. Вход через Google и через Telegram.
  4. Вступление → чекин с фото → публикация в ленте.
  5. Тестовая оплата Payme и Click → доступ открылся.
  6. Создание своего челленджа → вступление по коду с другого аккаунта → отчет и CSV.
  7. Установка PWA на телефон, офлайн-отметка.
  8. Lighthouse ≥ 90 по всем пунктам.

### 10. Юридическое (обязательно до запуска)

- `/privacy/` и `/terms/` — **шаблоны**. Их нужно согласовать с юристом и указать реквизиты владельца, условия возврата и контакты.
- **Локализация персональных данных (Узбекистан).** Закон «О персональных данных» (ст. 27¹) требует, чтобы персональные данные граждан Узбекистана хранились и обрабатывались на серверах, физически находящихся в стране. Supabase Cloud таких регионов не имеет. Варианты:
  - Self-hosted Supabase (Docker) у местного провайдера: Uztelecom, UZCLOUD и другие. Код проекта не меняется — это тот же Supabase.
  - Или юридическая схема, которую подтвердит ваш юрист.
  - Также может потребоваться регистрация в реестре баз персональных данных.
- Оферта для платных челленджей, фискализация чеков (ОФД / Soliq) через кабинеты Payme и Click — уточните у бухгалтера.

## Контент и языки

- **Каталог:** правьте в админке (`/admin/` → Челленджи, вкладки RU/UZ/EN) или в `content/challenges.json`. Формат: `content.{ru,uz,en}.{title, short, goal, rules[], phases[{title, tasks[]}]}`. Задания по всем этапам идут подряд и повторяются по кругу на все `days`.
- **Интерфейс:** ключ перевода — русская строка: `t('Войти')`. После добавления строк запустите `node scripts/i18n-keys.mjs --missing uz` (и `en`): скрипт покажет, что нужно перевести. Тест `tests/unit/i18n.test.mjs` не пропустит непереведенные строки, расхождение параметров `{x}` и кириллицу в переводах.
- **Адреса:** русский без префикса, `/uz/…` и `/en/…`, с `hreflang` и общей картой сайта.

## Тесты

```bash
npm run test:unit   # логика, i18n, клиент Supabase, Edge Functions (Payme/Click/Telegram)
npm run test:sql    # миграции, RLS и все RPC на PostgreSQL 16 (нужен установленный postgres)
npm run test:e2e    # Playwright: все страницы × 3 языка, регистрация, вход, потоки и чат,
                    # лента, свои челленджи по коду, оплата, сертификат, админка, PWA офлайн
```

CI (`.github/workflows/ci.yml`) прогоняет все три набора на каждый push.

## Безопасность

- Права проверяет база: RLS на всех таблицах, SECURITY DEFINER-функции с `search_path = ''`, `require_user` и `require_admin`. Интерфейс админки — только для удобства.
- Ключ `service_role` живет только в Edge Functions и никогда не попадает в браузер.
- Подписи Payme и Click проверяются на сервере, суммы сверяются с заказом.
- CSP через meta-тег: скрипты только свои, сеть — только Supabase, Sentry и счетчики аналитики.
- Есть ограничения частоты для комментариев, чата и жалоб, а также лимиты на число челленджей и участий.
