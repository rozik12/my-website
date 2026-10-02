-- SQL-тесты v2: потоки, подтверждение, лента и приватность, модерация, свои челленджи, оплата Payme/Click, админка.
-- Выполняются после test.sql (используют схему t и функции t.as/t.root/t.ok).

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'c1@test.dev', '{"name": "Катя"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'c2@test.dev', '{"name": "Олег"}'),
  ('00000000-0000-0000-0000-0000000000ad', 'admin@test.dev', '{"name": "Админ"}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000ad';

-- ---------- Права администратора ----------
do $$ begin
  perform t.as('00000000-0000-0000-0000-0000000000c1');
  perform t.ok(not public.is_admin(), 'обычный пользователь не админ');
  begin perform public.admin_stats(); perform t.ok(false, 'admin_stats без прав');
  exception when sqlstate 'PT403' then perform t.ok(true, 'админские функции недоступны обычному пользователю'); end;
  begin update public.profiles set role = 'admin'; perform t.ok(false, 'роль менять нельзя');
  exception when insufficient_privilege then perform t.ok(true, 'пользователь не может назначить себе роль'); end;
  perform t.as('00000000-0000-0000-0000-0000000000ad');
  perform t.ok(public.is_admin(), 'администратор распознается');
  perform t.ok((public.admin_stats() ->> 'users')::int >= 3, 'статистика для админа');
end $$;

-- ---------- Потоки ----------
do $$ declare v_cohort bigint; r json; begin
  perform t.as('00000000-0000-0000-0000-0000000000ad');
  v_cohort := public.admin_save_cohort('steps-10k', (now() at time zone 'UTC')::date + 3, 'Тестовый поток');
  perform t.ok((select next_start from public.challenges where slug = 'steps-10k') = (now() at time zone 'UTC')::date + 3, 'ближайший поток записан в каталог');
  perform t.as('00000000-0000-0000-0000-0000000000c1');
  r := public.join_challenge('steps-10k', v_cohort);
  perform t.ok((r ->> 'start_date')::date = (now() at time zone 'UTC')::date + 3, 'участие в потоке начинается в день старта');
  begin perform public.check_in('steps-10k', 4, null); perform t.ok(false, 'чекин до старта');
  exception when raise_exception then perform t.ok(true, 'до старта потока отмечаться нельзя'); end;
  perform t.ok((select participants from public.cohorts_for('steps-10k') where id = v_cohort) = 1, 'счетчик участников потока');
  -- чат потока
  perform public.send_message(v_cohort, 'Всем привет!');
  perform t.as('00000000-0000-0000-0000-0000000000c2');
  perform t.ok((select count(*) from public.cohort_messages(v_cohort)) = 0, 'чат потока не виден посторонним');
  begin perform public.send_message(v_cohort, 'спам'); perform t.ok(false, 'писать в чужой чат');
  exception when sqlstate 'PT403' then perform t.ok(true, 'писать в чат может только участник потока'); end;
  perform t.as('00000000-0000-0000-0000-0000000000c1');
  perform t.ok((select count(*) from public.cohort_messages(v_cohort)) = 1, 'участник видит чат потока');
end $$;

-- ---------- Подтверждение и лента ----------
do $$ declare r json; v_id bigint; begin
  perform t.as('00000000-0000-0000-0000-0000000000c1');
  perform public.join_challenge('run-100');
  begin perform public.check_in('run-100', 4, null); perform t.ok(false, 'без подтверждения');
  exception when raise_exception then perform t.ok(true, 'обязательное подтверждение проверяется на сервере'); end;
  begin perform public.check_in('run-100', 4, null, true, 'пост', 'http://insecure'); perform t.ok(false, 'http-ссылка');
  exception when sqlstate '22023' then perform t.ok(true, 'ссылка подтверждения только https'); end;
  begin perform public.check_in('run-100', 4, null, true, 'пост', null, '00000000-0000-0000-0000-0000000000c2/x.jpg'); perform t.ok(false, 'чужая папка');
  exception when sqlstate '22023' then perform t.ok(true, 'фото только из своей папки хранилища'); end;
  r := public.check_in('run-100', 5, 'личная заметка', true, 'Пробежал 5 км!', 'https://strava.com/a/1');
  perform t.ok((r ->> 'day')::int = 1, 'чекин с подтверждением');
  select id into v_id from public.checkins where post_text = 'Пробежал 5 км!';
  perform t.as(null);
  perform t.ok((select count(*) from public.feed('run-100')) = 1, 'публикация видна в ленте без входа');
  perform t.ok((select author from public.feed('run-100') limit 1) = 'Катя', 'автор публикации');
  perform t.ok(not exists (select 1 from public.feed('run-100') f where f.post_text = 'личная заметка'), 'личная заметка не попадает в ленту');
  -- реакции и комментарии
  perform t.as('00000000-0000-0000-0000-0000000000c2');
  perform t.ok((public.toggle_reaction(v_id, 'fire') ->> 'fire')::int = 1, 'реакция ставится');
  perform t.ok((public.toggle_reaction(v_id, 'fire') ->> 'fire')::int = 0, 'повторное нажатие снимает реакцию');
  perform public.add_comment(v_id, 'Молодец!');
  perform t.ok((select count(*) from public.comments_for(v_id)) = 1, 'комментарий добавлен');
  perform public.report_content('checkin', v_id::text, 'Неправда');
  perform public.report_content('checkin', v_id::text, 'Неправда');
  perform t.ok((select count(*) from public.reports) = 0, 'жалобы видят только модераторы');
  perform t.root();
  perform t.ok((select count(*) from public.reports) = 1, 'повторная жалоба не дублируется');
  perform t.as('00000000-0000-0000-0000-0000000000c2');
  -- подписки и лента друзей
  perform public.follow('00000000-0000-0000-0000-0000000000c1');
  perform t.ok((select count(*) from public.friends_feed()) = 1, 'лента друзей');
  perform t.ok((select count(*) from public.search_people('Кат')) = 1, 'поиск людей');
  perform t.ok((public.person('00000000-0000-0000-0000-0000000000c1') ->> 'followers')::int = 1, 'профиль участника');
end $$;

-- ---------- Модерация и блокировка ----------
do $$ declare v_id bigint; begin
  select id into v_id from public.checkins where post_text = 'Пробежал 5 км!';
  perform t.as('00000000-0000-0000-0000-0000000000ad');
  perform t.ok((select count(*) from public.admin_moderation() where kind = 'checkin') = 1, 'жалоба в очереди модерации');
  perform public.admin_moderate('checkin', v_id::text, 'hide');
  perform t.ok((select status from public.reports limit 1) = 'resolved', 'жалоба закрыта');
  perform t.as(null);
  perform t.ok((select count(*) from public.feed('run-100')) = 0, 'скрытая публикация исчезла из ленты');
  perform t.as('00000000-0000-0000-0000-0000000000ad');
  perform public.admin_update_user('00000000-0000-0000-0000-0000000000c2', null, true);
  perform t.as('00000000-0000-0000-0000-0000000000c2');
  begin perform public.join_challenge('read-20'); perform t.ok(false, 'заблокированный');
  exception when sqlstate 'PT403' then perform t.ok(true, 'заблокированный пользователь не может действовать'); end;
  perform t.as('00000000-0000-0000-0000-0000000000ad');
  begin perform public.admin_update_user('00000000-0000-0000-0000-0000000000ad', 'user', null); perform t.ok(false, 'снять права с себя');
  exception when raise_exception then perform t.ok(true, 'админ не может снять права с самого себя'); end;
  perform public.admin_update_user('00000000-0000-0000-0000-0000000000c2', null, false);
end $$;

-- ---------- Свои (закрытые) челленджи ----------
do $$ declare v_slug text; v_code text; begin
  perform t.as('00000000-0000-0000-0000-0000000000c1');
  begin perform public.save_my_challenge(null, '{"title":"Х","days":10,"tasks":["a"]}'); perform t.ok(false, 'короткое название');
  exception when sqlstate '22023' then perform t.ok(true, 'валидация конструктора'); end;
  v_slug := public.save_my_challenge(null, '{"title":"Планка для отдела","days":14,"tasks":["Планка 60 сек","Планка 90 сек"],"category":"sport","proof":"optional"}');
  perform t.ok(v_slug like 'u-%', 'создан свой челлендж');
  select invite_code into v_code from public.challenges where slug = v_slug;
  perform t.ok((select visibility from public.challenges where slug = v_slug) = 'private', 'свой челлендж закрытый');
  perform t.as(null);
  perform t.ok(not exists (select 1 from public.challenges where slug = v_slug), 'закрытый челлендж не виден анониму');
  perform t.ok(public.challenge_info(v_slug) is null, 'описание закрытого челленджа недоступно');
  perform t.ok(not exists (select 1 from public.challenge_stats() where slug = v_slug), 'закрытые не попадают в публичную статистику');
  perform t.as('00000000-0000-0000-0000-0000000000c2');
  begin perform public.join_challenge(v_slug); perform t.ok(false, 'без кода');
  exception when sqlstate 'PT404' then perform t.ok(true, 'без кода в закрытый челлендж не вступить'); end;
  perform t.ok(public.join_by_code(lower(v_code)) = v_slug, 'вступление по коду (регистр не важен)');
  perform t.ok(public.challenge_info(v_slug) is not null, 'участник видит закрытый челлендж');
  perform t.ok((select count(*) from public.organizer_report(v_slug)) = 0, 'отчет организатора не виден участнику');
  perform t.as('00000000-0000-0000-0000-0000000000c1');
  perform t.ok((select count(*) from public.organizer_report(v_slug)) = 1, 'организатор видит участников');
  perform public.delete_my_challenge(v_slug);
  perform t.ok(not exists (select 1 from public.challenges where slug = v_slug), 'организатор удаляет свой челлендж');
end $$;

-- ---------- Оплата: доступ ----------
do $$ declare o json; begin
  perform t.as('00000000-0000-0000-0000-0000000000c1');
  begin perform public.join_challenge('mvp-14'); perform t.ok(false, 'без оплаты');
  exception when sqlstate 'PT402' then perform t.ok(true, 'в платный челлендж нельзя вступить без оплаты'); end;
  begin perform public.create_order('read-20', 'payme'); perform t.ok(false, 'заказ на бесплатный');
  exception when raise_exception then perform t.ok(true, 'заказ на бесплатный челлендж не создается'); end;
  o := public.create_order('mvp-14', 'payme');
  perform t.ok((o ->> 'amount_uzs')::int = 149000, 'заказ создан с ценой из каталога');
end $$;

-- ---------- Payme: полный жизненный цикл транзакции ----------
do $$ declare v_order text; r jsonb; begin
  select id::text into v_order from public.orders where provider = 'payme' order by id desc limit 1;
  r := public.payme_rpc('CheckPerformTransaction', jsonb_build_object('amount', 100, 'account', jsonb_build_object('order_id', v_order)));
  perform t.ok((r -> 'error' ->> 'code')::int = -31001, 'Payme: неверная сумма → -31001');
  r := public.payme_rpc('CheckPerformTransaction', jsonb_build_object('amount', 14900000, 'account', jsonb_build_object('order_id', '999999')));
  perform t.ok((r -> 'error' ->> 'code')::int = -31050, 'Payme: заказ не найден → -31050');
  r := public.payme_rpc('CheckPerformTransaction', jsonb_build_object('amount', 14900000, 'account', jsonb_build_object('order_id', v_order)));
  perform t.ok((r -> 'result' ->> 'allow')::boolean, 'Payme: CheckPerformTransaction → allow');
  r := public.payme_rpc('CreateTransaction', jsonb_build_object('id', 'pm-1', 'time', 1700000000000, 'amount', 14900000, 'account', jsonb_build_object('order_id', v_order)));
  perform t.ok((r -> 'result' ->> 'state')::int = 1, 'Payme: CreateTransaction → state 1');
  r := public.payme_rpc('CreateTransaction', jsonb_build_object('id', 'pm-1', 'time', 1700000000000, 'amount', 14900000, 'account', jsonb_build_object('order_id', v_order)));
  perform t.ok((r -> 'result' ->> 'state')::int = 1, 'Payme: повторный CreateTransaction идемпотентен');
  r := public.payme_rpc('CreateTransaction', jsonb_build_object('id', 'pm-2', 'time', 1700000000001, 'amount', 14900000, 'account', jsonb_build_object('order_id', v_order)));
  perform t.ok((r -> 'error' ->> 'code')::int = -31099, 'Payme: вторая транзакция на тот же заказ отклоняется');
  r := public.payme_rpc('PerformTransaction', jsonb_build_object('id', 'pm-1'));
  perform t.ok((r -> 'result' ->> 'state')::int = 2 and (r -> 'result' ->> 'perform_time')::bigint > 0, 'Payme: PerformTransaction → state 2');
  r := public.payme_rpc('PerformTransaction', jsonb_build_object('id', 'pm-1'));
  perform t.ok((r -> 'result' ->> 'state')::int = 2, 'Payme: повторный PerformTransaction идемпотентен');
  perform t.ok((select status from public.orders where id = v_order::bigint) = 'paid', 'Payme: заказ оплачен');
  r := public.payme_rpc('CheckTransaction', jsonb_build_object('id', 'pm-1'));
  perform t.ok((r -> 'result' ->> 'state')::int = 2, 'Payme: CheckTransaction');
  r := public.payme_rpc('GetStatement', jsonb_build_object('from', 1600000000000, 'to', 1800000000000));
  perform t.ok(jsonb_array_length(r -> 'result' -> 'transactions') = 1, 'Payme: GetStatement');
  r := public.payme_rpc('PerformTransaction', jsonb_build_object('id', 'nope'));
  perform t.ok((r -> 'error' ->> 'code')::int = -31003, 'Payme: неизвестная транзакция → -31003');
end $$;

do $$ declare r json; begin
  perform t.as('00000000-0000-0000-0000-0000000000c1');
  r := public.join_challenge('mvp-14');
  perform t.ok(exists (select 1 from public.enrollments where challenge_slug = 'mvp-14'), 'после оплаты вступление открыто');
  perform t.as('00000000-0000-0000-0000-0000000000c2');
  begin perform public.payme_rpc('GetStatement', '{}'); perform t.ok(false, 'payme_rpc пользователю');
  exception when insufficient_privilege then perform t.ok(true, 'функции оплаты недоступны пользователям напрямую'); end;
end $$;

do $$ declare r jsonb; begin
  r := public.payme_rpc('CancelTransaction', jsonb_build_object('id', 'pm-1', 'reason', 5));
  perform t.ok((r -> 'result' ->> 'state')::int = -2, 'Payme: отмена после оплаты → state -2 (возврат)');
  perform t.ok((select status from public.orders where provider = 'payme' order by id desc limit 1) = 'refunded', 'Payme: заказ помечен как возврат');
  perform t.ok(not public.has_access('00000000-0000-0000-0000-0000000000c1', 'mvp-14'), 'после возврата доступ закрыт');
end $$;

-- ---------- Click ----------
do $$ declare o json; r jsonb; v_prep bigint; begin
  perform t.as('00000000-0000-0000-0000-0000000000c2');
  o := public.create_order('english-15', 'click');
  perform t.root();
  r := public.click_prepare(5001, (o ->> 'order_id'), 100);
  perform t.ok((r ->> 'error')::int = -2, 'Click: неверная сумма → -2');
  r := public.click_prepare(5001, '999999', 49000);
  perform t.ok((r ->> 'error')::int = -5, 'Click: заказ не найден → -5');
  r := public.click_prepare(5001, (o ->> 'order_id'), 49000);
  perform t.ok((r ->> 'error')::int = 0, 'Click: prepare');
  v_prep := (r ->> 'merchant_prepare_id')::bigint;
  r := public.click_complete(5001, (o ->> 'order_id'), 777777, 49000, 0);
  perform t.ok((r ->> 'error')::int = -6, 'Click: чужой prepare_id → -6');
  r := public.click_complete(5001, (o ->> 'order_id'), v_prep, 49000, 0);
  perform t.ok((r ->> 'error')::int = 0, 'Click: complete');
  r := public.click_complete(5001, (o ->> 'order_id'), v_prep, 49000, 0);
  perform t.ok((r ->> 'error')::int = -4, 'Click: повторное подтверждение → -4 (уже оплачено)');
  perform t.ok(public.has_access('00000000-0000-0000-0000-0000000000c2', 'english-15'), 'Click: доступ открыт');
end $$;

do $$ declare o json; r jsonb; begin
  perform t.as('00000000-0000-0000-0000-0000000000c1');
  o := public.create_order('english-15', 'click');
  perform t.root();
  r := public.click_prepare(6001, (o ->> 'order_id'), 49000);
  r := public.click_complete(6001, (o ->> 'order_id'), (r ->> 'merchant_prepare_id')::bigint, 49000, -5017);
  perform t.ok((r ->> 'error')::int = -9, 'Click: ошибка на стороне Click отменяет заказ → -9');
  perform t.ok((select status from public.orders where id = (o ->> 'order_id')::bigint) = 'cancelled', 'Click: заказ отменен');
end $$;

-- ---------- Админ: каталог ----------
do $$ begin
  perform t.as('00000000-0000-0000-0000-0000000000ad');
  perform public.admin_save_challenge('{"slug":"new-one","category":"growth","level":"easy","days":5,"icon":"star","priceUzs":0,"proof":"none","published":true,
    "content":{"ru":{"title":"Новый","short":"","goal":"","rules":[],"phases":[{"title":"Ф","tasks":["a"]}]},"en":{"title":"New"}}}');
  perform t.ok((select content -> 'en' ->> 'title' from public.challenges where slug = 'new-one') = 'New', 'админ сохраняет челлендж с переводами');
  perform public.admin_delete_challenge('new-one');
  perform t.ok(not exists (select 1 from public.challenges where slug = 'new-one'), 'челлендж без участников удаляется');
  perform public.admin_delete_challenge('run-100');
  perform t.ok((select not published from public.challenges where slug = 'run-100'), 'челлендж с участниками только снимается с публикации');
  perform t.as(null);
  perform t.ok(not exists (select 1 from public.challenges where slug = 'run-100'), 'снятый с публикации не виден в каталоге');
end $$;

-- ---------- Сертификат ----------
do $$ declare v uuid; begin
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'f1@test.dev');
  insert into public.enrollments (user_id, challenge_slug, start_date, status, completed_at) values ('00000000-0000-0000-0000-0000000000f1', 'detox-7', current_date - 8, 'completed', now()) returning public_id into v;
  perform t.as(null);
  perform t.ok((public.certificate(v) ->> 'days')::int = 7, 'сертификат проверяется по публичной ссылке');
  perform t.ok(public.certificate(gen_random_uuid()) is null, 'несуществующий сертификат');
end $$;
