(function () {
  "use strict";
  const D = window.GOLFATINE;
  const CUR = Number(D.updated.slice(0, 4));
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const GAME = Object.fromEntries(D.games.map((g) => [g.id, g]));
  // Ogni giocatore ha la sua pallina (stessi colori degli avatar dei fan)
  const COLORS = { rohn: "#d7263d", dread: "#f06aa8", delux: "#2fa152", gabbo: "#f28c18", mollu: "#8250c8", jtaz: "#1f3f94", masseo: "#4fb3f0" };
  const DIMPLES = [[11, 9], [17, 8], [22, 11], [8, 15], [14, 14], [20, 16], [25, 17], [10, 21], [16, 20], [22, 22], [13, 26], [19, 26]];
  const core = Object.keys(D.players).filter((p) => !D.players[p].guest);

  const name = (p) => (D.players[p] ? D.players[p].name : p);
  const guest = (p) => !D.players[p] || D.players[p].guest;
  const color = (p) => COLORS[p] || "#6b7a70";
  const initial = (p) => name(p).replace(/^il\s+/i, "").charAt(0).toUpperCase();
  const dot = (p) => COLORS[p]
    ? `<span class="dot ball-dot" aria-hidden="true"><svg viewBox="0 0 32 32" width="100%" height="100%"><circle cx="16" cy="16" r="15" fill="${COLORS[p]}" stroke="rgba(0,0,0,.25)"/>${DIMPLES.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4" fill="rgba(0,0,0,.18)"/>`).join("")}<ellipse cx="11" cy="9.5" rx="5" ry="3" fill="rgba(255,255,255,.45)" transform="rotate(-30 11 9.5)"/></svg></span>`
    : `<span class="dot" style="background:${color(p)}" aria-hidden="true">${esc(initial(p))}</span>`;
  const fmt = (n, d = 1) => n.toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d });
  const par = (n, d = 0) => {
    if (n == null) return "–";
    const v = Number(n.toFixed(d));
    if (v === 0) return "E";
    const s = (v > 0 ? "+" : "−") + fmt(Math.abs(v), d);
    return v < 0 ? `<span class="under">${s}</span>` : s;
  };
  const dateIt = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
  const seasonLabel = (s) => (s === CUR ? `${s} · in corso` : String(s));

  // ---------- calcoli ----------
  function standings(game, season) {
    const ms = D.matches.filter((m) => m.game === game && (season == null || m.season === season));
    const t = {};
    for (const m of ms) {
      for (const r of m.results) {
        if (guest(r.p)) continue;
        const s = (t[r.p] ||= { p: r.p, played: 0, wins: 0, podi: 0, posSum: 0, posN: 0, toPar: [], hio: 0 });
        s.played++;
        if (r.pos === 1) s.wins++;
        if (r.pos != null && r.pos <= 3) s.podi++;
        if (r.pos != null) { s.posSum += r.pos; s.posN++; }
        if (r.toPar != null) s.toPar.push(r.toPar);
        if (r.hio) s.hio += r.hio;
      }
    }
    const rows = Object.values(t).map((s) => ({
      ...s,
      avgPos: s.posN ? s.posSum / s.posN : null,
      avgPar: s.toPar.length ? s.toPar.reduce((a, b) => a + b, 0) / s.toPar.length : null,
      pct: s.played ? (100 * s.wins) / s.played : 0,
    }));
    const byPos = GAME[game].mode !== "vincitore";
    rows.sort((a, b) => b.wins - a.wins || (byPos ? b.podi - a.podi || (a.avgPos ?? 99) - (b.avgPos ?? 99) : b.pct - a.pct) || b.played - a.played);
    return { matches: ms.length, rows, byPos };
  }

  function sameRank(a, b, byPos) {
    return a.wins === b.wins && (byPos ? a.podi === b.podi && Math.abs((a.avgPos ?? 0) - (b.avgPos ?? 0)) < 1e-9 : a.pct === b.pct);
  }

  function champions(game, season) {
    const st = standings(game, season);
    if (!st.rows.length) return { list: [], st };
    const list = st.rows.filter((r) => sameRank(r, st.rows[0], st.byPos));
    return { list, st };
  }

  // ---------- hero ----------
  function renderHero() {
    $("hero-season").textContent = `Stagione ${CUR}`;
    const counted = D.matches.length;
    const seasons = new Set(D.matches.map((m) => m.game + m.season)).size;
    const golfUnder = D.matches.reduce((n, m) => n + m.results.filter((r) => r.toPar != null && r.toPar < 0).length, 0);
    $("kpis").innerHTML = [
      [counted, "partite"],
      [core.length, "giocatori"],
      [seasons, "stagioni"],
      [golfUnder, "giri sotto il par"],
    ].map(([v, l]) => `<div><dt>${l}</dt><dd>${v}</dd></div>`).join("");

    const st = standings("golf", CUR);
    $("board-cap").textContent = `Golf With Your Friends · ${CUR}`;
    $("board").innerHTML =
      `<thead><tr><th>Pos</th><th>Giocatore</th><th>V</th><th>Podi</th><th>Par</th></tr></thead><tbody>` +
      st.rows.slice(0, 5).map((r, i) => `<tr><td>${i + 1}</td><td class="name">${esc(name(r.p))}</td><td class="${i === 0 ? "lead" : ""}">${r.wins}</td><td>${r.podi}</td><td class="${r.avgPar < 0 ? "lead" : ""}">${r.avgPar == null ? "–" : (r.avgPar > 0 ? "+" : r.avgPar < 0 ? "−" : "") + fmt(Math.abs(r.avgPar))}</td></tr>`).join("") +
      `</tbody>`;
    $("board-foot").textContent = `${st.matches} partite giocate · Par = media colpi rispetto al par`;
  }

  // ---------- risultati ----------
  function resultsList(m, limit) {
    const rs = limit ? m.results.slice(0, limit) : m.results;
    return `<ol class="res">` + rs.map((r) => {
      const extra = r.strokes != null
        ? `<span class="s">${r.strokes}</span><span class="tp">${r.toPar != null ? par(r.toPar) : ""}</span>`
        : r.points != null ? `<span class="s">${r.points}</span><span class="tp">pt</span>` : `<span class="s"></span><span class="tp"></span>`;
      const pos = r.pos == null ? "–" : r.pos;
      return `<li class="${r.pos === 1 ? "win" : ""}"><span class="p">${pos}</span><span class="n ${guest(r.p) ? "guest" : ""}">${esc(name(r.p))}${guest(r.p) ? " (ospite)" : ""}</span>${extra}</li>`;
    }).join("") + `</ol>`;
  }

  function mapLine(m) {
    const bits = [];
    if (m.map) bits.push(esc(m.map));
    if (m.par) bits.push(`par ${m.par}`);
    if (m.format === "punti") bits.push("modalità a punti");
    if (m.format === "squadre") bits.push("a squadre");
    if (m.game === "uno") bits.push("conta solo il vincitore");
    return bits.join(" · ");
  }

  function renderLast() {
    const m = D.matches[0];
    $("last").innerHTML = `<article class="last">
      <div>
        <span class="chip">${esc(GAME[m.game].name)}</span>
        <h3>${esc(m.title)}</h3>
        <div class="meta"><span>${dateIt(m.date)}</span><span>canale ${esc(m.channel)}</span>${mapLine(m) ? `<span>${mapLine(m)}</span>` : ""}</div>
        <a class="yt" href="${esc(m.url)}" target="_blank" rel="noopener">Guarda su YouTube ↗</a>
      </div>
      <div>${resultsList(m)}</div>
    </article>`;
  }

  // ---------- classifiche ----------
  const state = { game: "golf", season: CUR };
  function renderGameSeg() {
    $("game-seg").innerHTML = D.games.map((g) => `<button type="button" role="tab" aria-selected="${g.id === state.game}" data-g="${g.id}">${esc(g.short)}</button>`).join("");
    const seasons = GAME[state.game].seasons;
    if (state.season !== "all" && !seasons.includes(state.season)) state.season = seasons[0];
    $("season-sel").innerHTML = seasons.map((s) => `<option value="${s}">${seasonLabel(s)}</option>`).join("") + `<option value="all">Di sempre</option>`;
    $("season-sel").value = String(state.season);
  }
  function renderTable() {
    const season = state.season === "all" ? null : state.season;
    const g = GAME[state.game];
    const st = standings(state.game, season);
    const golf = state.game === "golf";
    const maxW = Math.max(1, ...st.rows.map((r) => r.wins));
    $("table-note").textContent = `${g.name}, ${season == null ? "tutte le stagioni" : "stagione " + season}: ${st.matches} partite.` +
      (st.byPos ? "" : " Per UNO conta solo il vincitore del video, quindi podi e posizione media non ci sono.");
    const head = ["Pos", "Giocatore", "Partite", "Vittorie", "% vittorie"].concat(st.byPos ? ["Podi", "Pos. media"] : []).concat(golf ? ["Media vs par", "Hole in one"] : []);
    let prev = null, rank = 0;
    $("lb").innerHTML = `<thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>` +
      (st.rows.length ? st.rows.map((r, i) => {
        if (!prev || !sameRank(r, prev, st.byPos)) rank = i + 1;
        prev = r;
        return `<tr class="${rank === 1 ? "first" : ""}">
          <td class="pos">${rank}</td>
          <td><span class="pname">${dot(r.p)}${esc(name(r.p))}</span></td>
          <td>${r.played}</td>
          <td class="wins">${r.wins}<span class="bar" style="width:${Math.round((40 * r.wins) / maxW)}px"></span></td>
          <td>${fmt(r.pct, 0)}%</td>
          ${st.byPos ? `<td>${r.podi}</td><td>${r.avgPos == null ? "–" : fmt(r.avgPos, 2)}</td>` : ""}
          ${golf ? `<td>${par(r.avgPar, 1)}</td><td>${r.hio}</td>` : ""}
        </tr>`;
      }).join("") : `<tr><td colspan="${head.length}" class="empty">Nessuna partita.</td></tr>`) + `</tbody>`;
  }
  function initTable() {
    renderGameSeg(); renderTable();
    $("game-seg").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-g]"); if (!b) return;
      state.game = b.dataset.g; renderGameSeg(); renderTable();
    });
    $("season-sel").addEventListener("change", (e) => { state.season = e.target.value === "all" ? "all" : Number(e.target.value); renderTable(); });
  }

  // ---------- albo d'oro ----------
  function renderAlbo() {
    $("albo-list").innerHTML = D.games.map((g) => `<div class="albo-game"><h3>${esc(g.name)}</h3><ol>` +
      g.seasons.map((s) => {
        const { list, st } = champions(g.id, s);
        const live = s === CUR;
        const who = list.map((r) => esc(name(r.p))).join(" e ") || "–";
        const w = list[0] ? list[0].wins : 0;
        return `<li><span class="yr">${s}</span><span class="champ">${who}${live ? '<span class="live">in testa</span>' : ""}</span><span class="sub">${w} vitt. su ${st.matches}</span></li>`;
      }).join("") + `</ol></div>`).join("");
  }

  // ---------- giocatori ----------
  function playerStats(p) {
    let played = 0, wins = 0, podi = 0, hio = 0; const toPar = []; let best = null;
    for (const m of D.matches) {
      const r = m.results.find((x) => x.p === p); if (!r) continue;
      played++; if (r.pos === 1) wins++; if (r.pos != null && r.pos <= 3) podi++;
      if (r.hio) hio += r.hio;
      if (r.toPar != null) { toPar.push(r.toPar); if (!best || r.toPar < best.r.toPar) best = { r, m }; }
    }
    const titles = [];
    for (const g of D.games) for (const s of g.seasons) {
      const { list } = champions(g.id, s);
      if (list.some((r) => r.p === p)) titles.push({ g, s, live: s === CUR });
    }
    return { played, wins, podi, hio, avgPar: toPar.length ? toPar.reduce((a, b) => a + b, 0) / toPar.length : null, best, titles };
  }
  function renderPlayers() {
    const list = core.map((p) => ({ p, ...playerStats(p) })).filter((x) => x.played).sort((a, b) => b.wins - a.wins);
    $("players").innerHTML = list.map((x) => {
      const pl = D.players[x.p];
      const alias = pl.alias.replace(/\s*\(da confermare\)/g, "");
      return `<button class="player" type="button" data-p="${x.p}">
        <div class="player-top">${dot(x.p)}<div><h3>${esc(pl.name)}</h3><div class="alias">${esc(alias)}</div></div></div>
        <dl class="pstats">
          <div><dt>Partite</dt><dd>${x.played}</dd></div>
          <div><dt>Vittorie</dt><dd>${x.wins}</dd></div>
          <div><dt>Podi</dt><dd>${x.podi}</dd></div>
        </dl>
        ${x.titles.length ? `<div class="titles">${x.titles.map((t) => `<span class="trophy ${t.live ? "leader" : ""}">${t.live ? "In testa" : "Campione"} ${esc(t.g.short)} ${t.s}</span>`).join("")}</div>` : ""}
        <div class="pbest">Golf: media ${par(x.avgPar, 1)} vs par · ${x.hio} hole in one${x.best ? ` · miglior giro ${par(x.best.r.toPar)} su ${esc(x.best.m.map)}` : ""}</div>
      </button>`;
    }).join("");
    $("players").addEventListener("click", (e) => {
      const b = e.target.closest(".player"); if (!b) return;
      $("m-player").value = b.dataset.p; $("m-game").value = "all"; $("m-season").value = "all";
      shown = PAGE; renderMatches();
      location.hash = "partite";
    });
  }

  // ---------- partite ----------
  const PAGE = 24; let shown = PAGE;
  function initMatches() {
    $("m-game").innerHTML = `<option value="all">Tutti</option>` + D.games.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join("");
    const seasons = [...new Set(D.matches.map((m) => m.season))].sort((a, b) => b - a);
    $("m-season").innerHTML = `<option value="all">Tutte</option>` + seasons.map((s) => `<option value="${s}">${s}</option>`).join("");
    $("m-player").innerHTML = `<option value="all">Tutti</option>` + core.map((p) => `<option value="${p}">${esc(name(p))}</option>`).join("");
    ["m-game", "m-season", "m-player"].forEach((id) => $(id).addEventListener("change", () => { shown = PAGE; renderMatches(); }));
    $("more").addEventListener("click", () => { shown += PAGE; renderMatches(); });
    renderMatches();
  }
  function renderMatches() {
    const g = $("m-game").value, s = $("m-season").value, p = $("m-player").value;
    const ms = D.matches.filter((m) => (g === "all" || m.game === g) && (s === "all" || m.season === Number(s)) && (p === "all" || m.results.some((r) => r.p === p)));
    let extra = "";
    if (p !== "all") {
      const w = ms.filter((m) => m.results.some((r) => r.p === p && r.pos === 1)).length;
      extra = ` ${name(p)} ne ha vinte ${w}.`;
    }
    $("m-count").textContent = `${ms.length} partite.${extra}`;
    $("matches").innerHTML = ms.slice(0, shown).map((m) => `<article class="match">
      <div class="top"><span class="date">${dateIt(m.date)}</span><span class="chip">${esc(GAME[m.game].short)}</span></div>
      <h3>${esc(m.title)}</h3>
      ${mapLine(m) ? `<div class="mapline">${mapLine(m)}</div>` : ""}
      ${resultsList(m)}
      <a class="yt" href="${esc(m.url)}" target="_blank" rel="noopener">Guarda il video ↗</a>
    </article>`).join("") || `<p class="empty">Nessuna partita con questi filtri.</p>`;
    $("more").hidden = ms.length <= shown;
  }

  // ---------- testa a testa ----------
  function initH2H() {
    const opts = core.map((p) => `<option value="${p}">${esc(name(p))}</option>`).join("");
    $("h-a").innerHTML = opts; $("h-b").innerHTML = opts;
    $("h-a").value = "delux"; $("h-b").value = "dread";
    ["h-a", "h-b"].forEach((id) => $(id).addEventListener("change", renderH2H));
    renderH2H();
  }
  function renderH2H() {
    const a = $("h-a").value, b = $("h-b").value;
    if (a === b) { $("h2h").innerHTML = `<div class="h2h"><p class="empty">Scegli due giocatori diversi.</p></div>`; return; }
    let wa = 0, wb = 0, tie = 0, n = 0, sa = 0, sb = 0, ns = 0;
    const per = {};
    for (const m of D.matches) {
      if (m.game === "uno") continue;
      const ra = m.results.find((r) => r.p === a), rb = m.results.find((r) => r.p === b);
      if (!ra || !rb || ra.pos == null || rb.pos == null) continue;
      n++; const k = (per[m.game] ||= { a: 0, b: 0, t: 0 });
      if (ra.pos < rb.pos) { wa++; k.a++; } else if (rb.pos < ra.pos) { wb++; k.b++; } else { tie++; k.t++; }
      if (ra.toPar != null && rb.toPar != null) { sa += ra.toPar; sb += rb.toPar; ns++; }
    }
    const pa = n ? (100 * wa) / n : 0, pt = n ? (100 * tie) / n : 0, pb = n ? (100 * wb) / n : 0;
    $("h2h").innerHTML = `<div class="h2h">
      <div class="h2h-score">
        <div><div class="big" style="color:${color(a)}">${wa}</div><div class="who">${esc(name(a))}</div></div>
        <div class="mid">${n} partite insieme<br>${tie} pari</div>
        <div><div class="big" style="color:${color(b)}">${wb}</div><div class="who">${esc(name(b))}</div></div>
      </div>
      <div class="h2h-bar" role="img" aria-label="${esc(name(a))} ${wa}, pari ${tie}, ${esc(name(b))} ${wb}"><span style="width:${pa}%;background:${color(a)}"></span><span style="width:${pt}%;background:var(--line)"></span><span style="width:${pb}%;background:${color(b)}"></span></div>
      <div class="h2h-rows">
        ${Object.entries(per).map(([g, k]) => `<div>${esc(GAME[g].name)}: <strong>${k.a}–${k.b}</strong>${k.t ? ` (${k.t} pari)` : ""}</div>`).join("")}
        ${ns ? `<div>Golf, media vs par negli stessi giri: <strong>${par(sa / ns, 1)}</strong> contro <strong>${par(sb / ns, 1)}</strong></div>` : ""}
      </div>
    </div>`;
  }

  // ---------- record ----------
  function renderRecords() {
    const recs = [];
    const golf = D.matches.filter((m) => m.game === "golf").slice().sort((x, y) => x.date.localeCompare(y.date));
    const link = (m) => `<a href="${esc(m.url)}" target="_blank" rel="noopener">${dateIt(m.date)}</a>`;

    let best = null, hio = null, margin = null;
    for (const m of golf) for (const r of m.results) {
      if (guest(r.p)) continue;
      if (r.toPar != null && (!best || r.toPar < best.r.toPar)) best = { r, m };
      if (r.hio != null && (!hio || r.hio > hio.r.hio)) hio = { r, m };
    }
    for (const m of golf) {
      if (m.format) continue;
      const w = m.results.filter((r) => r.pos === 1), s = m.results.filter((r) => r.pos === 2);
      if (w.length !== 1 || !s.length || w[0].strokes == null || s[0].strokes == null || guest(w[0].p)) continue;
      const d = s[0].strokes - w[0].strokes;
      if (!margin || d > margin.d) margin = { d, m, w: w[0], s: s[0] };
    }
    if (best) recs.push({ lbl: "Miglior giro", val: par(best.r.toPar), who: name(best.r.p), ctx: `${esc(best.m.map)}, par ${best.m.par}, ${best.r.strokes} colpi · ${link(best.m)}` });
    if (hio) recs.push({ lbl: "Più hole in one in una partita", val: hio.r.hio, who: name(hio.r.p), ctx: `${esc(hio.m.map || "")} · ${link(hio.m)}` });
    if (margin) recs.push({ lbl: "Vittoria col distacco maggiore", val: `${margin.d} colpi`, who: name(margin.w.p), ctx: `su ${esc(name(margin.s.p))}, ${esc(margin.m.map || "")} · ${link(margin.m)}` });

    // serie di vittorie consecutive (golf, nelle partite giocate)
    let streak = null;
    for (const p of core) {
      let cur = 0, start = null;
      for (const m of golf) {
        const r = m.results.find((x) => x.p === p); if (!r) continue;
        if (r.pos === 1) { if (!cur) start = m; cur++; if (!streak || cur > streak.n) streak = { p, n: cur, start, end: m }; }
        else cur = 0;
      }
    }
    if (streak) recs.push({ lbl: "Serie di vittorie di fila (golf)", val: streak.n, who: name(streak.p), ctx: `dal ${dateIt(streak.start.date)} al ${dateIt(streak.end.date)}` });

    // più vittorie in una stagione
    let season = null;
    for (const g of D.games) for (const s of g.seasons) {
      const r = standings(g.id, s).rows[0];
      if (r && (!season || r.wins > season.r.wins)) season = { r, g, s };
    }
    if (season) recs.push({ lbl: "Più vittorie in una stagione", val: season.r.wins, who: name(season.r.p), ctx: `${esc(season.g.name)} ${season.s}${season.s === CUR ? " (in corso)" : ""}` });

    // hole in one in carriera
    const tot = standings("golf", null).rows.slice().sort((x, y) => y.hio - x.hio)[0];
    if (tot) recs.push({ lbl: "Hole in one in carriera", val: tot.hio, who: name(tot.p), ctx: `in ${tot.played} golfatine` });

    $("records").innerHTML = recs.map((r) => `<div class="rec"><span class="lbl">${r.lbl}</span><span class="val">${r.val}</span><span class="who">${esc(r.who)}</span><span class="ctx">${r.ctx}</span></div>`).join("");
  }

  // ---------- regole ----------
  function renderRules() {
    $("unreadable-line").textContent = `${D.unreadable.length} video non hanno un tabellone finale leggibile e non sono contati.`;
    $("unreadable").innerHTML = D.unreadable.map((m) => `<li><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title)}</a> (${dateIt(m.date)}): ${esc(m.note.replace(/^.*risultato non leggibile:\s*/i, ""))}</li>`).join("");
    $("footer").innerHTML = `Dati aggiornati al ${dateIt(D.updated)} · ultima partita del ${dateIt(D.lastMatch)} · risultati letti dai tabelloni finali dei video.`;
  }

  // ---------- pagine ----------
  const VIEW_OF = { albo: "home", ultima: "home", sfide: "giocatori", regole: "record" };
  function route() {
    const h = location.hash.slice(1);
    const sections = [...document.querySelectorAll("[data-view]")];
    const views = new Set(sections.map((s) => s.dataset.view));
    const view = views.has(h) ? h : VIEW_OF[h] || "home";
    sections.forEach((s) => (s.hidden = s.dataset.view !== view));
    document.querySelectorAll(".nav a").forEach((a) => {
      if (a.getAttribute("href") === "#" + view) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    const target = h && h !== view ? document.getElementById(h) : null;
    if (target) target.scrollIntoView(); else window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  route();

  renderHero(); renderLast(); initTable(); renderAlbo(); renderPlayers(); initMatches(); initH2H(); renderRecords(); renderRules();
})();
