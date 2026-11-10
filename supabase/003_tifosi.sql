-- Aggiornamento 003: quanti fan tifano ogni giocatore (in base alla pallina scelta).
-- Da eseguire nel SQL Editor di Supabase DOPO 002 (si può rieseguire senza danni).
-- Restituisce solo i totali, mai chi sono i fan.
create or replace function public.fan_counts() returns table (avatar text, fans int)
language sql stable security definer set search_path = public as $$
  select p.avatar, count(*)::int from public.profiles p
  where p.username is not null
  group by p.avatar
$$;
revoke execute on function public.fan_counts() from public;
grant execute on function public.fan_counts() to anon, authenticated;
