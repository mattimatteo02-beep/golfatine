#!/usr/bin/env python3
"""Legge data/golfatine.xlsx e genera docs/data.js per il sito.

Uso:  python3 scripts/build_data.py

Regole (le stesse del foglio "Classifiche" del modello):
- ogni video è una partita; le stagioni sono gli anni solari;
- Golf With Your Friends e Super Battle Golf: conta la posizione finale di ogni giocatore;
- UNO: conta solo il vincitore del video;
- Sdrogo Corse (GTA V, dal 2016): ogni video è un elenco di gare, conta la posizione finale
  nell'elenco; in più si contano le singole gare vinte;
- pari merito al 1° posto = vittoria per tutti;
- Trackmania per ora non è incluso.
"""
import datetime
import json
import os
import pathlib
import re
import sys
import urllib.request

import openpyxl

ROOT = pathlib.Path(__file__).resolve().parent.parent
XLSX = ROOT / "data" / "golfatine.xlsx"
OUT = ROOT / "docs" / "data.js"

GAMES = {
    "Golf With Your Friends": {"id": "golf", "name": "Golf With Your Friends", "short": "Golf", "mode": "posizioni"},
    "Super Battle Golf": {"id": "sbg", "name": "Super Battle Golf", "short": "Super Battle Golf", "mode": "posizioni"},
    "UNO": {"id": "uno", "name": "UNO", "short": "UNO", "mode": "vincitore"},
    "GTA V Online": {"id": "gta", "name": "Sdrogo Corse (GTA V)", "short": "Sdrogo Corse", "mode": "posizioni"},
}


GAME_IDS = {g["id"] for g in GAMES.values()}


def site_results():
    """Risultati inseriti dal pannello admin (tabella match_results su Supabase).

    Usa l'indirizzo e la chiave pubblica di docs/config.js. Se il database non risponde
    si va avanti con i soli dati del foglio."""
    if os.environ.get("GOLFATINE_OFFLINE"):
        return []
    cfg = (ROOT / "docs" / "config.js").read_text(encoding="utf-8")
    url = re.search(r'supabaseUrl:\s*"([^"]+)"', cfg)
    key = re.search(r'supabaseAnonKey:\s*"([^"]+)"', cfg)
    if not url or not key:
        return []
    req = urllib.request.Request(url.group(1) + "/rest/v1/match_results?select=*",
                                 headers={"apikey": key.group(1), "Authorization": "Bearer " + key.group(1)})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except Exception as e:  # noqa: BLE001
        print(f"risultati dal sito non letti ({e}): uso solo il foglio", file=sys.stderr)
        return []


def match_from_site(r, maps_par):
    """Trasforma una riga di match_results nel formato delle partite del sito."""
    game = r.get("game") or "golf"
    if game not in GAME_IDS:
        return None
    date = str(r["date"])[:10]
    m = {"id": r["video_id"], "date": date, "season": int(date[:4]), "game": game,
         "channel": r.get("channel") or "", "title": r["title"],
         "url": f"https://www.youtube.com/watch?v={r['video_id']}"}
    par_list = [x for x in (r.get("par") or []) if isinstance(x, int)]
    par = sum(par_list) if par_list else maps_par.get(r.get("map"))
    if r.get("map"):
        m["map"] = r["map"]
    if par and not (30 <= par <= 100):
        par = None
    results = []
    for pl in r.get("players") or []:
        res = {"p": pl.get("p"), "pos": pl.get("pos")}
        holes = [h for h in (pl.get("holes") or []) if isinstance(h, int) and h > 0]
        if game == "golf" and holes:
            res["strokes"] = sum(holes)
            res["hio"] = sum(1 for h in holes if h == 1)
            if par and len(holes) == len(par_list or holes):
                res["toPar"] = res["strokes"] - par
        if res["p"]:
            results.append(res)
    if game == "golf" and any("strokes" in x for x in results) and all(x["pos"] is None for x in results):
        # posizioni dai colpi totali (pari merito = stessa posizione)
        tot = sorted(x["strokes"] for x in results if "strokes" in x)
        for x in results:
            if "strokes" in x:
                x["pos"] = tot.index(x["strokes"]) + 1
    if not results:
        return None
    if par and game == "golf":
        m["par"] = par
    results.sort(key=lambda x: (x["pos"] is None, x["pos"] or 0))
    m["results"] = results
    m["note"] = "risultato inserito dal pannello admin"
    return m


