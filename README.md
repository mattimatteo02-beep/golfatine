# UMC · United Melagodo Championship

![UMC](docs/umc-logo.svg)

Sito della UMC (United Melagodo Championship), le classifiche del gruppo MELAGODO; per ora contiene le golfatine: ogni video è una partita, ogni anno è una stagione.

## Struttura

- `data/golfatine.xlsx`: il modello di raccolta dati compilato (fonte unica dei risultati).
- `scripts/build_data.py`: legge il modello e genera `docs/data.js`.
- `docs/`: il sito statico (HTML, CSS, JS senza build).
- `docs/admin.html`: pannello admin per pubblicare i post e pagare i pronostici.
- `supabase/`: database per login dei fan, gettoni e pronostici (istruzioni in `supabase/README.md`).

## Aggiornare i dati

1. Aggiungi la partita nel foglio `Partite` del modello e i risultati nel foglio del gioco (`Golf`, `Super_Battle_Golf`, o solo il vincitore per UNO).
2. `pip install openpyxl && python3 scripts/build_data.py`
3. Fai commit di `data/golfatine.xlsx` e `docs/data.js`.

## Vedere il sito

Apri `docs/index.html` nel browser, oppure pubblicalo con GitHub Pages
(Settings → Pages → Deploy from a branch → `main`, cartella `/docs`).

## Regole

Classifica per vittorie, poi podi, poi posizione media. Pari merito al primo posto vale una vittoria per tutti.
UNO conta solo il vincitore del video. Ospiti esclusi dalle classifiche. GTA escluso, Trackmania in arrivo.

## Aggiornamento automatico

`.github/workflows/aggiorna-golfatine.yml` gira ogni ora (dalle 7 a mezzanotte, ora italiana) e si può lanciare a mano da
**Actions → Aggiorna golfatine → Run workflow**. Legge i feed RSS dei canali del gruppo (`scripts/check_new_videos.py`):
ogni nuovo video con "golf" nel titolo entra nel foglio come "in arrivo", il sito lo mostra subito in "Ultima golfatina"
e lo pubblica. Il risultato (foglio Golf) si aggiunge poi a mano; la nota "aggiunta in automatico" va tolta quando c'è.
