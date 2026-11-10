// Pannello admin: crea post con domande e opzioni, chiude e paga i pronostici.
(function () {
  "use strict";
  const C = window.Club;
  const { sb, esc, n, when, errText } = C;
  const $ = (id) => document.getElementById(id);
  const D = window.GOLFATINE;
  const core = D ? Object.keys(D.players).filter((p) => !D.players[p].guest).map((p) => D.players[p].name) : [];

  const toast = (t) => document.dispatchEvent(new CustomEvent("club:toast", { detail: t }));
  const localInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  // ---------- editor delle domande ----------
  function addMarket(question, options) {
    const box = document.createElement("fieldset");
    box.className = "market-edit";
    const id = Math.random().toString(36).slice(2, 8);
    const closes = new Date(Date.now() + 24 * 3600 * 1000);
    closes.setMinutes(0, 0, 0);
    box.innerHTML = `
      <label class="field"><span>Domanda</span><input class="q" id="q-${id}" required minlength="3" maxlength="200" value="${esc(question)}"></label>
      <div class="field-row">
        <label class="field"><span>Puntate chiuse il</span><input class="c" id="c-${id}" type="datetime-local" required value="${localInput(closes)}"></label>
        <button class="btn ghost small rm" type="button">Togli domanda</button>
      </div>
      <label class="field"><span>Opzioni, una per riga</span><textarea class="o" id="o-${id}" required>${esc(options.join("\n"))}</textarea></label>`;
    box.querySelector(".rm").addEventListener("click", () => box.remove());
    $("markets").appendChild(box);
  }
  $("add-winner").addEventListener("click", () => addMarket("Chi vince la golfatina?", core));
  $("add-last").addEventListener("click", () => addMarket("Chi arriva ultimo?", core));
  $("add-custom").addEventListener("click", () => addMarket("", ["Sì", "No"]));

  $("post-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("post-msg");
    const markets = [...document.querySelectorAll(".market-edit")].map((f) => ({
      question: f.querySelector(".q").value.trim(),
      closes_at: new Date(f.querySelector(".c").value).toISOString(),
      options: f.querySelector(".o").value.split("\n").map((s) => s.trim()).filter(Boolean),
    }));
    if (!markets.length) { msg.textContent = "Aggiungi almeno una domanda."; return; }
    if (markets.some((m) => m.options.length < 2)) { msg.textContent = "Ogni domanda ha bisogno di almeno due opzioni."; return; }
    msg.textContent = "Pubblicazione in corso…";
    const { data: post, error } = await sb.from("posts").insert({
      title: $("f-title").value.trim(),
      game: $("f-game").value,
      video_url: $("f-video").value.trim() || null,
      body: $("f-body").value.trim() || null,
      published: $("f-published").checked,
      created_by: C.state.session.user.id,
    }).select().single();
    if (error) { msg.textContent = errText(error); return; }
    for (const m of markets) {
      const { data: mk, error: e1 } = await sb.from("markets").insert({ post_id: post.id, question: m.question, closes_at: m.closes_at }).select().single();
      if (e1) { msg.textContent = errText(e1); return; }
      const { error: e2 } = await sb.from("options").insert(m.options.map((label, i) => ({ market_id: mk.id, label, sort: i })));
      if (e2) { msg.textContent = errText(e2); return; }
    }
    $("post-form").reset();
    $("markets").innerHTML = "";
    addMarket("Chi vince la golfatina?", core);
    msg.textContent = "";
    toast("Post pubblicato");
    renderPosts();
  });

  // ---------- gestione ----------
  async function renderPosts() {
    const el = $("admin-posts");
    let res;
    try { res = await C.loadPosts({ all: true }); } catch (e) { el.innerHTML = `<p class="empty">${esc(errText(e))}</p>`; return; }
    const { posts, totals } = res;
    if (!posts.length) { el.innerHTML = `<p class="empty">Nessun post ancora.</p>`; return; }
    el.innerHTML = posts.map((p) => `<article class="post" data-post="${p.id}">
      <div class="top"><span class="chip">${p.published ? "Pubblicato" : "Bozza"}</span><span class="date">${when(p.created_at)}</span></div>
      <h3>${esc(p.title)}</h3>
      <div class="row">
        <label class="sr" for="v-${p.id}">Link al video</label>
        <input id="v-${p.id}" type="url" value="${esc(p.video_url || "")}" placeholder="Link al video">
        <button class="btn ghost small" type="button" data-act="video" data-id="${p.id}">Salva link</button>
        <button class="btn ghost small" type="button" data-act="publish" data-id="${p.id}" data-val="${!p.published}">${p.published ? "Nascondi" : "Pubblica"}</button>
        <button class="btn danger small" type="button" data-act="delete" data-id="${p.id}">Elimina</button>
      </div>
      ${(p.markets || []).slice().sort((a, b) => a.id - b.id).map((m) => {
        const opts = (m.options || []).slice().sort((a, b) => a.sort - b.sort || a.id - b.id);
        const pool = opts.reduce((s, o) => s + Number((totals[o.id] || {}).total || 0), 0);
        const st = C.marketStatus(m);
        const done = m.status === "pagato" || m.status === "annullato";
        return `<div class="market">
          <div class="market-head"><h4>${esc(m.question)}</h4><span class="market-state ${st.open ? "is-open" : ""}">${st.label}</span></div>
          <ol class="opts">${opts.map((o) => {
            const t = (totals[o.id] || {});
            return `<li class="opt admin-opt ${m.winning_option === o.id && m.status === "pagato" ? "won" : ""}"><span class="opt-label">${esc(o.label)}</span><span class="opt-num num">${n(t.total)}</span><span class="opt-num num">${t.bettors || 0} fan</span></li>`;
          }).join("")}</ol>
          <p class="note small">Piatto: ${n(pool)} gettoni · chiusura ${when(m.closes_at)}</p>
          ${done ? "" : `<div class="row">
            ${m.status === "aperto" ? `<button class="btn ghost small" type="button" data-act="close" data-id="${m.id}">Chiudi puntate</button>` : ""}
            <label class="sr" for="w-${m.id}">Risultato</label>
            <select id="w-${m.id}"><option value="">Chi ha vinto?</option>${opts.map((o) => `<option value="${o.id}">${esc(o.label)}</option>`).join("")}</select>
            <button class="btn small" type="button" data-act="settle" data-id="${m.id}">Paga</button>
            <button class="btn danger small" type="button" data-act="void" data-id="${m.id}">Annulla e rimborsa</button>
          </div>`}
        </div>`;
      }).join("")}
      <p class="msg" role="status" id="pmsg-${p.id}"></p>
    </article>`).join("");
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
    if (b.dataset.act === "video") {
      ({ error } = await sb.from("posts").update({ video_url: $("v-" + id).value.trim() || null }).eq("id", id));
    } else if (b.dataset.act === "publish") {
      ({ error } = await sb.from("posts").update({ published: b.dataset.val === "true" }).eq("id", id));
    } else if (b.dataset.act === "delete") {
      if (!confirmTwice(b, "Tocca ancora per eliminare")) return;
      ({ error } = await sb.from("posts").delete().eq("id", id));
      if (error && /foreign key|violates/i.test(error.message)) error = { message: "Ci sono già puntate: annulla e rimborsa le domande, poi nascondi il post." };
    } else if (b.dataset.act === "close") {
      ({ error } = await sb.rpc("admin_close_market", { p_market: id }));
    } else if (b.dataset.act === "settle") {
      const opt = Number($("w-" + id).value);
      if (!opt) { msg.textContent = "Scegli prima chi ha vinto."; return; }
      if (!confirmTwice(b, "Conferma pagamento")) return;
      ({ data, error } = await sb.rpc("admin_settle_market", { p_market: id, p_option: opt }));
    } else if (b.dataset.act === "void") {
      if (!confirmTwice(b, "Tocca ancora per rimborsare")) return;
      ({ error } = await sb.rpc("admin_void_market", { p_market: id }));
    }
    if (error) { if (msg) msg.textContent = errText(error); return; }
    if (data) toast(data.rimborsato ? "Nessuno aveva indovinato: tutti rimborsati" : `Pagati ${data.vincenti} pronostici vincenti`);
    else toast("Fatto");
    renderPosts();
  });

  // ---------- accesso ----------
  function refresh() {
    C.accountPanel($("club-account"), refresh);
    const p = C.state.profile;
    const ok = Boolean(p && p.is_admin);
    $("admin").hidden = !ok;
    $("gate").textContent = !C.configured ? "Il sito non è ancora collegato al database (vedi config.js)."
      : !C.state.session ? "Accedi con l'email di un account admin."
      : p && !p.is_admin ? "Questo account non è admin. Chiedi a chi gestisce il sito di abilitarlo." : "";
    if (ok) {
      if (!document.querySelector(".market-edit")) addMarket("Chi vince la golfatina?", core);
      renderPosts();
    }
  }
  C.init(refresh);
})();
