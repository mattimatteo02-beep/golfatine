-- Aggiornamento 004: annunci con miniatura, pronostico del podio, gestione degli admin, risultati dal sito.
-- Da eseguire nel SQL Editor di Supabase DOPO 003 (si può rieseguire senza danni).

-- ============================================================
-- Annunci: miniatura del video
-- ============================================================
alter table public.posts add column if not exists image_url text;

-- Cartella pubblica per le miniature: tutti le vedono, solo gli admin le caricano
insert into storage.buckets (id, name, public) values ('miniature', 'miniature', true)
  on conflict (id) do update set public = true;
drop policy if exists miniature_admin_insert on storage.objects;
drop policy if exists miniature_admin_update on storage.objects;
drop policy if exists miniature_admin_delete on storage.objects;
create policy miniature_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'miniature' and public.is_admin());
create policy miniature_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'miniature' and public.is_admin());
create policy miniature_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'miniature' and public.is_admin());

-- ============================================================
-- Pronostico del podio: si indovinano 1°, 2° e 3° nell'ordine esatto
-- ============================================================
alter table public.markets add column if not exists kind text not null default 'vincitore';
alter table public.markets drop constraint if exists markets_kind_check;
alter table public.markets add constraint markets_kind_check check (kind in ('vincitore', 'podio'));
alter table public.markets add column if not exists podium bigint[];
alter table public.bets add column if not exists picks bigint[];

