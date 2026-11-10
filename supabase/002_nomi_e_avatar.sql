-- Aggiornamento 002: nome utente e avatar scelti già alla registrazione.
-- Da eseguire nel SQL Editor di Supabase DOPO schema.sql (si può rieseguire senza danni).

-- Avatar: una pallina da golf colorata
alter table public.profiles add column if not exists avatar text not null default 'rossa';
alter table public.profiles drop constraint if exists profiles_avatar_check;
alter table public.profiles add constraint profiles_avatar_check
  check (avatar in ('rossa', 'rosa', 'verde', 'arancione', 'viola', 'blu-scuro', 'blu-chiaro'));

-- I fan possono cambiare nome e avatar, nient'altro
revoke update on public.profiles from anon, authenticated;
grant update (username, avatar) on public.profiles to authenticated;

-- Alla registrazione prende nome e avatar dal modulo (se il nome è valido e libero)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  bonus bigint := (public.economy()->>'benvenuto')::bigint;
  wanted text := nullif(trim(new.raw_user_meta_data->>'username'), '');
  av text := coalesce(new.raw_user_meta_data->>'avatar', 'rossa');
begin
  if wanted is null or wanted !~ '^[A-Za-z0-9_.]{3,20}$'
     or exists (select 1 from public.profiles where lower(username) = lower(wanted)) then
    wanted := null;   -- lo sceglierà al primo accesso
  end if;
  if av not in ('rossa', 'rosa', 'verde', 'arancione', 'viola', 'blu-scuro', 'blu-chiaro') then av := 'rossa'; end if;
  insert into public.profiles (id, balance, username, avatar) values (new.id, bonus, wanted, av);
  insert into public.transactions (user_id, amount, reason) values (new.id, bonus, 'benvenuto');
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Nomi unici senza distinguere maiuscole e minuscole
create unique index if not exists profiles_username_lower_idx on public.profiles (lower(username));

-- Controllo "nome libero?" durante la registrazione (dice solo sì o no)
create or replace function public.username_available(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_name ~ '^[A-Za-z0-9_.]{3,20}$'
     and not exists (select 1 from public.profiles where lower(username) = lower(p_name))
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- Classifica dei fan con avatar
create or replace view public.fan_leaderboard as
  select p.username, p.balance,
    (select count(*) from public.bets b where b.user_id = p.id and b.payout > b.amount)::int as wins,
    (select count(*) from public.bets b where b.user_id = p.id)::int as bets,
    p.avatar
  from public.profiles p
  where p.username is not null and not p.is_admin
  order by p.balance desc
  limit 100;
grant select on public.fan_leaderboard to anon, authenticated;
