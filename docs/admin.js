// Pannello admin: annunci con miniatura e pronostici, pagamenti, risultati delle partite, gestione degli admin.
(function () {
  "use strict";
  const C = window.Club;
  const { sb, esc, n, when, errText } = C;
  const $ = (id) => document.getElementById(id);
  const D = window.GOLFATINE || { players: {}, matches: [], pending: [], unreadable: [], maps: {} };
  const P = D.players;
  const core = Object.keys(P).filter((p) => !P[p].guest);
  const pname = (p) => (P[p] ? P[p].name : p).replace(/\s*\(.*?\)\s*/g, " ").trim();

  const toast = (t) => document.dispatchEvent(new CustomEvent("club:toast", { detail: t }));
  const dayStr = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(d);

  // Data e ora italiane -> istante esatto (tiene conto dell'ora legale)
  function romeToISO(day, time) {
    const guess = new Date(`${day}T${time}:00Z`);
    const asRome = new Date(guess.toLocaleString("en-US", { timeZone: "Europe/Rome" }));
    const asUtc = new Date(guess.toLocaleString("en-US", { timeZone: "UTC" }));
    return new Date(guess.getTime() - (asRome - asUtc)).toISOString();
  }

  // ---------- nuovo annuncio ----------
  $("f-day").value = dayStr(new Date(Date.now() + 24 * 3600 * 1000));
  $("f-players").innerHTML = core.map((p) => `<label class="check"><input type="checkbox" value="${esc(p)}" checked> ${esc(pname(p))}</label>`).join("");
  function closeNote() {
    const d = $("f-day").value, t = $("f-time").value;
    $("f-close-note").textContent = d && t ? `Le puntate si chiudono da sole ${when(romeToISO(d, t))}, quando esce il video.` : "";
  }
  ["f-day", "f-time"].forEach((id) => $(id).addEventListener("input", closeNote));
  closeNote();

  $("f-image").addEventListener("change", () => {
    const f = $("f-image").files[0], img = $("f-image-preview");
    if (!f) { img.hidden = true; return; }
    img.src = URL.createObjectURL(f); img.hidden = false;
  });

  function addCustom() {
    const box = document.createElement("fieldset");
    box.className = "market-edit";
    box.innerHTML = `
      <label class="field"><span>Domanda</span><input class="q" required minlength="3" maxlength="200" placeholder="Qualcuno fa hole in one?"></label>
      <label class="field"><span>Risposte, una per riga</span><textarea class="o" required>Sì\nNo</textarea></label>
      <div class="row"><button class="btn ghost small rm" type="button">Togli domanda</button></div>`;
    box.querySelector(".rm").addEventListener("click", () => box.remove());
    $("markets").appendChild(box);
  }
  $("add-custom").addEventListener("click", addCustom);

  async function uploadImage(file) {
    if (file.size > 5 * 1024 * 1024) throw new Error("La miniatura è troppo grande (massimo 5 MB).");
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await sb.storage.from("miniature").upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return sb.storage.from("miniature").getPublicUrl(path).data.publicUrl;
  }

  $("post-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("post-msg");
    const players = [...$("f-players").querySelectorAll("input:checked")].map((i) => pname(i.value))
      .concat($("f-extra").value.split(",").map((s) => s.trim()).filter(Boolean));
    const closes = romeToISO($("f-day").value, $("f-time").value);
    if (new Date(closes) <= new Date()) { msg.textContent = "L'uscita del video è già passata: scegli una data futura."; return; }
    const markets = [];
    if ($("k-winner").checked) markets.push({ question: "Chi vince la golfatina?", kind: "vincitore", options: players });
    if ($("k-podium").checked) markets.push({ question: "Indovina il podio: primo, secondo e terzo", kind: "podio", options: players });
    if ($("k-last").checked) markets.push({ question: "Chi arriva ultimo?", kind: "vincitore", options: players });
    document.querySelectorAll(".market-edit").forEach((f) => markets.push({
      question: f.querySelector(".q").value.trim(), kind: "vincitore",
      options: f.querySelector(".o").value.split("\n").map((s) => s.trim()).filter(Boolean),
    }));
    if (!markets.length) { msg.textContent = "Scegli almeno una cosa da pronosticare."; return; }
    if (markets.some((m) => m.options.length < 2)) { msg.textContent = "Servono almeno due giocatori (o due risposte) per ogni domanda."; return; }
    if (markets.some((m) => m.kind === "podio" && m.options.length < 4)) { msg.textContent = "Per il podio servono almeno quattro giocatori."; return; }
    msg.textContent = "Pubblicazione in corso…";
    let image_url = null;
    try {
      if ($("f-image").files[0]) { msg.textContent = "Caricamento della miniatura…"; image_url = await uploadImage($("f-image").files[0]); }
    } catch (err) { msg.textContent = "Miniatura non caricata: " + errText(err); return; }
    const { data: post, error } = await sb.from("posts").insert({
      title: $("f-title").value.trim(),
      game: $("f-game").value,
      image_url,
      body: $("f-body").value.trim() || null,
      published: $("f-published").checked,
      created_by: C.state.session.user.id,
    }).select().single();
    if (error) { msg.textContent = errText(error); return; }
    for (const m of markets) {
      const { data: mk, error: e1 } = await sb.from("markets").insert({ post_id: post.id, question: m.question, closes_at: closes, kind: m.kind }).select().single();
      if (e1) { msg.textContent = errText(e1); return; }
      const { error: e2 } = await sb.from("options").insert(m.options.map((label, i) => ({ market_id: mk.id, label, sort: i })));
      if (e2) { msg.textContent = errText(e2); return; }
    }
    $("post-form").reset();
    $("f-image-preview").hidden = true;
    $("markets").innerHTML = "";
    $("f-day").value = dayStr(new Date(Date.now() + 24 * 3600 * 1000));
    closeNote();
    msg.textContent = "";
    toast("Annuncio pubblicato");
    renderPosts();
  });

  // ---------- gestione degli annunci ----------
  async function renderPosts() {
    const el = $("admin-posts");
    let res;
    try { res = await C.loadPosts({ all: true }); } catch (e) { el.innerHTML = `<p class="empty">${esc(errText(e))}</p>`; return; }
    const { posts, totals } = res;
    if (!posts.length) { el.innerHTML = `<p class="empty">Nessun annuncio ancora.</p>`; return; }
    el.innerHTML = posts.map((p) => `<article class="post" data-post="${p.id}">
      <div class="top"><span class="chip">${p.published ? "Pubblicato" : "Bozza"}</span><span class="date">${when(p.created_at)}</span></div>
      ${p.image_url ? `<img class="post-thumb" src="${esc(p.image_url)}" alt="" loading="lazy">` : ""}
      <h3>${esc(p.title)}</h3>
      <div class="row">
        <label class="sr" for="v-${p.id}">Link al video</label>
        <input id="v-${p.id}" type="url" value="${esc(p.video_url || "")}" placeholder="Link al video, quando esce">
        <button class="btn ghost small" type="button" data-act="video" data-id="${p.id}">Salva link</button>
        <button class="btn ghost small" type="button" data-act="publish" data-id="${p.id}" data-val="${!p.published}">${p.published ? "Nascondi" : "Pubblica"}</button>
        <button class="btn danger small" type="button" data-act="delete" data-id="${p.id}">Elimina</button>
      </div>
      ${(p.markets || []).slice().sort((a, b) => a.id - b.id).map((m) => marketAdmin(m, totals)).join("")}
      <p class="msg" role="status" id="pmsg-${p.id}"></p>
    </article>`).join("");
  }

  function marketAdmin(m, totals) {
    const opts = (m.options || []).slice().sort((a, b) => a.sort - b.sort || a.id - b.id);
    const pool = opts.reduce((s, o) => s + Number((totals[o.id] || {}).total || 0), 0);
    const bettors = opts.reduce((s, o) => s + Number((totals[o.id] || {}).bettors || 0), 0);
    const st = C.marketStatus(m);
    const done = m.status === "pagato" || m.status === "annullato";
    const podio = m.kind === "podio";
    const label = (id) => (opts.find((o) => o.id === id) || {}).label || "?";
    const sel = (id, ph) => `<select id="${id}"><option value="">${ph}</option>${opts.map((o) => `<option value="${o.id}">${esc(o.label)}</option>`).join("")}</select>`;
    return `<div class="market">
      <div class="market-head"><h4>${esc(m.question)}</h4><span class="market-state ${st.open ? "is-open" : ""}">${st.label}</span></div>
      ${podio
        ? `<p class="note small">Pronostico del podio: ${bettors} puntate.${m.podium ? ` Podio: ${m.podium.map((id, i) => `${i + 1}° ${esc(label(id))}`).join(", ")}.` : ""}</p>`
        : `<ol class="opts">${opts.map((o) => {
            const t = (totals[o.id] || {});
            return `<li class="opt admin-opt ${m.winning_option === o.id && m.status === "pagato" ? "won" : ""}"><span class="opt-label">${esc(o.label)}</span><span class="opt-num num">${n(t.total)}</span><span class="opt-num num">${t.bettors || 0} fan</span></li>`;
          }).join("")}</ol>`}
      <p class="note small">Piatto: ${n(pool)} gettoni · chiusura ${when(m.closes_at)}</p>
      ${done ? "" : `<div class="row">
        ${m.status === "aperto" ? `<button class="btn ghost small" type="button" data-act="close" data-id="${m.id}">Chiudi puntate</button>` : ""}
        ${podio
          ? `${sel(`p1-${m.id}`, "1°")}${sel(`p2-${m.id}`, "2°")}${sel(`p3-${m.id}`, "3°")}<button class="btn small" type="button" data-act="settle-podium" data-id="${m.id}">Paga</button>`
          : `<label class="sr" for="w-${m.id}">Risultato</label>${sel(`w-${m.id}`, "Chi ha vinto?")}<button class="btn small" type="button" data-act="settle" data-id="${m.id}">Paga</button>`}
        <button class="btn danger small" type="button" data-act="void" data-id="${m.id}">Annulla e rimborsa</button>
      </div>`}
    </div>`;
  }

  // Le conferme sono a due tocchi: il primo arma il pulsante, il secondo esegue
  const armed = new Set();
  function confirmTwice(btn, label) {
    const key = btn.dataset.act + btn.dataset.id;
    if (armed.has(key)) { armed.delete(key); return true; }
    armed.add(key);
    btn.dataset.orig = btn.textContent;
    btn.textContent = label;
    setTimeout(() => { if (armed.delete(key)) btn.textContent = btn.dataset.orig; }, 4000);
    return false;
  }

  $("admin-posts").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const id = Number(b.dataset.id);
    const post = b.closest("[data-post]");
    const msg = post && $("pmsg-" + post.dataset.post);
    let error = null, data = null;
    const act = b.dataset.act;
    if (act === "video") {
      ({ error } = await sb.from("posts").update({ video_url: $("v-" + id).value.trim() || null }).eq("id", id));
    } else if (act === "publish") {
      ({ error } = await sb.from("posts").update({ published: b.dataset.val === "true" }).eq("id", id));
    } else if (act === "delete") {
      if (!confirmTwice(b, "Tocca ancora per eliminare")) return;
      ({ error } = await sb.from("posts").delete().eq("id", id));
      if (error && /foreign key|violates/i.test(error.message)) error = { message: "Ci sono già puntate: annulla e rimborsa le domande, poi nascondi l'annuncio." };
    } else if (act === "close") {
      ({ error } = await sb.rpc("admin_close_market", { p_market: id }));
    } else if (act === "settle") {
      const opt = Number($("w-" + id).value);
      if (!opt) { msg.textContent = "Scegli prima chi ha vinto."; return; }
      if (!confirmTwice(b, "Conferma pagamento")) return;
      ({ data, error } = await sb.rpc("admin_settle_market", { p_market: id, p_option: opt }));
    } else if (act === "settle-podium") {
      const picks = [1, 2, 3].map((k) => Number($(`p${k}-${id}`).value));
      if (picks.some((x) => !x) || new Set(picks).size !== 3) { msg.textContent = "Scegli tre giocatori diversi per primo, secondo e terzo."; return; }
      if (!confirmTwice(b, "Conferma pagamento")) return;
      ({ data, error } = await sb.rpc("admin_settle_podium", { p_market: id, p_picks: picks }));
    } else if (act === "void") {
      if (!confirmTwice(b, "Tocca ancora per rimborsare")) return;
      ({ error } = await sb.rpc("admin_void_market", { p_market: id }));
    }
    if (error) { if (msg) msg.textContent = errText(error); return; }
    if (data) toast(data.rimborsato ? "Nessuno aveva indovinato: tutti rimborsati" : `Pagati ${data.vincenti} pronostici vincenti`);
    else toast("Fatto");
    renderPosts();
  });

  // ---------- risultati delle partite ----------
  const GAME_OF = { "Golf With Your Friends": "golf", "Super Battle Golf": "sbg", UNO: "uno" };
  const allPlayers = Object.keys(P);
  let saved = [];
  const videoId = (s) => {
    const m = String(s || "").match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/) || String(s || "").trim().match(/^([A-Za-z0-9_-]{11})$/);
    return m ? m[1] : null;
  };
  // Video da completare: appena usciti, senza risultato leggibile, o con la classifica a metà
  const candidates = [
    ...(D.pending || []).map((v) => ({ ...v, why: "appena uscita" })),
    ...D.matches.filter((m) => m.game !== "uno" && m.results.some((r) => r.pos == null)).slice(0, 10).map((m) => ({ ...m, players: m.results.map((r) => r.p), why: "classifica incompleta" })),
    ...(D.unreadable || []).slice(0, 15).map((v) => ({ ...v, why: "senza risultato" })),
  ];
  $("r-maps").innerHTML = Object.keys(D.maps || {}).map((m) => `<option value="${esc(m)}">`).join("");
  $("r-players").innerHTML = allPlayers.map((p) => `<label class="check ${P[p].guest ? "guest" : ""}"><input type="checkbox" value="${esc(p)}"> ${esc(pname(p))}</label>`).join("");

  function fillPick() {
    $("r-pick").innerHTML = `<option value="">Scegli un video da completare…</option>` +
      candidates.map((v, i) => `<option value="c${i}">${esc(v.date)} · ${esc(v.title.slice(0, 60))} (${v.why})</option>`).join("") +
      (saved.length ? `<optgroup label="Già inseriti dal sito">${saved.map((r, i) => `<option value="s${i}">${esc(String(r.date))} · ${esc(r.title.slice(0, 60))}</option>`).join("")}</optgroup>` : "");
  }

  function readGrid() {
    const out = {};
    $("r-grid").querySelectorAll("tr[data-p]").forEach((tr) => {
      out[tr.dataset.p] = {
        holes: [...tr.querySelectorAll("input.h")].map((i) => (i.value === "" ? null : Number(i.value))),
        pos: tr.querySelector("input.pos") ? Number(tr.querySelector("input.pos").value) || null : null,
        win: tr.querySelector("input.win") ? tr.querySelector("input.win").checked : false,
      };
    });
    const par = [...$("r-grid").querySelectorAll("input.par")].map((i) => (i.value === "" ? null : Number(i.value)));
    return { players: out, par };
  }

  function renderGrid(keep) {
    const prev = keep || readGrid();
    const game = $("r-game").value;
    const sel = [...$("r-players").querySelectorAll("input:checked")].map((i) => i.value);
    $("r-golf-head").hidden = game !== "golf";
    if (!sel.length) { $("r-grid").innerHTML = `<tr><td class="note">Spunta i giocatori della partita.</td></tr>`; return; }
    if (game === "golf") {
      const holes = Number($("r-holes").value);
      const mapPars = (D.maps || {})[$("r-map").value.trim()];
      const par = Array.from({ length: holes }, (_, i) => prev.par[i] ?? (mapPars && mapPars.length === holes ? mapPars[i] : null));
      const cell = (cls, v, label) => `<td><input class="${cls}" type="number" min="1" max="99" inputmode="numeric" value="${v ?? ""}" aria-label="${label}"></td>`;
      $("r-grid").innerHTML = `<thead><tr><th>Buca</th>${par.map((_, i) => `<th>${i + 1}</th>`).join("")}<th>Tot</th></tr></thead>
        <tbody><tr class="par-row"><th>Par</th>${par.map((v, i) => cell("par", v, `Par buca ${i + 1}`)).join("")}<td class="tot" id="par-tot"></td></tr>
        ${sel.map((p) => `<tr data-p="${esc(p)}"><th>${esc(pname(p))}</th>${par.map((_, i) => cell("h", ((prev.players[p] || {}).holes || [])[i], `${pname(p)} buca ${i + 1}`)).join("")}<td class="tot"></td></tr>`).join("")}</tbody>`;
    } else if (game === "sbg") {
      $("r-grid").innerHTML = `<thead><tr><th>Giocatore</th><th>Posizione</th></tr></thead><tbody>${sel.map((p) => `<tr data-p="${esc(p)}"><th>${esc(pname(p))}</th><td><input class="pos" type="number" min="1" max="16" value="${(prev.players[p] || {}).pos ?? ""}" aria-label="Posizione di ${esc(pname(p))}"></td></tr>`).join("")}</tbody>`;
    } else {
      $("r-grid").innerHTML = `<thead><tr><th>Giocatore</th><th>Ha vinto</th></tr></thead><tbody>${sel.map((p) => `<tr data-p="${esc(p)}"><th>${esc(pname(p))}</th><td><input class="win" type="checkbox" ${(prev.players[p] || {}).win ? "checked" : ""} aria-label="${esc(pname(p))} ha vinto"></td></tr>`).join("")}</tbody>`;
    }
    totals();
  }
  function totals() {
    const sum = (inputs) => inputs.reduce((s, i) => s + (Number(i.value) || 0), 0);
    const pt = $("par-tot"); if (pt) pt.textContent = sum([...$("r-grid").querySelectorAll("input.par")]) || "";
    $("r-grid").querySelectorAll("tr[data-p]").forEach((tr) => { const t = tr.querySelector(".tot"); if (t) t.textContent = sum([...tr.querySelectorAll("input.h")]) || ""; });
  }
  $("r-grid").addEventListener("input", totals);
  $("r-players").addEventListener("change", () => renderGrid());
  $("r-game").addEventListener("change", () => renderGrid());
  $("r-holes").addEventListener("change", () => renderGrid());
  $("r-map").addEventListener("change", () => {
    const g = readGrid(); const mp = (D.maps || {})[$("r-map").value.trim()];
    if (mp) { $("r-holes").value = String(mp.length); g.par = mp.slice(); }
    renderGrid(g);
  });
  $("r-clear").addEventListener("click", () => setTimeout(() => renderGrid({ players: {}, par: [] }), 0));

  function loadInto(v, players, grid) {
    $("r-video").value = v.url || v.video_id || "";
    $("r-title").value = v.title || "";
    $("r-date").value = String(v.date || "").slice(0, 10);
    $("r-channel").value = v.channel || "";
    $("r-game").value = v.game || "golf";
    $("r-map").value = v.map || "";
    const nHoles = (grid.par && grid.par.length) || ((D.maps || {})[v.map] || []).length || 18;
    if ([...$("r-holes").options].some((o) => Number(o.value) === nHoles)) $("r-holes").value = String(nHoles);
    $("r-players").querySelectorAll("input").forEach((i) => (i.checked = players.includes(i.value)));
    renderGrid(grid);
  }
  $("r-pick").addEventListener("change", () => {
    const v = $("r-pick").value;
    if (!v) return;
    if (v[0] === "c") {
      const c = candidates[Number(v.slice(1))];
      // Se non si sa chi ha giocato, lo si indovina dai nomi nel titolo
      const RX = { rohn: /rohn|\bjr\b/i, delux: /delux|\bdelu\b|deluca/i, gabbo: /gabbo/i, dread: /dread/i, mollu: /mollu/i, masseo: /masseo/i, jtaz: /jtaz/i };
      const players = c.players && c.players.length ? c.players : Object.keys(RX).filter((p) => RX[p].test(c.title || ""));
      const grid = { players: {}, par: (D.maps || {})[c.map] ? D.maps[c.map].slice() : [] };
      (c.results || []).forEach((r) => (grid.players[r.p] = { pos: r.pos, win: r.pos === 1, holes: [] }));
      loadInto({ ...c, game: c.game }, players, grid);
    } else {
      const r = saved[Number(v.slice(1))];
      const grid = { players: {}, par: r.par || [] };
      (r.players || []).forEach((x) => (grid.players[x.p] = { holes: x.holes || [], pos: x.pos, win: x.pos === 1 }));
      loadInto({ ...r, url: "https://www.youtube.com/watch?v=" + r.video_id }, (r.players || []).map((x) => x.p), grid);
    }
  });

  $("res-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("res-msg");
    const id = videoId($("r-video").value);
    if (!id) { msg.textContent = "Il link del video non sembra giusto."; return; }
    const game = $("r-game").value;
    const g = readGrid();
    const sel = Object.keys(g.players);
    if (!sel.length) { msg.textContent = "Spunta almeno un giocatore."; return; }
    let players, par = null;
    if (game === "golf") {
      if (g.par.some((x) => !x)) { msg.textContent = "Manca il par di qualche buca."; return; }
      const missing = sel.filter((p) => g.players[p].holes.some((h) => !h));
      if (missing.length) { msg.textContent = `Mancano dei colpi per ${missing.map(pname).join(", ")}.`; return; }
      par = g.par;
      const tot = (p) => g.players[p].holes.reduce((s, h) => s + h, 0);
      const sorted = sel.map(tot).sort((a, b) => a - b);
      players = sel.map((p) => ({ p, holes: g.players[p].holes, pos: sorted.indexOf(tot(p)) + 1 }));
    } else if (game === "sbg") {
      if (sel.some((p) => !g.players[p].pos)) { msg.textContent = "Scrivi la posizione di ogni giocatore."; return; }
      players = sel.map((p) => ({ p, pos: g.players[p].pos }));
    } else {
      if (!sel.some((p) => g.players[p].win)) { msg.textContent = "Spunta chi ha vinto."; return; }
      players = sel.map((p) => ({ p, pos: g.players[p].win ? 1 : null }));
    }
    msg.textContent = "Salvataggio…";
    const { error } = await sb.from("match_results").upsert({
      video_id: id, game, date: $("r-date").value, title: $("r-title").value.trim(), channel: $("r-channel").value.trim() || null,
      map: game === "golf" ? $("r-map").value.trim() || null : null, par, players,
      updated_by: C.state.session.user.id, updated_at: new Date().toISOString(),
    });
    if (error) { msg.textContent = errText(error); return; }
    msg.textContent = "Salvato. Compare nelle classifiche entro un'ora.";
    toast("Risultato salvato");
    renderSaved();
  });

  async function renderSaved() {
    const { data, error } = await sb.from("match_results").select("*").order("date", { ascending: false }).limit(50);
    saved = data || [];
    fillPick();
    $("res-list").innerHTML = error ? `<p class="empty">${esc(errText(error))}</p>` : !saved.length ? `<p class="empty">Nessun risultato inserito dal sito.</p>`
      : `<ul class="hist">${saved.map((r, i) => {
          const top = (r.players || []).slice().filter((x) => x.pos).sort((a, b) => a.pos - b.pos).slice(0, 3).map((x) => `${x.pos}° ${esc(pname(x.p))}`).join(", ");
          return `<li><span><strong>${esc(r.title)}</strong><br><span class="note small">${esc(String(r.date))}${r.map ? " · " + esc(r.map) : ""} · ${top}</span></span>
            <span class="row"><button class="btn ghost small" type="button" data-edit="${i}">Modifica</button><button class="btn danger small" type="button" data-del="${esc(r.video_id)}" data-act="del" data-id="${esc(r.video_id)}">Elimina</button></span></li>`;
        }).join("")}</ul>`;
  }
  $("res-list").addEventListener("click", async (e) => {
    const ed = e.target.closest("[data-edit]");
    if (ed) { $("r-pick").value = "s" + ed.dataset.edit; $("r-pick").dispatchEvent(new Event("change")); $("res-form").scrollIntoView({ behavior: "smooth" }); return; }
    const del = e.target.closest("[data-del]");
    if (!del || !confirmTwice(del, "Tocca ancora")) return;
    const { error } = await sb.from("match_results").delete().eq("video_id", del.dataset.del);
    if (error) { $("res-msg").textContent = errText(error); return; }
    toast("Risultato eliminato");
    renderSaved();
  });

  // ---------- admin del sito ----------
  async function renderAdmins() {
    const { data, error } = await sb.rpc("admin_list_admins");
    $("admins").innerHTML = error ? `<p class="note">${esc(errText(error))}</p>`
      : `<ul class="hist">${(data || []).map((a) => `<li><span class="fan">${C.ball(a.avatar, 22)}${esc(a.username || "(senza nome)")}${a.username === C.state.profile.username ? " (tu)" : ""}</span>
          ${a.username && a.username !== C.state.profile.username ? `<button class="btn ghost small" type="button" data-unadmin="${esc(a.username)}" data-act="unadmin" data-id="${esc(a.username)}">Togli</button>` : ""}</li>`).join("")}</ul>`;
  }
  $("admin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("a-name").value.trim();
    const { error } = await sb.rpc("admin_set_admin", { p_username: name, p_value: true });
    if (error) { $("admin-msg").textContent = errText(error); return; }
    $("admin-msg").textContent = ""; $("a-name").value = "";
    toast(`${name} ora è admin`);
    renderAdmins();
  });
  $("admins").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-unadmin]");
    if (!b || !confirmTwice(b, "Conferma")) return;
    const { error } = await sb.rpc("admin_set_admin", { p_username: b.dataset.unadmin, p_value: false });
    if (error) { $("admin-msg").textContent = errText(error); return; }
    renderAdmins();
  });

  // ---------- accesso ----------
  let started = false;
  function refresh() {
    C.accountPanel($("club-account"), refresh);
    const p = C.state.profile;
    const ok = Boolean(p && p.is_admin);
    $("admin").hidden = !ok;
    $("gate").textContent = !C.configured ? "Il sito non è ancora collegato al database (vedi config.js)."
      : !C.state.session ? "Accedi con un account admin."
      : p && !p.is_admin ? "Questo account non è admin. Chiedi a chi gestisce il sito di abilitarlo." : "";
    if (ok) {
      renderPosts();
      if (!started) { started = true; renderGrid({ players: {}, par: [] }); renderSaved(); renderAdmins(); }
    }
  }
  C.init(refresh);
})();
