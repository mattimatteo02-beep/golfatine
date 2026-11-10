#!/usr/bin/env python3
"""Controlla i canali YouTube del gruppo e aggiunge al foglio le nuove golfatine.

Uso:  python3 scripts/check_new_videos.py
Esce con codice 0 e scrive "nuovi=N" su stdout (e in $GITHUB_OUTPUT, se c'è).

Legge i feed RSS pubblici dei canali (nessuna chiave serve). Ogni video nuovo con "golf"
nel titolo finisce nel foglio Partite come "in arrivo": il sito lo mostra subito come
ultima golfatina uscita, e il risultato si aggiunge poi a mano (foglio Golf).
"""
import datetime
import os
import pathlib
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET

import openpyxl

ROOT = pathlib.Path(__file__).resolve().parent.parent
XLSX = ROOT / "data" / "golfatine.xlsx"
PENDING_NOTE = "aggiunta in automatico"

# Canali dove escono le golfatine (nome come nel foglio -> id del canale)
CHANNELS = {
    "Just Rohn JR": "UCFC5MMXpoLq4MTJpli_mXDg",
    "Delux": "UCOwBvtQrGrXzlzq2JaAIqmw",
    "GaBBoDSQ": "UCck1Wrv-6h44db16OL4geOQ",
    "Around Dread": "UCW3E__9XjSlKvmX5PHH7hzg",
    "JTaz Extra": "UCCtG3gCdGtDVPPmJpmXkIuQ",
    "oessaM": "UCpSyY997DngPOy5OtFzx9oQ",
    "ilMasseo": "UCH5dV7XjIpPGtqYlHXtG20Q",
    "Mollu": "UCRpBCZHwzEdkuCyvbP5AvHg",
}
OWNER = {"Just Rohn JR": "rohn", "Delux": "delux", "GaBBoDSQ": "gabbo", "Around Dread": "dread",
         "JTaz Extra": "jtaz", "oessaM": "masseo", "ilMasseo": "masseo", "Mollu": "mollu"}
# Come vengono scritti i nomi nei titoli
NAMES = {
    "rohn": r"rohn|\bjr\b", "delux": r"delux|\bdelu\b|deluca|de luca", "gabbo": r"gabbo|gabby",
    "dread": r"dread", "mollu": r"mollu|mollura", "masseo": r"masseo", "jtaz": r"jtaz",
}
NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015", "media": "http://search.yahoo.com/mrss/"}


def feed(channel_id):
    url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    req = urllib.request.Request(url, headers={"User-Agent": "golfatine-site/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        root = ET.fromstring(r.read())
    for e in root.findall("a:entry", NS):
        link = e.find("a:link", NS).get("href", "")
        yield {
            "id": e.find("yt:videoId", NS).text,
            "title": e.find("a:title", NS).text or "",
            "published": e.find("a:published", NS).text or "",
            "short": "/shorts/" in link,
        }


def main():
    wb = openpyxl.load_workbook(XLSX)
    ws = wb["Partite"]
    header = [c.value for c in ws[1]]
    col = {h: i + 1 for i, h in enumerate(header) if h}
    known = {r[0] for r in ws.iter_rows(min_row=2, values_only=True) if r[0]}
    last_row = max((i for i, r in enumerate(ws.iter_rows(values_only=True), 1) if r[0]), default=1)
    # Solo video recenti: quelli vecchi rimasti fuori dal foglio sono stati esclusi apposta
    since = (datetime.date.today() - datetime.timedelta(days=10)).isoformat()

    added, failed = [], []
    for channel, cid in CHANNELS.items():
        try:
            videos = list(feed(cid))
        except Exception as e:  # un canale che non risponde non blocca gli altri
            failed.append(f"{channel}: {e}")
            continue
        for v in videos:
            t = v["title"]
            if v["short"] or v["id"] in known or v["published"][:10] < since or not re.search(r"golf", t, re.I):
                continue
            game = "Super Battle Golf" if re.search(r"battle\s*golf", t, re.I) else "Golf With Your Friends"
            players = [p for p, rx in NAMES.items() if re.search(rx, t, re.I)]
            if OWNER[channel] not in players:
                players.insert(0, OWNER[channel])
            last_row += 1
            values = {
                "video_id": v["id"], "data": v["published"][:10], "gioco": game, "canale": channel, "titolo": t,
                "partecipanti": ", ".join(players), "url": f"https://www.youtube.com/watch?v={v['id']}",
                "note": f"{PENDING_NOTE} il {datetime.date.today().strftime('%d/%m')}: risultato da inserire",
            }
            for k, val in values.items():
                if k in col:
                    ws.cell(last_row, col[k], val)
            known.add(v["id"])
            added.append(f"{values['data']} {channel}: {t}")

    if added:
        wb.save(XLSX)
    for a in added:
        print("nuovo:", a)
    for f in failed:
        print("canale non raggiunto:", f, file=sys.stderr)
    print(f"nuovi={len(added)}")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as fh:
            fh.write(f"nuovi={len(added)}\n")


if __name__ == "__main__":
    main()