-- Puntata su chi vince (come prima, ma non sulle domande del podio)
create or replace function public.place_bet(p_option bigint, p_amount bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.profiles;
  m public.markets;
  o public.options;
begin
  select * into p from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Devi accedere per puntare'; end if;
  if p.username is null then raise exception 'Scegli prima un nome utente'; end if;
  select * into o from public.options where id = p_option;
  if not found then raise exception 'Opzione inesistente'; end if;
  select * into m from public.markets where id = o.market_id for share;
  if m.kind <> 'vincitore' then raise exception 'Su questa domanda si pronostica il podio'; end if;
  if m.status <> 'aperto' or m.closes_at <= now() then raise exception 'Le puntate su questa domanda sono chiuse'; end if;
  if not exists (select 1 from public.posts where id = m.post_id and published) then raise exception 'Post non disponibile'; end if;
  if p_amount is null or p_amount < (public.economy()->>'puntata_min')::bigint then
    raise exception 'La puntata minima è % gettoni', public.economy()->>'puntata_min';
  end if;
  if p_amount > p.balance then raise exception 'Non hai abbastanza gettoni'; end if;

  update public.profiles set balance = balance - p_amount where id = p.id;
  insert into public.bets (user_id, market_id, option_id, amount) values (p.id, m.id, o.id, p_amount);
  insert into public.transactions (user_id, amount, reason, market_id) values (p.id, -p_amount, 'puntata', m.id);
  return jsonb_build_object('balance', p.balance - p_amount);
end $$;

-- Puntata sul podio: tre opzioni diverse della stessa domanda, in ordine (1°, 2°, 3°)
create or replace function public.place_podium_bet(p_market bigint, p_picks bigint[], p_amount bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.profiles;
  m public.markets;
begin
  select * into p from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Devi accedere per puntare'; end if;
  if p.username is null then raise exception 'Scegli prima un nome utente'; end if;
  select * into m from public.markets where id = p_market for share;
  if not found then raise exception 'Domanda inesistente'; end if;
  if m.kind <> 'podio' then raise exception 'Questa domanda non è sul podio'; end if;
  if m.status <> 'aperto' or m.closes_at <= now() then raise exception 'Le puntate su questa domanda sono chiuse'; end if;
  if not exists (select 1 from public.posts where id = m.post_id and published) then raise exception 'Post non disponibile'; end if;
  if p_picks is null or cardinality(p_picks) <> 3 or array_position(p_picks, null) is not null
     or (select count(distinct x) from unnest(p_picks) x) <> 3 then
    raise exception 'Scegli tre giocatori diversi: primo, secondo e terzo';
  end if;
  if (select count(*) from public.options where market_id = m.id and id = any (p_picks)) <> 3 then
    raise exception 'Le scelte non appartengono a questa domanda';
  end if;
  if p_amount is null or p_amount < (public.economy()->>'puntata_min')::bigint then
    raise exception 'La puntata minima è % gettoni', public.economy()->>'puntata_min';
  end if;
  if p_amount > p.balance then raise exception 'Non hai abbastanza gettoni'; end if;

  update public.profiles set balance = balance - p_amount where id = p.id;
  insert into public.bets (user_id, market_id, option_id, picks, amount) values (p.id, m.id, p_picks[1], p_picks, p_amount);
  insert into public.transactions (user_id, amount, reason, market_id) values (p.id, -p_amount, 'puntata', m.id);
  return jsonb_build_object('balance', p.balance - p_amount);
end $$;

-- Risultato di "chi vince" (come prima, ma non sulle domande del podio)
create or replace function public.admin_settle_market(p_market bigint, p_option bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  total bigint;
  win_total bigint;
  b record;
  pay bigint;
  winners int := 0;
begin
  if not public.is_admin() then raise exception 'Solo gli admin possono farlo'; end if;
  perform 1 from public.markets where id = p_market and status in ('aperto', 'chiuso') for update;
  if not found then raise exception 'La domanda è già stata chiusa con un risultato'; end if;
  if (select kind from public.markets where id = p_market) <> 'vincitore' then raise exception 'Per il podio indica primo, secondo e terzo'; end if;
  if not exists (select 1 from public.options where id = p_option and market_id = p_market) then
    raise exception 'L''opzione non appartiene a questa domanda';
  end if;

  select coalesce(sum(amount), 0) into total from public.bets where market_id = p_market;
  select coalesce(sum(amount), 0) into win_total from public.bets where market_id = p_market and option_id = p_option;

  if win_total = 0 then
    perform public.admin_void_market(p_market);
    update public.markets set winning_option = p_option where id = p_market;
    return jsonb_build_object('rimborsato', true, 'piatto', total);
  end if;

  for b in select * from public.bets where market_id = p_market loop
    if b.option_id = p_option then
      pay := (b.amount * total) / win_total;
      winners := winners + 1;
      update public.profiles set balance = balance + pay where id = b.user_id;
      insert into public.transactions (user_id, amount, reason, market_id) values (b.user_id, pay, 'vincita', p_market);
    else
      pay := 0;
    end if;
    update public.bets set payout = pay where id = b.id;
  end loop;
  update public.markets set status = 'pagato', winning_option = p_option where id = p_market;
  return jsonb_build_object('rimborsato', false, 'piatto', total, 'vincenti', winners);
end $$;

-- Risultato del podio: chi ha indovinato l'ordine esatto si divide tutto il piatto.
-- Se nessuno lo indovina, tutti vengono rimborsati.
create or replace function public.admin_settle_podium(p_market bigint, p_picks bigint[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  total bigint;
  win_total bigint;
  b record;
  pay bigint;
  winners int := 0;
begin
  if not public.is_admin() then raise exception 'Solo gli admin possono farlo'; end if;
  perform 1 from public.markets where id = p_market and status in ('aperto', 'chiuso') and kind = 'podio' for update;
  if not found then raise exception 'La domanda non è un podio aperto'; end if;
  if p_picks is null or cardinality(p_picks) <> 3 or array_position(p_picks, null) is not null
     or (select count(distinct x) from unnest(p_picks) x) <> 3
     or (select count(*) from public.options where market_id = p_market and id = any (p_picks)) <> 3 then
    raise exception 'Indica tre giocatori diversi di questa domanda';
  end if;

  select coalesce(sum(amount), 0) into total from public.bets where market_id = p_market;
  select coalesce(sum(amount), 0) into win_total from public.bets where market_id = p_market and picks = p_picks;

  if win_total = 0 then
    perform public.admin_void_market(p_market);
    update public.markets set winning_option = p_picks[1], podium = p_picks where id = p_market;
    return jsonb_build_object('rimborsato', true, 'piatto', total);
  end if;

  for b in select * from public.bets where market_id = p_market loop
    if b.picks = p_picks then
      pay := (b.amount * total) / win_total;
      winners := winners + 1;
      update public.profiles set balance = balance + pay where id = b.user_id;
      insert into public.transactions (user_id, amount, reason, market_id) values (b.user_id, pay, 'vincita', p_market);
    else
      pay := 0;
    end if;
    update public.bets set payout = pay where id = b.id;
  end loop;
  update public.markets set status = 'pagato', winning_option = p_picks[1], podium = p_picks where id = p_market;
  return jsonb_build_object('rimborsato', false, 'piatto', total, 'vincenti', winners);
end $$;

revoke execute on function public.place_podium_bet(bigint, bigint[], bigint), public.admin_settle_podium(bigint, bigint[]) from public, anon;
grant execute on function public.place_podium_bet(bigint, bigint[], bigint), public.admin_settle_podium(bigint, bigint[]) to authenticated;

-- ============================================================
-- Gestione degli admin dal sito (per dare l'accesso a Melagodo e ai moderatori)
-- ============================================================
create or replace function public.admin_list_admins() returns table (username text, avatar text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo gli admin possono farlo'; end if;
  return query select p.username, p.avatar from public.profiles p where p.is_admin order by lower(p.username);
end $$;

create or replace function public.admin_set_admin(p_username text, p_value boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo gli admin possono farlo'; end if;
  if not p_value and (select count(*) from public.profiles where is_admin) <= 1 then
    raise exception 'Deve restare almeno un admin';
  end if;
  update public.profiles set is_admin = p_value where lower(username) = lower(trim(p_username));
  if not found then raise exception 'Nessun account con il nome "%": deve prima registrarsi sul sito', p_username; end if;
end $$;

revoke execute on function public.admin_list_admins(), public.admin_set_admin(text, boolean) from public, anon;
grant execute on function public.admin_list_admins(), public.admin_set_admin(text, boolean) to authenticated;

-- ============================================================
-- Risultati inseriti dal pannello admin (il sito li legge a ogni aggiornamento)
-- ============================================================
create table if not exists public.match_results (
  video_id text primary key check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  game text not null default 'golf' check (game in ('golf', 'sbg', 'uno')),
  date date not null,
  title text not null check (char_length(title) between 1 and 200),
  channel text,
  map text,
  par int[],
  players jsonb not null check (jsonb_typeof(players) = 'array' and jsonb_array_length(players) between 1 and 16),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.match_results enable row level security;
drop policy if exists match_results_select on public.match_results;
drop policy if exists match_results_admin on public.match_results;
create policy match_results_select on public.match_results for select using (true);
create policy match_results_admin on public.match_results for all using (public.is_admin()) with check (public.is_admin());
grant select on public.match_results to anon, authenticated;
grant insert, update, delete on public.match_results to authenticated;