def rows(ws):
    header = [c.value for c in ws[1]]
    for r in ws.iter_rows(min_row=2, values_only=True):
        if r[0] is None:
            continue
        yield dict(zip(header, r))


def ids(text):
    # gli ospiti nel foglio sono scritti "nome (ospite)": sul sito l'ospite si riconosce da solo
    return [x.strip().removesuffix(" (ospite)") for x in str(text or "").split(",") if x.strip()]


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
        n = r["numero_buche"] if isinstance(r["numero_buche"], int) else 0
        pars = [r.get(f"par_b{i}") for i in range(1, n + 1)]
        if n and all(isinstance(x, int) for x in pars):
            maps[r["mappa"]]["pars"] = pars

    golf = {}
    for r in rows(wb["Golf"]):
        golf.setdefault(r["video_id"], []).append(r)
    sbg = {}
    for r in rows(wb["Super_Battle_Golf"]):
        sbg.setdefault(r["video_id"], []).append(r)
    gta = {}
    for r in rows(wb["GTA_Corse"]):
        gta.setdefault(r["video_id"], []).append(r)

    matches, unreadable, pending = [], [], []
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
        elif game["id"] == "gta" and r["video_id"] in gta:
            for g in gta[r["video_id"]]:
                note = str(g["note"] or "")
                pos = re.search(r"posizione (\d+)", note)
                tot = re.search(r"totale (\d+)", note)
                res = {"p": ids(g["giocatore_id"])[0], "pos": int(pos.group(1)) if pos else None}
                if tot:
                    res["points"] = int(tot.group(1))
                if isinstance(g["primi_posti"], int):
                    res["races"] = g["primi_posti"]
                results.append(res)
            lista = re.search(r"lista '([^']+)'", str(r["note"] or ""))
            if lista:
                base["list"] = lista.group(1)
        elif game["id"] == "uno" and r["vincitore"]:
            winners = set(ids(r["vincitore"]))
            parts = ids(r["partecipanti"])
            for w in winners:
                if w not in parts:
                    parts.append(w)
            results = [{"p": p, "pos": 1 if p in winners else None} for p in parts]

        if not results and str(r["note"] or "").startswith("aggiunta in automatico"):
            pending.append({**base, "players": ids(r["partecipanti"])})
            continue
        if not results:
            unreadable.append({**base, "note": r["note"] or "risultato non disponibile"})
            continue
        results.sort(key=lambda x: (x["pos"] is None, x["pos"] or 0))
        base["results"] = results
        if r["note"]:
            base["note"] = r["note"]
        matches.append(base)

    # I risultati inseriti dal sito hanno la precedenza su quelli del foglio
    maps_par = {k: v["par"] for k, v in maps.items() if isinstance(v.get("par"), (int, float))}
    for r in site_results():
        sm = match_from_site(r, maps_par)
        if not sm:
            continue
        if sm["results"] and all(x["p"] in players for x in sm["results"]):
            matches = [x for x in matches if x["id"] != sm["id"]]
            unreadable = [x for x in unreadable if x["id"] != sm["id"]]
            pending = [x for x in pending if x["id"] != sm["id"]]
            matches.append(sm)

    matches.sort(key=lambda m: m["date"], reverse=True)
    unreadable.sort(key=lambda m: m["date"], reverse=True)
    pending.sort(key=lambda m: m["date"], reverse=True)

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
        "pending": pending,
        # par di ogni buca delle mappe conosciute (serve al modulo dei risultati nel pannello admin)
        "maps": {k: v["pars"] for k, v in sorted(maps.items()) if v.get("pars")},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    text = lambda d: ("// File generato da scripts/build_data.py: non modificarlo a mano.\n"  # noqa: E731
                      "window.GOLFATINE = " + json.dumps(d, ensure_ascii=False, indent=1) + ";\n")
    # Se cambia solo la data di aggiornamento, il file resta com'è (niente pubblicazioni inutili)
    if OUT.exists():
        old = OUT.read_text(encoding="utf-8")
        m = re.search(r'"updated": "([0-9-]+)"', old)
        if m and old == text({**data, "updated": m.group(1)}):
            print("nessuna novità nei dati")
            return
    OUT.write_text(text(data), encoding="utf-8")
    print(f"{len(matches)} partite, {len(unreadable)} senza risultato -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
