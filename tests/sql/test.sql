-- SQL-тесты: права доступа (RLS), бизнес-правила RPC и статистика.
-- Каждый DO-блок — отдельная транзакция. Роль переключается через t.as(…).
\set QUIET on
create schema t;
grant usage on schema t to anon, authenticated;
create function t.as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('role', case when p_uid is null then 'anon' else 'authenticated' end, true);
end $$;
create function t.root() returns void language plpgsql as $$ begin perform set_config('role', 'none', true); end $$;
create function t.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'FAIL: %', msg; end if; raise notice 'ok — %', msg; end $$;
grant execute on all functions in schema t to anon, authenticated;
\set QUIET off

-- Пользователи A и B
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev', '{"name": "Анна"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev', '{}');

do $$ begin
  perform t.ok((select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000a') = 'Анна', 'профиль создается при регистрации с именем из метаданных');
  perform t.ok((select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 'Участник', 'имя по умолчанию');
end $$;

-- Запись и первый чекин
do $$ declare r json; begin
  perform t.as('00000000-0000-0000-0000-00000000000a');
  perform public.join_challenge('cold-shower');
  perform public.join_challenge('cold-shower'); -- повторная запись не создает дубль
  perform t.ok((select count(*) from public.enrollments where challenge_slug = 'cold-shower') = 1, 'повторная запись не дублирует участие');
  r := public.check_in('cold-shower', 4, 'бодро');
  perform t.ok((r->>'day')::int = 1 and (r->>'done')::int = 1 and (r->>'streak')::int = 1, 'первый чекин: день 1, серия 1');
  r := public.check_in('cold-shower', 5, 'еще бодрее');
  perform t.ok((r->>'done')::int = 1, 'повторный чекин в тот же день обновляет запись, а не добавляет');
  perform t.ok((select mood from public.checkins where day_number = 1) = 5, 'оценка обновилась');
end $$;

-- Пропуск дня и серия
do $$ declare r json; begin
  update public.enrollments set start_date = current_date - 2 where challenge_slug = 'cold-shower';
  perform t.as('00000000-0000-0000-0000-00000000000a');
  r := public.check_in('cold-shower', 3, null);
  perform t.ok((r->>'day')::int = 3 and (r->>'done')::int = 2 and (r->>'streak')::int = 1, 'после пропуска дня 2 серия начинается заново');
  perform public.undo_check_in('cold-shower');
  perform t.ok((select count(*) from public.checkins) = 1, 'отмена удаляет только сегодняшнюю отметку');
end $$;

do $$ declare e bigint; begin
  select id into e from public.enrollments where challenge_slug = 'cold-shower';
  insert into public.checkins (enrollment_id, user_id, day_number, checkin_date) values
    (e, '00000000-0000-0000-0000-00000000000a', 2, current_date - 1);
  perform t.ok(public.enrollment_streak(e) = 2, 'серия считается до вчерашнего дня, если сегодня еще не отмечено');
end $$;

-- RLS: чужие данные недоступны, прямые изменения запрещены
do $$ begin
  perform t.as('00000000-0000-0000-0000-00000000000b');
  perform t.ok((select count(*) from public.enrollments) = 0, 'B не видит участия A');
  perform t.ok((select count(*) from public.checkins) = 0, 'B не видит чекины A');
  perform t.ok((select count(*) from public.profiles) = 1, 'B видит только свой профиль');
end $$;

do $$ begin
  perform t.as('00000000-0000-0000-0000-00000000000b');
  begin
    insert into public.checkins (enrollment_id, user_id, day_number, checkin_date) values (1, '00000000-0000-0000-0000-00000000000b', 5, current_date);
    perform t.ok(false, 'прямая вставка чекина должна быть запрещена');
  exception when insufficient_privilege then perform t.ok(true, 'прямая вставка чекина запрещена RLS');
  end;
  begin
    perform public.check_in('cold-shower', 3, null);
    perform t.ok(false, 'чекин без участия должен падать');
  exception when no_data_found then perform t.ok(true, 'чекин без участия отклоняется');
  end;
end $$;

do $$ begin
  perform t.as('00000000-0000-0000-0000-00000000000a');
  update public.profiles set display_name = 'Анна К.', timezone = 'Asia/Tashkent' where id = '00000000-0000-0000-0000-00000000000a';
  perform t.ok((select display_name from public.profiles) = 'Анна К.', 'пользователь меняет свое имя');
  begin
    update public.profiles set created_at = now() - interval '1 year';
    perform t.ok(false, 'служебные поля профиля менять нельзя');
  exception when insufficient_privilege then perform t.ok(true, 'служебные поля профиля защищены');
  end;
  update public.profiles set display_name = 'Взлом' where id = '00000000-0000-0000-0000-00000000000b';
  perform t.root();
  perform t.ok((select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 'Участник', 'чужой профиль изменить нельзя');
end $$;

-- Анонимный доступ
do $$ begin
  perform t.as(null);
  perform t.ok((select participants from public.challenge_stats() where slug = 'cold-shower') = 1, 'статистика доступна без входа');
  perform t.ok((select count(*) from public.leaderboard('cold-shower')) = 1, 'рейтинг доступен без входа');
  perform t.ok((select (public.platform_stats() ->> 'participants')::int) = 1, 'статистика платформы');
  insert into public.error_logs (message, url) values ('test error', 'https://x');
  perform t.ok((select count(*) from public.error_logs) = 0, 'аноним пишет ошибки, но не читает журнал');
  begin
    perform public.join_challenge('cold-shower');
    perform t.ok(false, 'аноним не может вступить');
  exception when insufficient_privilege then perform t.ok(true, 'аноним не может вызывать действия');
  end;
end $$;

-- Приватность рейтинга
do $$ begin
  update public.profiles set public_profile = false where id = '00000000-0000-0000-0000-00000000000a';
  perform t.as(null);
  perform t.ok((select count(*) from public.leaderboard('cold-shower')) = 0, 'скрытый профиль не виден в рейтинге');
  perform t.as('00000000-0000-0000-0000-00000000000a');
  perform t.ok((select is_me from public.leaderboard('cold-shower') limit 1), 'свою строку участник видит всегда');
  perform t.root();
  update public.profiles set public_profile = true where id = '00000000-0000-0000-0000-00000000000a';
end $$;

-- Завершение челленджа и отзыв
do $$ declare e bigint; r json; begin
  perform t.as('00000000-0000-0000-0000-00000000000a');
  perform public.join_challenge('detox-7');
  perform t.root();
  update public.enrollments set start_date = public.user_today('00000000-0000-0000-0000-00000000000a') - 6 where challenge_slug = 'detox-7' returning id into e;
  insert into public.checkins (enrollment_id, user_id, day_number, checkin_date)
    select e, '00000000-0000-0000-0000-00000000000a', d, public.user_today('00000000-0000-0000-0000-00000000000a') - 7 + d from generate_series(1, 6) d;
  perform t.as('00000000-0000-0000-0000-00000000000a');
  r := public.check_in('detox-7', 5, 'готово');
  perform t.ok((r->>'completed')::boolean and (r->>'day')::int = 7, 'седьмой чекин завершает недельный челлендж');
  perform t.ok((select status from public.enrollments where id = e) = 'completed', 'статус участия — completed');
  perform public.submit_testimonial('detox-7', 'Неделя без телефона по вечерам — сплю лучше.');
  perform t.ok((select count(*) from public.testimonials where not approved) = 1, 'отзыв ждет модерации');
  begin
    perform public.submit_testimonial('cold-shower', 'Отзыв до завершения челленджа.');
    perform t.ok(false, 'отзыв до финиша запрещен');
  exception when raise_exception then perform t.ok(true, 'отзыв до финиша запрещен');
  end;
  perform public.join_challenge('detox-7');
  perform t.ok((select count(*) from public.enrollments where challenge_slug = 'detox-7') = 2, 'завершенный челлендж можно пройти снова');
end $$;

do $$ begin
  perform t.as(null);
  perform t.ok((select count(*) from public.testimonials) = 0, 'неодобренные отзывы не публикуются');
  perform t.ok((select finish_rate from public.challenge_stats() where slug = 'detox-7') = 100, 'доля финишировавших считается по завершенным потокам');
end $$;

-- Удаление аккаунта
do $$ begin
  perform t.as('00000000-0000-0000-0000-00000000000a');
  perform public.delete_my_account();
  perform t.root();
  perform t.ok(not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-00000000000a'), 'аккаунт удален');
  perform t.ok((select count(*) from public.enrollments) = 0 and (select count(*) from public.checkins) = 0 and (select count(*) from public.testimonials) = 0, 'все данные пользователя удалены каскадно');
end $$;
