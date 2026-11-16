-- Aggiornamento 005: pronostici sempre aperti sul prossimo video di ogni gioco, pagati in automatico,
-- e pronostici di stagione. Da eseguire nel SQL Editor di Supabase DOPO 004 (si può rieseguire senza danni).
--
-- Come funziona: per ogni gioco c'è una domanda "prossimo video" che non chiude mai. Quando esce il video,
-- il robot del sito (GitHub Actions) chiama bot_settle_round: valgono solo le puntate fatte PRIMA dell'uscita
-- del video; quelle fatte dopo restano in gioco per il video successivo.

-- ============================================================
-- Struttura
-- ============================================================
alter table public.markets add column if not exists scope text not null default 'evento';
alter table public.markets drop constraint if exists markets_scope_check;
alter table public.markets add constraint markets_scope_check check (scope in ('evento', 'prossimo', 'stagione'));
alter table public.markets add column if not exists game text;      -- golf, gta, uno, sbg
alter table public.markets add column if not exists season int;      -- solo per i pronostici di stagione
alter table public.options add column if not exists player text;     -- id del giocatore (come nel sito)

-- Un "turno" pagato di una domanda sempre aperta (uno per video): serve anche a non pagare due volte
create table if not exists public.market_rounds (
  id bigint generated always as identity primary key,
  market_id bigint not null references public.markets(id) on delete cascade,
  video_id text not null,
  published_at timestamptz not null,
  outcome text not null check (outcome in ('pagato', 'rimborsato')),
  result text[],              -- giocatori in ordine (vincitori o podio)
  pool bigint not null default 0,
  winners int not null default 0,
  created_at timestamptz not null default now(),
  unique (market_id, video_id)
);
alter table public.market_rounds enable row level security;
drop policy if exists market_rounds_select on public.market_rounds;
create policy market_rounds_select on public.market_rounds for select using (true);
grant select on public.market_rounds to anon, authenticated;
revoke insert, update, delete on public.market_rounds from anon, authenticated;

-- Gettoni in gioco adesso (puntate non ancora pagate): per le domande sempre aperte
create or replace view public.round_totals as
  select o.id as option_id, o.market_id,
    coalesce(sum(b.amount) filter (where b.payout is null), 0)::bigint as total,
    count(b.id) filter (where b.payout is null)::int as bettors
  from public.options o left join public.bets b on b.option_id = o.id
  group by o.id, o.market_id;
grant select on public.round_totals to anon, authenticated;

-- ============================================================
-- Pagamento di un turno (solo il robot, con la chiave segreta)
-- ============================================================
-- p_ranking: giocatori in ordine di arrivo. p_winners: chi ha vinto (più di uno se pari merito).
-- p_players: tutti quelli che hanno giocato (le puntate su chi non ha giocato vengono rimborsate).
create or replace function public.bot_settle_round(
  p_market bigint, p_video text, p_published timestamptz,
  p_players text[], p_winners text[], p_podium text[]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.markets;
  b record;
  total bigint := 0;
  win_total bigint := 0;
  pay bigint;
  winners int := 0;
  podium_ok boolean := p_podium is not null and cardinality(p_podium) = 3;
  is_win boolean;
  pl text[];
begin
  select * into m from public.markets where id = p_market for update;
  if not found or m.scope <> 'prossimo' then raise exception 'Domanda non valida'; end if;
  if exists (select 1 from public.market_rounds where market_id = p_market and video_id = p_video) then
    return jsonb_build_object('gia_fatto', true);
  end if;

  -- 1) rimborso delle puntate su giocatori che nel video non c'erano (o podio impossibile)
  for b in select bt.* from public.bets bt where bt.market_id = p_market and bt.payout is null and bt.created_at < p_published loop
    select array_agg(o.player order by array_position(coalesce(b.picks, array[b.option_id]), o.id))
      into pl from public.options o where o.id = any (coalesce(b.picks, array[b.option_id]));
    if not (pl <@ p_players) or (m.kind = 'podio' and not podium_ok) then
      update public.bets set payout = b.amount where id = b.id;
      update public.profiles set balance = balance + b.amount where id = b.user_id;
      insert into public.transactions (user_id, amount, reason, market_id) values (b.user_id, b.amount, 'rimborso', p_market);
    end if;
  end loop;

  -- 2) piatto e vincenti fra le puntate rimaste di questo turno
  for b in select bt.* from public.bets bt where bt.market_id = p_market and bt.payout is null and bt.created_at < p_published loop
    total := total + b.amount;
    select array_agg(o.player order by array_position(coalesce(b.picks, array[b.option_id]), o.id))
      into pl from public.options o where o.id = any (coalesce(b.picks, array[b.option_id]));
    is_win := case when m.kind = 'podio' then pl = p_podium else pl[1] = any (p_winners) end;
    if is_win then win_total := win_total + b.amount; end if;
  end loop;

  if total = 0 then
    insert into public.market_rounds (market_id, video_id, published_at, outcome, result, pool)
      values (p_market, p_video, p_published, 'pagato', case when m.kind = 'podio' then p_podium else p_winners end, 0);
    return jsonb_build_object('piatto', 0);
  end if;

  for b in select bt.* from public.bets bt where bt.market_id = p_market and bt.payout is null and bt.created_at < p_published loop
    select array_agg(o.player order by array_position(coalesce(b.picks, array[b.option_id]), o.id))
      into pl from public.options o where o.id = any (coalesce(b.picks, array[b.option_id]));
    is_win := case when m.kind = 'podio' then pl = p_podium else pl[1] = any (p_winners) end;
    if win_total = 0 then
      pay := b.amount;   -- nessuno ha indovinato: tutti rimborsati
      insert into public.transactions (user_id, amount, reason, market_id) values (b.user_id, pay, 'rimborso', p_market);
    elsif is_win then
      pay := (b.amount * total) / win_total;
      winners := winners + 1;
      insert into public.transactions (user_id, amount, reason, market_id) values (b.user_id, pay, 'vincita', p_market);
    else
      pay := 0;
    end if;
    if pay > 0 then update public.profiles set balance = balance + pay where id = b.user_id; end if;
    update public.bets set payout = pay where id = b.id;
  end loop;

  insert into public.market_rounds (market_id, video_id, published_at, outcome, result, pool, winners)
    values (p_market, p_video, p_published, case when win_total = 0 then 'rimborsato' else 'pagato' end,
            case when m.kind = 'podio' then p_podium else p_winners end, total, winners);
  return jsonb_build_object('piatto', total, 'vincenti', winners, 'rimborsato', win_total = 0);
