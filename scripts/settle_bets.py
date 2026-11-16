#!/usr/bin/env python3
"""Paga in automatico i pronostici sempre aperti ("prossimo video") e quelli di stagione.

Uso:  SUPABASE_SECRET_KEY=... python3 scripts/settle_bets.py
Gira nel workflow di GitHub Actions dopo build_data.py. Senza la chiave segreta non fa nulla.

Per ogni domanda "prossimo video" prende, in ordine di uscita, i video di quel gioco usciti dopo
l'ultimo turno pagato:
- se il video ha il risultato, paga le puntate fatte prima dell'uscita del video;
- se il risultato non c'è ancora, aspetta (fino a 7 giorni), poi rimborsa quel turno;
- se il video è segnato come "senza risultato leggibile", rimborsa subito quel turno.
"""
import datetime
import json
import os
import pathlib
import re
import sys
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parent.parent
ROME = ZoneInfo("Europe/Rome")
WAIT_DAYS = 7


def load_data():
    text = (ROOT / "docs" / "data.js").read_text(encoding="utf-8")
    return json.loads(re.search(r"=\s*(\{.*\});\s*$", text, re.S).group(1))


def load_published():
    p = ROOT / "data" / "published.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def video_id(entry):
    m = re.search(r"[?&]v=([A-Za-z0-9_-]{11})", entry.get("url") or "")
    return m.group(1) if m else str(entry["id"])[:11]


def published_at(vid, date, published):
    """Ora di uscita: quella vera se nota, altrimenti le 10:00 italiane del giorno (i video non escono prima)."""
    if vid in published:
        return datetime.datetime.fromisoformat(published[vid].replace("Z", "+00:00"))
    d = datetime.date.fromisoformat(date[:10])
    return datetime.datetime(d.year, d.month, d.day, 10, 0, tzinfo=ROME)


def outcome(entries):
    """Da tutte le partite di un video: chi ha giocato, chi ha vinto, il podio (se è chiaro)."""
    players, wins, podi, pos = set(), {}, {}, {}
    for m in entries:
        for r in m.get("results") or []:
            p = r["p"]
            players.add(p)
            if r.get("pos") is not None:
                pos.setdefault(p, []).append(r["pos"])
                wins[p] = wins.get(p, 0) + (r["pos"] == 1)
                podi[p] = podi.get(p, 0) + (r["pos"] <= 3)
    if not wins or max(wins.values()) == 0:
        return None
    top = max(wins.values())
    winners = sorted(p for p, w in wins.items() if w == top)
    podium = None
    if len(entries) == 1:
        at = {k: [p for p, ps in pos.items() if ps[0] == k] for k in (1, 2, 3)}
        if all(len(at[k]) == 1 for k in (1, 2, 3)):
            podium = [at[1][0], at[2][0], at[3][0]]
    else:
        key = {p: (-wins.get(p, 0), -podi.get(p, 0), sum(ps) / len(ps)) for p, ps in pos.items()}
        order = sorted(key, key=lambda p: key[p])
        if len(order) >= 4 and len({key[p] for p in order[:4]}) == 4:
            podium = order[:3]
    return {"players": sorted(players), "winners": winners, "podium": podium}


def standings(data, game, season):
    """Classifica di una stagione con le regole del sito: vittorie, poi podi, poi posizione media."""
    guest = {p for p, v in data["players"].items() if v.get("guest")}
    s = {}
    for m in data["matches"]:
        if m["game"] != game or m["season"] != season:
            continue
        for r in m["results"]:
            if r["p"] in guest:
                continue
            x = s.setdefault(r["p"], {"w": 0, "pod": 0, "sum": 0, "n": 0})
            if r.get("pos") is not None:
                x["w"] += r["pos"] == 1
                x["pod"] += r["pos"] <= 3
                x["sum"] += r["pos"]
                x["n"] += 1
    key = {p: (-x["w"], -x["pod"], x["sum"] / x["n"] if x["n"] else 99) for p, x in s.items()}
    order = sorted(key, key=lambda p: key[p])
    if not order:
        return None
    winners = [p for p in order if key[p] == key[order[0]]]
    podium = order[:3] if len(order) >= 4 and len({key[p] for p in order[:4]}) == 4 else None
    return {"winners": winners, "podium": podium}


