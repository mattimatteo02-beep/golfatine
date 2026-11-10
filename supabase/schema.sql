-- Golfatine: login dei fan, post degli admin e pronostici con valuta virtuale.
-- Da eseguire una volta nel SQL Editor di Supabase (progetto nuovo).
-- La valuta ("gettoni") non ha alcun valore monetario: non si compra e non si converte.

-- ============================================================
-- Tabelle
-- ============================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique check (username ~ '^[A-Za-z0-9_.]{3,20}$'),
  balance bigint not null default 0 check (balance >= 0),
  is_admin boolean not null default false,
  last_daily date,
  daily_streak int not null default 0,
  last_rescue timestamptz,
  created_at timestamptz not null default now()
);

create table public.posts (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 3 and 140),
  body text,
  video_url text,
  game text,
  published boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.markets (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.posts(id) on delete cascade,
  question text not null check (char_length(question) between 3 and 200),
  closes_at timestamptz not null,
  status text not null default 'aperto' check (status in ('aperto', 'chiuso', 'pagato', 'annullato')),
  winning_option bigint,
  created_at timestamptz not null default now()
);

create table public.options (
  id bigint generated always as identity primary key,
  market_id bigint not null references public.markets(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  sort int not null default 0
);

alter table public.markets
  add constraint markets_winning_option_fk foreign key (winning_option) references public.options(id);

create table public.bets (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  market_id bigint not null references public.markets(id) on delete restrict,
  option_id bigint not null references public.options(id) on delete restrict,
  amount bigint not null check (amount > 0),
  payout bigint,
  created_at timestamptz not null default now()
);
create index bets_market_idx on public.bets(market_id);
create index bets_user_idx on public.bets(user_id);

create table public.transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount bigint not null,
  reason text not null check (reason in ('benvenuto', 'giornaliero', 'salvagente', 'puntata', 'vincita', 'rimborso')),
  market_id bigint references public.markets(id) on delete set null,
  created_at timestamptz not null default now()
);
create index transactions_user_idx on public.transactions(user_id, created_at desc);

-- ============================================================
-- Regole economiche (modificabili qui)
-- ============================================================

create or replace function public.economy() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'benvenuto', 1000,      -- gettoni alla registrazione
    'giornaliero', 100,     -- bonus del primo accesso del giorno
    'serie_extra', 20,      -- +20 per ogni giorno di fila, fino a +100
    'serie_max', 5,
    'salvagente', 200,      -- ricarica se resti quasi a zero
    'salvagente_soglia', 50,
    'salvagente_giorni', 7,
    'puntata_min', 10
  )
$$;

-- ============================================================
-- Funzioni di servizio
-- ============================================================

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.today_rome() returns date
language sql stable as $$ select (now() at time zone 'Europe/Rome')::date $$;

-- Nuovo utente: profilo + gettoni di benvenuto
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare bonus bigint := (public.economy()->>'benvenuto')::bigint;
begin
  insert into public.profiles (id, balance) values (new.id, bonus);
  insert into public.transactions (user_id, amount, reason) values (new.id, bonus, 'benvenuto');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Azioni dei fan
-- ============================================================

-- Bonus giornaliero (una volta al giorno, ora italiana), con serie di giorni consecutivi
create or replace function public.claim_daily() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.profiles;
  e jsonb := public.economy();
  t date := public.today_rome();
  streak int;
  bonus bigint;
begin
  select * into p from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Devi accedere per riscattare il bonus'; end if;
  if p.last_daily = t then raise exception 'Bonus di oggi già riscattato'; end if;
  streak := case when p.last_daily = t - 1 then p.daily_streak + 1 else 1 end;
  bonus := (e->>'giornaliero')::bigint
         + (e->>'serie_extra')::bigint * least(streak - 1, (e->>'serie_max')::int);
  update public.profiles set balance = balance + bonus, last_daily = t, daily_streak = streak where id = p.id;
  insert into public.transactions (user_id, amount, reason) values (p.id, bonus, 'giornaliero');
  return jsonb_build_object('bonus', bonus, 'streak', streak, 'balance', p.balance + bonus);
end $$;

-- Salvagente: se resti sotto la soglia, una ricarica a settimana
create or replace function public.claim_rescue() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p public.profiles;
  e jsonb := public.economy();
  bonus bigint := (e->>'salvagente')::bigint;
begin
  select * into p from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Devi accedere per usare il salvagente'; end if;
  if p.balance >= (e->>'salvagente_soglia')::bigint then
    raise exception 'Il salvagente è per chi ha meno di % gettoni', e->>'salvagente_soglia';
  end if;
  if p.last_rescue is not null and p.last_rescue > now() - make_interval(days => (e->>'salvagente_giorni')::int) then
    raise exception 'Salvagente già usato negli ultimi % giorni', e->>'salvagente_giorni';
  end if;
  update public.profiles set balance = balance + bonus, last_rescue = now() where id = p.id;
  insert into public.transactions (user_id, amount, reason) values (p.id, bonus, 'salvagente');
  return jsonb_build_object('bonus', bonus, 'balance', p.balance + bonus);
end $$;

-- Puntata su un'opzione (sistema a montepremi: chi indovina si divide tutto il piatto)
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

