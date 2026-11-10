# Golfatine

Sito delle classifiche delle golfatine del gruppo MELAGODO: ogni video è una partita, ogni anno è una stagione.

## Struttura

- `data/golfatine.xlsx`: il modello di raccolta dati compilato (fonte unica dei risultati).
- `scripts/build_data.py`: legge il modello e genera `docs/data.js`.
- `docs/`: il sito statico (HTML, CSS, JS senza dipendenze).

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
