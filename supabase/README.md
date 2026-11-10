# Attivare login, post e pronostici (Supabase)

Il sito resta statico (GitHub Pages). Login, gettoni, post e puntate stanno su Supabase, che ha un piano gratuito.

1. Crea un account su https://supabase.com e un nuovo progetto (regione Europa, es. Frankfurt).
2. Apri **SQL Editor**, incolla tutto `supabase/schema.sql` e premi **Run**.
3. In **Authentication → URL Configuration** metti come *Site URL* l'indirizzo del sito
   (es. `https://mattimatteo02-beep.github.io/golfatine/`) e aggiungilo anche tra i *Redirect URLs*.
4. In **Project Settings → API** copia *Project URL* e la chiave *anon public* dentro `docs/config.js`.
5. Registrati sul sito con la tua email, scegli il nome utente, poi nel SQL Editor rendi admin il tuo account:
   `update public.profiles set is_admin = true where username = 'TUO_NOME';`
6. Il pannello admin è su `admin.html` (il link compare accanto al tuo nome quando sei admin).

## Come funziona

- **Gettoni**: 1.000 alla registrazione, bonus giornaliero di 100 (+20 per ogni giorno di fila, fino a 200),
  salvagente di 200 una volta a settimana se scendi sotto 50. Le cifre si cambiano nella funzione `economy()`.
- **Pronostici a montepremi**: tutte le puntate su una domanda formano il piatto; chi indovina se lo divide
  in proporzione a quanto ha puntato. Se nessuno indovina, tutti vengono rimborsati.
- **Sicurezza**: i fan non possono modificare saldo o puntate direttamente; tutto passa da funzioni del database
  che controllano saldo, scadenza e permessi. Solo gli admin creano post e pagano i risultati.
- I gettoni non hanno valore monetario: non si comprano, non si vendono e non si convertono.

L'invio delle email di login usa il servizio di Supabase, che nel piano gratuito ha un limite di pochi invii all'ora:
per un pubblico grande conviene collegare un servizio SMTP (Authentication → Emails → SMTP).