class Supabase:
    def __init__(self, key):
        cfg = (ROOT / "docs" / "config.js").read_text(encoding="utf-8")
        self.url = re.search(r'supabaseUrl:\s*"([^"]+)"', cfg).group(1)
        self.headers = {"apikey": key, "Content-Type": "application/json"}
        if key.startswith("eyJ"):  # vecchia chiave service_role (JWT)
            self.headers["Authorization"] = "Bearer " + key

    def req(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(self.url + path, data=data, method=method, headers=self.headers)
        try:
            with urllib.request.urlopen(r, timeout=30) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path}: {e.code} {e.read().decode(errors='replace')[:300]}") from None

    def get(self, path):
        return self.req("GET", path)

    def rpc(self, name, **args):
        return self.req("POST", f"/rest/v1/rpc/{name}", args)


def main():
    key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
    if not key:
        print("SUPABASE_SECRET_KEY non impostata: pagamento automatico dei pronostici saltato.")
        return
    sb = Supabase(key)
    data = load_data()
    published = load_published()
    now = datetime.datetime.now(datetime.timezone.utc)

    # Tutti i video conosciuti, raggruppati per gioco e per video
    videos = {}
    for kind, items in (("risultato", data["matches"]), ("attesa", data.get("pending", [])), ("illeggibile", data.get("unreadable", []))):
        for e in items:
            vid = video_id(e)
            v = videos.setdefault((e["game"], vid), {"id": vid, "game": e["game"], "date": e["date"], "entries": [], "kind": kind})
            if kind == "risultato":
                v["entries"].append(e)
                v["kind"] = "risultato"
    for v in videos.values():
        v["published"] = published_at(v["id"], v["date"], published)

    markets = sb.get("/rest/v1/markets?scope=eq.prossimo&select=id,game,kind,created_at,question")
    rounds = sb.get("/rest/v1/market_rounds?select=market_id,video_id,published_at")
    done = {(r["market_id"], r["video_id"]) for r in rounds}
    for m in markets:
        mine = [datetime.datetime.fromisoformat(r["published_at"]) for r in rounds if r["market_id"] == m["id"]]
        since = max(mine) if mine else datetime.datetime.fromisoformat(m["created_at"])
        todo = sorted((v for (g, _), v in videos.items() if g == m["game"] and v["published"] >= since and (m["id"], v["id"]) not in done),
                      key=lambda v: v["published"])
        for v in todo:
            when = v["published"].isoformat()
            res = outcome(v["entries"]) if v["kind"] == "risultato" else None
            if res:
                out = sb.rpc("bot_settle_round", p_market=m["id"], p_video=v["id"], p_published=when,
                             p_players=res["players"], p_winners=res["winners"], p_podium=res["podium"])
                print(f"pagato: {m['question']} · video {v['id']} · {out}")
            elif v["kind"] == "illeggibile" or (now - v["published"]).days >= WAIT_DAYS:
                out = sb.rpc("bot_void_round", p_market=m["id"], p_video=v["id"], p_published=when)
                print(f"rimborsato (senza risultato): {m['question']} · video {v['id']} · {out}")
            else:
                print(f"in attesa del risultato: {m['question']} · video {v['id']}")
                break  # i video dopo si pagano solo quando c'è il risultato di questo

    # Pronostici di stagione: si pagano dal 1° gennaio dell'anno dopo
    today = datetime.datetime.now(ROME).date()
    for m in sb.get("/rest/v1/markets?scope=eq.stagione&status=in.(aperto,chiuso)&select=id,game,season,question"):
        if not m.get("season") or today < datetime.date(m["season"] + 1, 1, 1):
            continue
        st = standings(data, m["game"], m["season"])
        if not st:
            continue
        out = sb.rpc("bot_settle_season", p_market=m["id"], p_winners=st["winners"], p_podium=st["podium"])
        print(f"stagione: {m['question']} · {out}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - il sito si aggiorna comunque
        print(f"pagamento dei pronostici non riuscito: {e}", file=sys.stderr)
        sys.exit(1)
