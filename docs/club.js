// Area fan: login, gettoni e pronostici. Usa Supabase (vedi config.js e supabase/schema.sql).
(function () {
  "use strict";
  const cfg = window.GOLFATINE_CONFIG || {};
  const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const sb = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const n = (v) => Number(v || 0).toLocaleString("it-IT");
  const todayRome = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
  const when = (iso) => new Date(iso).toLocaleString("it-IT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const errText = (e) => (e && (e.message || e.error_description)) || "Qualcosa è andato storto, riprova.";

  const state = { session: null, profile: null };

  async function loadProfile() {
    state.profile = null;
    if (!sb || !state.session) return null;
    const { data } = await sb.from("profiles").select("*").eq("id", state.session.user.id).maybeSingle();
    state.profile = data;
    return data;
  }

  async function init(onChange) {
    if (!sb) { onChange(); return; }
    const { data } = await sb.auth.getSession();
    state.session = data.session;
    await loadProfile();
    onChange();
    sb.auth.onAuthStateChange(async (_e, session) => {
      const changed = (session && session.user.id) !== (state.session && state.session.user.id);
      state.session = session;
      if (changed) { await loadProfile(); onChange(); }
    });
  }

  // Pannello account: login con link via email, scelta nome, saldo e bonus
  function accountPanel(el, onChange) {
    if (!sb) {
      el.innerHTML = `<div class="acct"><p class="acct-title">Area fan in arrivo</p><p class="note">Login, gettoni e pronostici si attivano appena il sito viene collegato al database.</p></div>`;
      return;
    }
    const p = state.profile;
    if (!state.session) {
      el.innerHTML = `<form class="acct" id="login-form">
        <p class="acct-title">Accedi per pronosticare</p>
        <p class="note">Ti mandiamo un link via email, niente password. Alla prima registrazione ricevi 1.000 gettoni.</p>
        <div class="row"><label class="sr" for="login-email">Email</label>
          <input id="login-email" type="email" required placeholder="la-tua@email.it" autocomplete="email">
          <button class="btn" type="submit">Mandami il link</button></div>
        <p class="msg" id="login-msg" role="status"></p>
      </form>`;
      el.querySelector("#login-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const msg = el.querySelector("#login-msg");
        msg.textContent = "Invio in corso…";
        const { error } = await sb.auth.signInWithOtp({
          email: el.querySelector("#login-email").value.trim(),
          options: { emailRedirectTo: location.origin + location.pathname },
        });
        msg.textContent = error ? errText(error) : "Fatto: apri l'email e tocca il link per entrare.";
      });
      return;
    }
    if (!p) { el.innerHTML = `<div class="acct"><p class="note">Caricamento del profilo…</p></div>`; return; }
    if (!p.username) {
      el.innerHTML = `<form class="acct" id="name-form">
        <p class="acct-title">Scegli il tuo nome</p>
        <p class="note">Comparirà nella classifica dei fan. Da 3 a 20 caratteri: lettere, numeri, punto e trattino basso.</p>
        <div class="row"><label class="sr" for="name-input">Nome utente</label>
          <input id="name-input" required pattern="[A-Za-z0-9_.]{3,20}" maxlength="20" autocomplete="nickname">
          <button class="btn" type="submit">Salva</button></div>
        <p class="msg" id="name-msg" role="status"></p>
      </form>`;
      el.querySelector("#name-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const { error } = await sb.from("profiles").update({ username: el.querySelector("#name-input").value.trim() }).eq("id", p.id);
        if (error) { el.querySelector("#name-msg").textContent = error.code === "23505" ? "Nome già preso, scegline un altro." : errText(error); return; }
        await loadProfile(); onChange();
      });
      return;
    }
    const claimed = p.last_daily === todayRome();
    const canRescue = p.balance < 50;
    el.innerHTML = `<div class="acct acct-in">
      <div>
        <p class="bal-label">Il tuo saldo, ${esc(p.username)}</p>
        <p class="bal"><span class="num">${n(p.balance)}</span> gettoni</p>
        ${p.daily_streak > 1 ? `<p class="note small">Serie di ${p.daily_streak} giorni di fila</p>` : ""}
      </div>
      <div class="acct-actions">
        ${claimed ? "" : '<button class="btn cta" type="button" id="daily">Prendi il bonus di oggi</button>'}
        ${canRescue ? '<button class="btn" type="button" id="rescue">Salvagente +200</button>' : ""}
        ${p.is_admin ? '<a class="btn ghost" href="admin.html">Pannello admin</a>' : ""}
        <button class="btn ghost" type="button" id="logout">Esci</button>
      </div>
      <p class="msg" id="acct-msg" role="status"></p>
    </div>`;
    const msg = el.querySelector("#acct-msg");
    const daily = el.querySelector("#daily");
    if (daily) daily.addEventListener("click", async () => {
      const { data, error } = await sb.rpc("claim_daily");
      if (error) { msg.textContent = errText(error); return; }
      await loadProfile(); onChange();
      document.dispatchEvent(new CustomEvent("club:toast", { detail: `+${n(data.bonus)} gettoni` }));
    });
    const rescue = el.querySelector("#rescue");
    if (rescue) rescue.addEventListener("click", async () => {
      const { error } = await sb.rpc("claim_rescue");
      if (error) { msg.textContent = errText(error); return; }
      await loadProfile(); onChange();
    });
    el.querySelector("#logout").addEventListener("click", async () => { await sb.auth.signOut(); state.session = null; state.profile = null; onChange(); });
  }

  // Post con domande, opzioni e montepremi
  async function loadPosts({ all = false } = {}) {
    let q = sb.from("posts").select("*, markets(*, options(*))").order("created_at", { ascending: false }).limit(all ? 100 : 30);
    if (!all) q = q.eq("published", true);
    const { data: posts, error } = await q;
    if (error) throw error;
    const ids = posts.flatMap((p) => p.markets.map((m) => m.id));
    const totals = {};
    let myBets = [];
    if (ids.length) {
      const { data: t } = await sb.from("option_totals").select("*").in("market_id", ids);
      (t || []).forEach((r) => (totals[r.option_id] = r));
      if (state.session) {
        const { data: b } = await sb.from("bets").select("*").eq("user_id", state.session.user.id).in("market_id", ids);
        myBets = b || [];
      }
    }
    return { posts, totals, myBets };
  }

  function marketStatus(m) {
    if (m.status === "pagato") return { label: "Risultato pubblicato", open: false };
    if (m.status === "annullato") return { label: "Annullata, puntate rimborsate", open: false };
    if (m.status === "chiuso" || new Date(m.closes_at) <= new Date()) return { label: "Puntate chiuse, in attesa del risultato", open: false };
    return { label: `Puntate aperte fino a ${when(m.closes_at)}`, open: true };
  }

  const picked = {}; // domanda -> opzione scelta

  function marketHtml(m, totals, myBets, canBet) {
    const opts = (m.options || []).slice().sort((a, b) => a.sort - b.sort || a.id - b.id);
    const pool = opts.reduce((s, o) => s + Number((totals[o.id] || {}).total || 0), 0);
    const st = marketStatus(m);
    const open = st.open && canBet;
    const mine = myBets.filter((b) => b.market_id === m.id);
    const rows = opts.map((o) => {
      const t = Number((totals[o.id] || {}).total || 0);
      const share = pool ? Math.round((100 * t) / pool) : 0;
      const quota = t ? pool / t : null;
      const win = m.winning_option === o.id && m.status === "pagato";
      const myOn = mine.filter((b) => b.option_id === o.id).reduce((s, b) => s + Number(b.amount), 0);
      const sel = picked[m.id] === o.id;
      const inner = `<span class="opt-bar" style="width:${share}%"></span>
        <span class="opt-label">${esc(o.label)}${win ? " · ha vinto" : ""}${myOn ? ` <span class="mine">hai puntato ${n(myOn)}</span>` : ""}</span>
        <span class="opt-num num" title="Ogni gettone puntato ne rende tanti così se vince">${quota ? "rende x" + quota.toLocaleString("it-IT", { maximumFractionDigits: 1 }) : ""}</span>`;
      return open
        ? `<li><button type="button" class="opt pick ${sel ? "chosen" : ""}" data-pick="${o.id}" data-market="${m.id}" data-label="${esc(o.label)}" aria-pressed="${sel}">${inner}</button></li>`
        : `<li class="opt ${win ? "won" : ""}">${inner}</li>`;
    }).join("");
    const paid = mine.filter((b) => b.payout != null);
    const result = paid.length
      ? `<p class="note">Hai puntato ${n(mine.reduce((s, b) => s + Number(b.amount), 0))} e ricevuto ${n(paid.reduce((s, b) => s + Number(b.payout), 0))} gettoni.</p>` : "";
    const selLabel = picked[m.id] ? (opts.find((o) => o.id === picked[m.id]) || {}).label : null;
    return `<div class="market" data-market-id="${m.id}">
      <div class="market-head"><h4>${esc(m.question)}</h4><span class="market-state ${st.open ? "is-open" : ""}">${st.open ? "Chiude " + when(m.closes_at) : st.label}</span></div>
      ${open ? `<p class="note small">1. Tocca chi secondo te vince</p>` : ""}
      <ol class="opts">${rows}</ol>
      ${open ? `<div class="bet-box" ${selLabel ? "" : "hidden"} id="betbox-${m.id}">
        <p class="note small">2. Quanti gettoni punti?</p>
        <div class="row">
          ${[50, 100, 250].map((v) => `<button type="button" class="btn ghost small" data-amt="${v}" data-market="${m.id}">${v}</button>`).join("")}
          <label class="sr" for="amt-${m.id}">Gettoni</label>
          <input id="amt-${m.id}" class="amt" type="number" min="10" step="10" value="100" inputmode="numeric">
        </div>
        <button type="button" class="btn cta wide" data-bet="${picked[m.id] || ""}" data-market="${m.id}" id="betbtn-${m.id}">Punta su ${esc(selLabel || "")}</button>
      </div>` : ""}
      ${!canBet && st.open ? `<p class="note small"><a href="#pronostici" class="link-login">Accedi</a> per puntare.</p>` : ""}
      ${result}
      <p class="msg" role="status" id="mmsg-${m.id}"></p>
      <p class="note small">In palio: <span class="num">${n(pool)}</span> gettoni</p>
    </div>`;
  }

  function postHtml(p, totals, myBets, canBet) {
    return `<article class="post">
      <div class="top">${p.game ? `<span class="chip">${esc(p.game)}</span>` : "<span></span>"}<span class="date">${when(p.created_at)}</span></div>
      <h3>${esc(p.title)}</h3>
      ${p.body ? `<p>${esc(p.body)}</p>` : ""}
      ${p.video_url ? `<a class="yt" href="${esc(p.video_url)}" target="_blank" rel="noopener">Guarda il video ↗</a>` : ""}
      ${(p.markets || []).slice().sort((a, b) => a.id - b.id).map((m) => marketHtml(m, totals, myBets, canBet)).join("")}
    </article>`;
  }

  async function renderPronostici() {
    const acct = document.getElementById("club-account");
    const list = document.getElementById("club-posts");
    const lb = document.getElementById("club-leaderboard");
    if (!acct) return;
    const rerender = () => renderPronostici();
    accountPanel(acct, rerender);
    renderChip();
    if (!sb) { list.innerHTML = ""; lb.innerHTML = ""; return; }
    try {
      const { posts, totals, myBets } = await loadPosts();
      const canBet = Boolean(state.profile && state.profile.username);
      list.innerHTML = posts.length
        ? posts.map((p) => postHtml(p, totals, myBets, canBet)).join("")
        : `<p class="empty">Ancora nessun post. Quando esce una nuova golfatina, qui si potrà pronosticare chi vince.</p>`;
    } catch (e) {
      list.innerHTML = `<p class="empty">Non riesco a caricare i post: ${esc(errText(e))}</p>`;
    }
    const { data: fans } = await sb.from("fan_leaderboard").select("*").limit(20);
    lb.innerHTML = fans && fans.length
      ? `<table class="lb fans"><thead><tr><th>Pos</th><th>Fan</th><th>Gettoni</th><th>Pronostici vinti</th></tr></thead><tbody>${fans.map((f, i) => `<tr${state.profile && f.username === state.profile.username ? ' class="first"' : ""}><td class="pos">${i + 1}</td><td>${esc(f.username)}</td><td>${n(f.balance)}</td><td>${f.wins} su ${f.bets}</td></tr>`).join("")}</tbody></table>`
      : `<p class="empty">Nessun fan in classifica per ora.</p>`;
  }

  function renderChip() {
    const chip = document.getElementById("club-chip");
    if (!chip) return;
    const p = state.profile;
    chip.textContent = !sb ? "Area fan" : p && p.username ? `${n(p.balance)} gettoni` : state.session ? "Scegli il nome" : "Accedi";
  }

  // Scelta dell'opzione, importo e puntata
  document.addEventListener("click", async (e) => {
    const pick = e.target.closest("[data-pick]");
    if (pick) {
      const mid = pick.dataset.market;
      picked[mid] = Number(pick.dataset.pick);
      document.querySelectorAll(`[data-pick][data-market="${mid}"]`).forEach((x) => {
        const on = x === pick; x.classList.toggle("chosen", on); x.setAttribute("aria-pressed", on);
      });
      const box = document.getElementById("betbox-" + mid);
      if (box) box.hidden = false;
      const btn = document.getElementById("betbtn-" + mid);
      if (btn) { btn.dataset.bet = pick.dataset.pick; btn.textContent = "Punta su " + pick.dataset.label; }
      return;
    }
    const amtBtn = e.target.closest("[data-amt]");
    if (amtBtn) { document.getElementById("amt-" + amtBtn.dataset.market).value = amtBtn.dataset.amt; return; }
    const b = e.target.closest("[data-bet]");
    if (!b || !sb || !b.dataset.bet) return;
    const mid = b.dataset.market;
    const amt = Number(document.getElementById("amt-" + mid).value);
    const msg = document.getElementById("mmsg-" + mid);
    b.disabled = true;
    const { error } = await sb.rpc("place_bet", { p_option: Number(b.dataset.bet), p_amount: amt });
    b.disabled = false;
    if (error) { msg.textContent = errText(error); return; }
    delete picked[mid];
    await loadProfile();
    await renderPronostici();
    document.dispatchEvent(new CustomEvent("club:toast", { detail: `Puntata di ${n(amt)} gettoni fatta` }));
  });

  let toastTimer;
  document.addEventListener("club:toast", (e) => {
    const t = document.getElementById("toast"); if (!t) return;
    t.textContent = e.detail; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
  });

  window.Club = { sb, configured, state, init, loadProfile, accountPanel, loadPosts, marketStatus, esc, n, when, errText };

  if (document.getElementById("club-posts")) init(renderPronostici);
})();
