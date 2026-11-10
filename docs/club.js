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
      <div><p class="acct-title">Ciao ${esc(p.username)}${p.is_admin ? ' <a class="chip" href="admin.html">admin</a>' : ""}</p>
        <p class="bal"><span class="num">${n(p.balance)}</span> gettoni</p>
        <p class="note">${p.daily_streak > 1 ? `Serie di ${p.daily_streak} giorni di fila. ` : ""}I gettoni non valgono soldi: servono solo per giocare.</p></div>
      <div class="acct-actions">
        <button class="btn" type="button" id="daily" ${claimed ? "disabled" : ""}>${claimed ? "Bonus di oggi riscattato" : "Riscatta il bonus di oggi"}</button>
        ${canRescue ? '<button class="btn ghost" type="button" id="rescue">Salvagente (+200)</button>' : ""}
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

  function marketHtml(m, totals, myBets, canBet) {
    const opts = (m.options || []).slice().sort((a, b) => a.sort - b.sort || a.id - b.id);
    const pool = opts.reduce((s, o) => s + Number((totals[o.id] || {}).total || 0), 0);
    const st = marketStatus(m);
    const mine = myBets.filter((b) => b.market_id === m.id);
    const rows = opts.map((o) => {
      const t = Number((totals[o.id] || {}).total || 0);
      const share = pool ? Math.round((100 * t) / pool) : 0;
      const quota = t ? pool / t : null;
      const win = m.winning_option === o.id && m.status === "pagato";
      const myOn = mine.filter((b) => b.option_id === o.id).reduce((s, b) => s + Number(b.amount), 0);
      return `<li class="opt ${win ? "won" : ""}">
        <span class="opt-bar" style="width:${share}%"></span>
        <span class="opt-label">${esc(o.label)}${win ? " · vince" : ""}${myOn ? ` <span class="mine">tu: ${n(myOn)}</span>` : ""}</span>
        <span class="opt-num num">${share}%</span>
        <span class="opt-num num" title="Quanto rende ogni gettone se vince, con il piatto di adesso">${quota ? "x" + quota.toLocaleString("it-IT", { maximumFractionDigits: 2 }) : "–"}</span>
        ${st.open && canBet ? `<button class="btn small" type="button" data-bet="${o.id}" data-market="${m.id}">Punta</button>` : ""}
      </li>`;
    }).join("");
    const paid = mine.filter((b) => b.payout != null);
    const result = paid.length
      ? `<p class="note">Hai puntato ${n(mine.reduce((s, b) => s + Number(b.amount), 0))} e ricevuto ${n(paid.reduce((s, b) => s + Number(b.payout), 0))} gettoni.</p>` : "";
    return `<div class="market" data-market-id="${m.id}">
      <div class="market-head"><h4>${esc(m.question)}</h4><span class="market-state ${st.open ? "is-open" : ""}">${st.label}</span></div>
      <p class="note small">Piatto: <span class="num">${n(pool)}</span> gettoni</p>
      <ol class="opts">${rows}</ol>
      ${st.open && canBet ? `<div class="row bet-row"><label for="amt-${m.id}">Puntata</label><input id="amt-${m.id}" class="amt" type="number" min="10" step="10" value="50" inputmode="numeric"><span class="note small">Scegli quanto, poi tocca Punta sull'opzione.</span></div>` : ""}
      ${result}
      <p class="msg" role="status" id="mmsg-${m.id}"></p>
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
    chip.textContent = !sb ? "Area fan" : p && p.username ? `${n(p.balance)} gettoni` : "Accedi";
  }

  // Click su "Punta"
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-bet]");
    if (!b || !sb) return;
    const mid = b.dataset.market;
    const amt = Number(document.getElementById("amt-" + mid).value);
    const msg = document.getElementById("mmsg-" + mid);
    b.disabled = true;
    const { error } = await sb.rpc("place_bet", { p_option: Number(b.dataset.bet), p_amount: amt });
    b.disabled = false;
    if (error) { msg.textContent = errText(error); return; }
    await loadProfile();
    await renderPronostici();
    const m2 = document.getElementById("mmsg-" + mid);
    if (m2) m2.textContent = `Puntata di ${n(amt)} gettoni registrata.`;
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