end $$;

-- Video senza risultato leggibile: si rimborsano le puntate di quel turno
create or replace function public.bot_void_round(p_market bigint, p_video text, p_published timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; total bigint := 0;
begin
  perform 1 from public.markets where id = p_market and scope = 'prossimo' for update;
  if not found then raise exception 'Domanda non valida'; end if;
  if exists (select 1 from public.market_rounds where market_id = p_market and video_id = p_video) then
    return jsonb_build_object('gia_fatto', true);
  end if;
  for b in select * from public.bets where market_id = p_market and payout is null and created_at < p_published loop
    total := total + b.amount;
    update public.bets set payout = b.amount where id = b.id;
    update public.profiles set balance = balance + b.amount where id = b.user_id;
    insert into public.transactions (user_id, amount, reason, market_id) values (b.user_id, b.amount, 'rimborso', p_market);
  end loop;
  insert into public.market_rounds (market_id, video_id, published_at, outcome, pool)
    values (p_market, p_video, p_published, 'rimborsato', total);
  return jsonb_build_object('rimborsato', total);
end $$;

-- Pronostico di stagione: pagato quando la stagione è finita (stesse regole a montepremi)
create or replace function public.bot_settle_season(p_market bigint, p_winners text[], p_podium text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.markets; opt bigint; picks bigint[];
begin
  select * into m from public.markets where id = p_market;
  if not found or m.scope <> 'stagione' or m.status not in ('aperto', 'chiuso') then return jsonb_build_object('gia_fatto', true); end if;
  if m.kind = 'podio' then
    select array_agg((select o.id from public.options o where o.market_id = p_market and o.player = x) order by i)
      into picks from unnest(p_podium) with ordinality as t(x, i);
    if picks is null or array_position(picks, null) is not null then return public.bot_void_market(p_market); end if;
    return public.admin_settle_podium_internal(p_market, picks);
  end if;
  select o.id into opt from public.options o where o.market_id = p_market and o.player = any (p_winners) order by o.sort limit 1;
  if opt is null then return public.bot_void_market(p_market); end if;
  return public.admin_settle_market_internal(p_market, opt);
end $$;

-- ============================================================
-- Le funzioni di pagamento degli admin, divise in controllo + lavoro (il robot usa solo il lavoro)
-- ============================================================
create or replace function public.bot_void_market(p_market bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record;
begin
  perform 1 from public.markets where id = p_market and status in ('aperto', 'chiuso') for update;
  if not found then return jsonb_build_object('gia_fatto', true); end if;
  for b in select * from public.bets where market_id = p_market and payout is null loop
    update public.bets set payout = b.amount where id = b.id;
    update public.profiles set balance = balance + b.amount where id = b.user_id;
    insert into public.transactions (user_id, amount, reason, market_id) values (b.user_id, b.amount, 'rimborso', p_market);
  end loop;
  update public.markets set status = 'annullato' where id = p_market;
  return jsonb_build_object('rimborsato', true);
end $$;

create or replace function public.admin_settle_market_internal(p_market bigint, p_option bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare total bigint; win_total bigint; b record; pay bigint; winners int := 0;
begin
  perform 1 from public.markets where id = p_market and status in ('aperto', 'chiuso') for update;
  if not found then raise exception 'La domanda è già stata chiusa con un risultato'; end if;
  select coalesce(sum(amount), 0) into total from public.bets where market_id = p_market;
  select coalesce(sum(amount), 0) into win_total from public.bets where market_id = p_market and option_id = p_option;
  if win_total = 0 then
    perform public.bot_void_market(p_market);
    update public.markets set winning_option = p_option where id = p_market;
    return jsonb_build_object('rimborsato', true, 'piatto', total);
  end if;
  for b in select * from public.bets where market_id = p_market loop
    if b.option_id = p_option then
      pay := (b.amount * total) / win_total; winners := winners + 1;
      update public.profiles set balance = balance + pay where id = b.user_id;
      insert into public.transactions (user_id, amount, reason, market_id) values (b.user_id, pay, 'vincita', p_market);
    else pay := 0; end if;
    update public.bets set payout = pay where id = b.id;
  end loop;
  update public.markets set status = 'pagato', winning_option = p_option where id = p_market;
  return jsonb_build_object('rimborsato', false, 'piatto', total, 'vincenti', winners);
end $$;

create or replace function public.admin_settle_podium_internal(p_market bigint, p_picks bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare total bigint; win_total bigint; b record; pay bigint; winners int := 0;
begin
  perform 1 from public.markets where id = p_market and status in ('aperto', 'chiuso') and kind = 'podio' for update;
  if not found then raise exception 'La domanda non è un podio aperto'; end if;
  select coalesce(sum(amount), 0) into total from public.bets where market_id = p_market;
  select coalesce(sum(amount), 0) into win_total from public.bets where market_id = p_market and picks = p_picks;
  if win_total = 0 then
    perform public.bot_void_market(p_market);
    update public.markets set winning_option = p_picks[1], podium = p_picks where id = p_market;
    return jsonb_build_object('rimborsato', true, 'piatto', total);
  end if;
  for b in select * from public.bets where market_id = p_market loop
    if b.picks = p_picks then
      pay := (b.amount * total) / win_total; winners := winners + 1;
      update public.profiles set balance = balance + pay where id = b.user_id;
      insert into public.transactions (user_id, amount, reason, market_id) values (b.user_id, pay, 'vincita', p_market);
    else pay := 0; end if;
    update public.bets set payout = pay where id = b.id;
  end loop;
  update public.markets set status = 'pagato', winning_option = p_picks[1], podium = p_picks where id = p_market;
  return jsonb_build_object('rimborsato', false, 'piatto', total, 'vincenti', winners);
end $$;

-- Gli admin non possono chiudere o pagare a mano le domande sempre aperte (ci pensa il robot)
create or replace function public.admin_settle_market(p_market bigint, p_option bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo gli admin possono farlo'; end if;
  if (select scope from public.markets where id = p_market) = 'prossimo' then raise exception 'Questa domanda si paga da sola quando esce il video'; end if;
  if (select kind from public.markets where id = p_market) <> 'vincitore' then raise exception 'Per il podio indica primo, secondo e terzo'; end if;
  if not exists (select 1 from public.options where id = p_option and market_id = p_market) then
    raise exception 'L''opzione non appartiene a questa domanda';
  end if;
  return public.admin_settle_market_internal(p_market, p_option);
end $$;

create or replace function public.admin_settle_podium(p_market bigint, p_picks bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo gli admin possono farlo'; end if;
  if (select scope from public.markets where id = p_market) = 'prossimo' then raise exception 'Questa domanda si paga da sola quando esce il video'; end if;
  if p_picks is null or cardinality(p_picks) <> 3 or array_position(p_picks, null) is not null
     or (select count(distinct x) from unnest(p_picks) x) <> 3
     or (select count(*) from public.options where market_id = p_market and id = any (p_picks)) <> 3 then
    raise exception 'Indica tre giocatori diversi di questa domanda';
  end if;
  return public.admin_settle_podium_internal(p_market, p_picks);
end $$;

create or replace function public.admin_close_market(p_market bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo gli admin possono farlo'; end if;
  if (select scope from public.markets where id = p_market) = 'prossimo' then raise exception 'Questa domanda resta sempre aperta'; end if;
  update public.markets set status = 'chiuso' where id = p_market and status = 'aperto';
  if not found then raise exception 'La domanda non è aperta'; end if;
end $$;

create or replace function public.admin_void_market(p_market bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo gli admin possono farlo'; end if;
  if (select scope from public.markets where id = p_market) = 'prossimo' then raise exception 'Questa domanda resta sempre aperta'; end if;
  perform 1 from public.markets where id = p_market and status in ('aperto', 'chiuso');
  if not found then raise exception 'La domanda è già stata chiusa con un risultato'; end if;
  perform public.bot_void_market(p_market);
end $$;

-- Permessi: le funzioni del robot e quelle "internal" non si chiamano dal sito
revoke execute on function public.bot_settle_round(bigint, text, timestamptz, text[], text[], text[]),
  public.bot_void_round(bigint, text, timestamptz), public.bot_settle_season(bigint, text[], text[]),
  public.bot_void_market(bigint), public.admin_settle_market_internal(bigint, bigint),
  public.admin_settle_podium_internal(bigint, bigint[]) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.bot_settle_round(bigint, text, timestamptz, text[], text[], text[]),
      public.bot_void_round(bigint, text, timestamptz), public.bot_settle_season(bigint, text[], text[]) to service_role;
  end if;
end $$;

-- ============================================================
-- Domande già pronte: prossimo video di ogni gioco e stagione 2027
-- ============================================================
do $$
declare
  post_id bigint;
  mk bigint;
  g record;
  q record;
  players text[][] := array[['delux','Delux'],['rohn','Rohn'],['gabbo','Gabbo'],['dread','Dread'],['mollu','Mollu'],['masseo','il Masseo'],['jtaz','JTaz']];
  i int;
begin
  for g in select * from (values
      ('golf', 'Golf With Your Friends', 'Prossima golfatina', 'Chi vince la prossima golfatina?', true),
      ('gta', 'Sdrogo Corse (GTA V)', 'Prossime Sdrogo Corse', 'Chi vince le prossime Sdrogo Corse?', true),
      ('uno', 'UNO', 'Prossima partita a UNO', 'Chi vince il prossimo video di UNO?', false)
    ) as t(game, game_name, title, question, with_podium)
  loop
    if exists (select 1 from public.markets where scope = 'prossimo' and game = g.game) then continue; end if;
    insert into public.posts (title, game, body, published)
      values (g.title, g.game_name, 'Sempre aperto: valgono le puntate fatte prima che esca il video. Quelle fatte dopo valgono per il video successivo. Si paga da solo quando c''è il risultato.', true)
      returning id into post_id;
    for q in select * from (values (g.question, 'vincitore'), ('Il podio esatto del prossimo video', 'podio')) as x(question, kind)
             where x.kind = 'vincitore' or g.with_podium loop
      insert into public.markets (post_id, question, closes_at, kind, scope, game)
        values (post_id, q.question, '2100-01-01', q.kind, 'prossimo', g.game) returning id into mk;
      for i in 1 .. array_length(players, 1) loop
        insert into public.options (market_id, label, sort, player) values (mk, players[i][2], i, players[i][1]);
      end loop;
    end loop;
  end loop;

  -- Stagione 2027: puntate aperte fino al 28 febbraio 2027, pagate a fine anno
  if not exists (select 1 from public.markets where scope = 'stagione' and season = 2027) then
    insert into public.posts (title, game, body, published)
      values ('Stagione 2027', 'Golf With Your Friends', 'Chi sarà campione a fine 2027? Puntate aperte fino al 28 febbraio 2027, pagamento a fine stagione.', true)
      returning id into post_id;
    for g in select * from (values ('golf', 'Chi vince la stagione 2027 di golf?'), ('gta', 'Chi vince la stagione 2027 delle Sdrogo Corse?')) as t(game, question) loop
      insert into public.markets (post_id, question, closes_at, kind, scope, game, season)
        values (post_id, g.question, '2027-02-28 23:59:00+01', 'vincitore', 'stagione', g.game, 2027) returning id into mk;
      for i in 1 .. array_length(players, 1) loop
        insert into public.options (market_id, label, sort, player) values (mk, players[i][2], i, players[i][1]);
      end loop;
    end loop;
  end if;
end $$;