-- ============================================================
-- Azioni degli admin
-- ============================================================

create or replace function public.admin_close_market(p_market bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo gli admin possono farlo'; end if;
  update public.markets set status = 'chiuso' where id = p_market and status = 'aperto';
  if not found then raise exception 'La domanda non è aperta'; end if;
end $$;

-- Rimborsa tutte le puntate di una domanda
create or replace function public.admin_void_market(p_market bigint) returns void
language plpgsql security definer set search_path = public as $$
declare b record;
begin
  if not public.is_admin() then raise exception 'Solo gli admin possono farlo'; end if;
  perform 1 from public.markets where id = p_market and status in ('aperto', 'chiuso') for update;
  if not found then raise exception 'La domanda è già stata chiusa con un risultato'; end if;
  for b in select * from public.bets where market_id = p_market loop
    update public.bets set payout = b.amount where id = b.id;
    update public.profiles set balance = balance + b.amount where id = b.user_id;
    insert into public.transactions (user_id, amount, reason, market_id) values (b.user_id, b.amount, 'rimborso', p_market);
  end loop;
  update public.markets set status = 'annullato' where id = p_market;
end $$;

-- Indica il risultato e paga: ogni vincente riceve puntata × (piatto totale / puntate sul vincente)
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
  if not exists (select 1 from public.options where id = p_option and market_id = p_market) then
    raise exception 'L''opzione non appartiene a questa domanda';
  end if;

  select coalesce(sum(amount), 0) into total from public.bets where market_id = p_market;
  select coalesce(sum(amount), 0) into win_total from public.bets where market_id = p_market and option_id = p_option;

  if win_total = 0 then
    -- nessuno ha indovinato: si rimborsa tutti
    perform public.admin_void_market(p_market);
    update public.markets set winning_option = p_option where id = p_market;
    return jsonb_build_object('rimborsato', true, 'piatto', total);
  end if;

  for b in select * from public.bets where market_id = p_market loop
    if b.option_id = p_option then
      pay := (b.amount * total) / win_total;   -- arrotondato per difetto
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

-- ============================================================
-- Viste pubbliche (aggregati, senza dati personali)
-- ============================================================

create view public.option_totals as
  select o.id as option_id, o.market_id, coalesce(sum(b.amount), 0)::bigint as total, count(b.id)::int as bettors
  from public.options o left join public.bets b on b.option_id = o.id
  group by o.id, o.market_id;

create view public.fan_leaderboard as
  select p.username, p.balance,
    (select count(*) from public.bets b where b.user_id = p.id and b.payout > b.amount)::int as wins,
    (select count(*) from public.bets b where b.user_id = p.id)::int as bets
  from public.profiles p
  where p.username is not null and not p.is_admin
  order by p.balance desc
  limit 100;

-- ============================================================
-- Sicurezza (Row Level Security)
-- ============================================================

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.markets enable row level security;
alter table public.options enable row level security;
alter table public.bets enable row level security;
alter table public.transactions enable row level security;

-- profili: ognuno vede il proprio, può cambiare solo il nome utente
create policy profiles_select on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (username) on public.profiles to authenticated;

-- post, domande, opzioni: tutti leggono i pubblicati, solo gli admin scrivono
create policy posts_select on public.posts for select using (published or public.is_admin());
create policy posts_admin on public.posts for all using (public.is_admin()) with check (public.is_admin());

create policy markets_select on public.markets for select
  using (exists (select 1 from public.posts p where p.id = post_id and (p.published or public.is_admin())));
create policy markets_admin_insert on public.markets for insert with check (public.is_admin() and status = 'aperto');
create policy markets_admin_update on public.markets for update using (public.is_admin()) with check (public.is_admin());
create policy markets_admin_delete on public.markets for delete using (public.is_admin());
-- lo stato e il risultato cambiano solo tramite le funzioni admin_* (che pagano)
revoke update on public.markets from anon, authenticated;
grant update (question, closes_at) on public.markets to authenticated;

create policy options_select on public.options for select
  using (exists (select 1 from public.markets m where m.id = market_id));
create policy options_admin on public.options for all using (public.is_admin()) with check (public.is_admin());

-- puntate e movimenti: solo i propri, e si creano solo tramite funzioni
create policy bets_select on public.bets for select using (user_id = auth.uid() or public.is_admin());
create policy transactions_select on public.transactions for select using (user_id = auth.uid());
revoke insert, update, delete on public.bets, public.transactions from anon, authenticated;

grant select on public.option_totals, public.fan_leaderboard to anon, authenticated;

-- le funzioni interne non si chiamano da fuori
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.claim_daily(), public.claim_rescue(), public.place_bet(bigint, bigint),
  public.admin_close_market(bigint), public.admin_void_market(bigint), public.admin_settle_market(bigint, bigint)
  from public, anon;
grant execute on function public.claim_daily(), public.claim_rescue(), public.place_bet(bigint, bigint),
  public.admin_close_market(bigint), public.admin_void_market(bigint), public.admin_settle_market(bigint, bigint)
  to authenticated;

-- ============================================================
-- Per nominare un admin (dopo che si è registrato sul sito):
--   update public.profiles set is_admin = true where username = 'NOME';
-- ============================================================
