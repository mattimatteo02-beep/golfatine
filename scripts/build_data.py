#!/usr/bin/env python3
"""Legge data/golfatine.xlsx e genera docs/data.js per il sito.

Uso:  python3 scripts/build_data.py

Regole (le stesse del foglio "Classifiche" del modello):
- ogni video è una partita; le stagioni sono gli anni solari;
- Golf With Your Friends e Super Battle Golf: conta la posizione finale di ogni giocatore;
- UNO: conta solo il vincitore del video;
- pari merito al 1° posto = vittoria per tutti;
- GTA e Trackmania per ora non sono inclusi.
"""
import datetime
import json
import pathlib

import openpyxl

ROOT = pathlib.Path(__file__).resolve().parent.parent
XLSX = ROOT / "data" / "golfatine.xlsx"
OUT = ROOT / "docs" / "data.js"

GAMES = {
    "Golf With Your Friends": {"id": "golf", "name": "Golf With Your Friends", "short": "Golf", "mode": "posizioni"},
    "Super Battle Golf": {"id": "sbg", "name": "Super Battle Golf", "short": "Super Battle Golf", "mode": "posizioni"},
    "UNO": {"id": "uno", "name": "UNO", "short": "UNO", "mode": "vincitore"},
}


def rows(ws):
    header = [c.value for c in ws[1]]
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[0] is None:
            continue
        yield dict(zip(header, r))


def ids(text):
    return [x.strip() for x in str(text or "").split(",") if x.strip()]


def main():
    wb = openpyxl.load_workbook(XLSX, data_only=False)

    players = {}
    for r in rows(wb["Giocatori"]):
        players[r["giocatore_id"]] = {
            "name": r["nome"],
            "alias": r["alias"] or "",
            "channels": r["canali_youtube"] or "",
            "guest": str(r["ospite_si_no"]).lower().startswith("s"),
        }

    maps = {}
    for r in rows(wb["Golf_Mappe"]):
        maps[r["mappa"]] = {"par": r["par_totale"], "holes": r["numero_buche"]}

    golf = {}
    for r in rows(wb["Golf"]):
        golf.setdefault(r["video_id"], []).append(r)
    sbg = {}
    for r in rows(wb["Super_Battle_Golf"]):
        sbg.setdefault(r["video_id"], []).append(r)

    matches, unreadable = [], []
    for r in rows(wb["Partite"]):
        game = GAMES.get(r["gioco"])
        if not game:
            continue
        date = str(r["data"])[:10]
        base = {
            "id": r["video_id"],
            "date": date,
            "season": int(date[:4]),
            "game": game["id"],
            "channel": r["canale"],
            "title": r["titolo"],
            "url": r["url"],
        }
        results = []
        if game["id"] == "golf" and r["video_id"] in golf:
            grows = golf[r["video_id"]]
            notes = " ".join(str(g["note"] or "") for g in grows)
            score_mode = "punteggio" in notes
            teams = "squadra" in notes
            mp = grows[0]["mappa"]
            base["map"] = mp
            info = maps.get(mp, {}) if mp else {}
            par = info.get("par")
            # par poco credibile (mappe con colpi illimitati o par letto male): niente confronto col par
            if par and not (30 <= par <= 100 and (info.get("holes") or 18) >= 9):
                par = None
            for g in grows:
                holes = [g[f"b{i}"] for i in range(1, 19)]
                played = [h for h in holes if isinstance(h, (int, float))]
                total = sum(played) if played else (g["totale_colpi"] if isinstance(g["totale_colpi"], (int, float)) else None)
                res = {"p": g["giocatore_id"], "pos": g["posizione"]}
                if not score_mode and total is not None:
                    res["strokes"] = int(total)
                    if played:
                        res["hio"] = sum(1 for h in played if h == 1)
                    if par and "buche a 0" not in str(g["note"] or ""):
                        res["toPar"] = int(total - par)
                results.append(res)
            if par:
                base["par"] = par
            if score_mode:
                base["format"] = "punti"
            if teams:
                base["format"] = "squadre"
        elif game["id"] == "sbg" and r["video_id"] in sbg:
            for g in sbg[r["video_id"]]:
                res = {"p": g["giocatore_id"], "pos": g["posizione"]}
                note = str(g["note"] or "")
                if "punteggio finale" in note:
                    try:
                        res["points"] = int(note.split("punteggio finale")[1].split(";")[0].strip())
                    except ValueError:
                        pass
                results.append(res)
        elif game["id"] == "uno" and r["vincitore"]:
            winners = set(ids(r["vincitore"]))
            parts = ids(r["partecipanti"])
            for w in winners:
                if w not in parts:
                    parts.append(w)
            results = [{"p": p, "pos": 1 if p in winners else None} for p in parts]

        if not results:
            unreadable.append({**base, "note": r["note"] or "risultato non disponibile"})
            continue
        results.sort(key=lambda x: (x["pos"] is None, x["pos"] or 0))
        base["results"] = results
        if r["note"]:
            base["note"] = r["note"]
        matches.append(base)

    matches.sort(key=lambda m: m["date"], reverse=True)
    unreadable.sort(key=lambda m: m["date"], reverse=True)

    games = []
    for g in GAMES.values():
        seasons = sorted({m["season"] for m in matches if m["game"] == g["id"]}, reverse=True)
        games.append({**g, "seasons": seasons})

    data = {
        "updated": datetime.date.today().isoformat(),
        "lastMatch": matches[0]["date"] if matches else None,
        "players": players,
        "games": games,
        "matches": matches,
        "unreadable": unreadable,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// File generato da scripts/build_data.py: non modificarlo a mano.\n"
        "window.GOLFATINE = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n",
        encoding="utf-8",
    )
    print(f"{len(matches)} partite, {len(unreadable)} senza risultato -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
