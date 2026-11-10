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
    state.profile = null; state.profileError = null;
    if (!sb || !state.session) return null;
    const { data, error } = await sb.from("profiles").select("*").eq("id", state.session.user.id).maybeSingle();
    state.profile = data;
    state.profileError = error || (data ? null : { message: "Profilo non trovato." });
    return data;
  }

  // Se si arriva dal link dell'email, l'indirizzo contiene il risultato dell'accesso
  const startHash = location.hash;
  const fromEmailLink = /access_token=|type=(signup|magiclink|recovery)/.test(startHash);
  const linkError = /error_description=/.test(startHash)
    ? decodeURIComponent((startHash.match(/error_description=([^&]*)/) || [])[1] || "").replace(/\+/g, " ") : "";

  async function init(onChange) {
    if (!sb) { onChange(); return; }
    const { data } = await sb.auth.getSession();
    state.session = data.session;
    await loadProfile();
    if (state.session && fromEmailLink && document.getElementById("profilo")) location.hash = "profilo";
    else if (linkError && document.getElementById("profilo")) { flash = /expired|invalid/i.test(linkError) ? "Il link dell'email è scaduto o già usato: accedi con email e password, oppure fatti mandare un nuovo link." : linkError; location.hash = "profilo"; }
    onChange();
    // Niente await qui dentro: Supabase lo esegue mentre tiene un blocco interno e si incastrerebbe
    sb.auth.onAuthStateChange((_e, session) => {
      const changed = (session && session.user.id) !== (state.session && state.session.user.id);
      state.session = session;
      if (changed) setTimeout(async () => { await loadProfile(); onChange(); }, 0);
    });
  }
  let flash = "";

  // Avatar: palline da golf colorate
  const AVATARS = [
    ["rossa", "#d7263d", "Rossa", "Rohn", "rohn"], ["rosa", "#f06aa8", "Rosa", "Dread", "dread"], ["verde", "#2fa152", "Verde", "Delux", "delux"],
    ["arancione", "#f28c18", "Arancione", "Gabbo", "gabbo"], ["viola", "#8250c8", "Viola", "Mollu", "mollu"],
    ["blu-scuro", "#1f3f94", "Blu scuro", "JTaz", "jtaz"], ["blu-chiaro", "#4fb3f0", "Blu chiaro", "Masseo", "masseo"],
  ];
  const DIMPLES = [[11, 9], [17, 8], [22, 11], [8, 15], [14, 14], [20, 16], [25, 17], [10, 21], [16, 20], [22, 22], [13, 26], [19, 26]];
  function ball(av, size = 32) {
    const a = AVATARS.find((x) => x[0] === av) || AVATARS[0];
    return `<svg class="ball" width="${size}" height="${size}" viewBox="0 0 32 32" role="img" aria-label="Pallina ${a[2].toLowerCase()}">
      <circle cx="16" cy="16" r="15" fill="${a[1]}" stroke="rgba(0,0,0,.25)" stroke-width="1"/>
      ${DIMPLES.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4" fill="rgba(0,0,0,.18)"/>`).join("")}
      <ellipse cx="11" cy="9.5" rx="5" ry="3" fill="rgba(255,255,255,.45)" transform="rotate(-30 11 9.5)"/>
    </svg>`;
  }
  function avatarPicker(name, current) {
    return `<fieldset class="avatars"><legend>Scegli la tua pallina: tifi per chi?</legend>
      ${AVATARS.map(([id, , label, player]) => `<label class="av" title="${label}, la pallina di ${player}"><input type="radio" name="${name}" value="${id}" ${id === (current || "rossa") ? "checked" : ""}>${ball(id, 40)}<span class="av-name">${player}</span></label>`).join("")}
    </fieldset>`;
  }
  const authError = (e) => {
    const m = (e && e.message) || "";
    if (/invalid login credentials/i.test(m)) return "Email o password sbagliate.";
    if (/email not confirmed/i.test(m)) return "Devi prima confermare l'email: controlla la posta (anche lo spam).";
    if (/already registered|already exists/i.test(m)) return "Esiste già un account con questa email: accedi.";
    if (/password should be at least/i.test(m)) return "La password deve avere almeno 6 caratteri.";
    if (/rate limit|too many/i.test(m)) return "Troppi tentativi, riprova fra qualche minuto.";
    return errText(e);
  };
  const NAME_RE = /^[A-Za-z0-9_.]{3,20}$/;

  let authMode = "registrati";

  // Pannello account: registrazione, accesso, scelta nome e avatar, saldo e bonus
  function accountPanel(el, onChange) {
    if (!sb) {
      el.innerHTML = `<div class="acct"><p class="acct-title">Area fan in arrivo</p><p class="note">Login, gettoni e pronostici si attivano appena il sito viene collegato al database.</p></div>`;
      return;
    }
    const p = state.profile;
    const redirect = location.origin + location.pathname;
    if (!state.session) {
      const tabs = `<div class="seg auth-tabs" role="tablist">
        <button type="button" role="tab" aria-selected="${authMode === "registrati"}" data-mode="registrati">Registrati</button>
        <button type="button" role="tab" aria-selected="${authMode === "accedi"}" data-mode="accedi">Accedi</button></div>`;
      el.innerHTML = authMode === "registrati"
        ? `<form class="acct" id="signup-form">${tabs}
          <p class="note">Crea il tuo account e ricevi subito 1.000 gettoni.</p>
          <label class="field"><span>Nome utente</span><input id="su-name" required pattern="[A-Za-z0-9_.]{3,20}" maxlength="20" autocomplete="username" placeholder="es. golfista_99"></label>
          <p class="msg small" id="su-name-msg"></p>
          <label class="field"><span>Email</span><input id="su-email" type="email" required autocomplete="email" placeholder="la-tua@email.it"></label>
          <label class="field"><span>Password (almeno 6 caratteri)</span><input id="su-pass" type="password" required minlength="6" autocomplete="new-password"></label>
          ${avatarPicker("su-avatar")}
          <button class="btn cta wide" type="submit">Crea account</button>
          <p class="msg" id="su-msg" role="status"></p>
        </form>`
        : `<form class="acct" id="login-form">${tabs}
          <label class="field"><span>Email</span><input id="li-email" type="email" required autocomplete="email" placeholder="la-tua@email.it"></label>
          <label class="field"><span>Password</span><input id="li-pass" type="password" autocomplete="current-password"></label>
          <button class="btn cta wide" type="submit">Entra</button>
          <button class="linkish" type="button" id="li-magic">Password dimenticata? Entra con un link via email</button>
          <p class="msg" id="li-msg" role="status"></p>
        </form>`;
      if (flash) { const fm = el.querySelector("#su-msg, #li-msg"); if (fm) fm.textContent = flash; flash = ""; }
      el.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { authMode = b.dataset.mode; accountPanel(el, onChange); }));

      const su = el.querySelector("#signup-form");
      if (su) {
        const nameIn = su.querySelector("#su-name"), nameMsg = su.querySelector("#su-name-msg");
        const check = async () => {
          const v = nameIn.value.trim();
          if (!v) { nameMsg.textContent = ""; return true; }
          if (!NAME_RE.test(v)) { nameMsg.textContent = "Da 3 a 20 caratteri: lettere, numeri, punto e trattino basso."; return false; }
          const { data, error } = await sb.rpc("username_available", { p_name: v });
          if (error) { nameMsg.textContent = ""; return true; } // il controllo lo rifà comunque il database
          nameMsg.textContent = data ? "Nome libero ✓" : "Nome già preso, scegline un altro.";
          return Boolean(data);
        };
        nameIn.addEventListener("change", check);
        su.addEventListener("submit", async (e) => {
          e.preventDefault();
          const msg = su.querySelector("#su-msg");
          if (!(await check())) { msg.textContent = "Controlla il nome utente."; return; }
          msg.textContent = "Creazione dell'account…";
          const avatar = (su.querySelector('input[name="su-avatar"]:checked') || {}).value || "rossa";
          const { data, error } = await sb.auth.signUp({
            email: su.querySelector("#su-email").value.trim(),
            password: su.querySelector("#su-pass").value,
            options: { emailRedirectTo: redirect, data: { username: nameIn.value.trim(), avatar } },
          });
          if (error) { msg.textContent = authError(error); return; }
          if (data.session) { state.session = data.session; await loadProfile(); onChange(); return; }
          msg.textContent = "Quasi fatto: ti abbiamo mandato un'email. Tocca il link per confermare e sei dentro.";
        });
      }
      const li = el.querySelector("#login-form");
      if (li) {
        const msg = li.querySelector("#li-msg");
        li.addEventListener("submit", async (e) => {
          e.preventDefault();
          const pass = li.querySelector("#li-pass").value;
          if (!pass) { msg.textContent = "Scrivi la password, oppure usa il link via email qui sotto."; return; }
          msg.textContent = "Accesso…";
          const { data, error } = await sb.auth.signInWithPassword({ email: li.querySelector("#li-email").value.trim(), password: pass });
          if (error) {
            msg.textContent = authError(error);
            if (/email not confirmed/i.test(error.message)) {
              const again = document.createElement("button");
              again.type = "button"; again.className = "linkish"; again.textContent = "Rimandami l'email di conferma";
              again.addEventListener("click", async () => {
                const { error: e2 } = await sb.auth.resend({ type: "signup", email: li.querySelector("#li-email").value.trim(), options: { emailRedirectTo: redirect } });
                msg.textContent = e2 ? authError(e2) : "Email rimandata: controlla la posta (anche lo spam).";
              });
              msg.append(" ", again);
            }
            return;
          }
          state.session = data.session; await loadProfile(); onChange();
        });
        li.querySelector("#li-magic").addEventListener("click", async () => {
          const email = li.querySelector("#li-email").value.trim();
          if (!email) { msg.textContent = "Scrivi prima la tua email."; return; }
          msg.textContent = "Invio in corso…";
          const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: false } });
          msg.textContent = error ? authError(error) : "Fatto: apri l'email e tocca il link per entrare.";
        });
      }
      return;
    }
    if (!p) {
      el.innerHTML = state.profileError
        ? `<div class="acct"><p class="acct-title">Non riesco a caricare il tuo profilo</p><p class="note">${esc(errText(state.profileError))}</p>
           <div class="acct-actions start"><button class="btn" type="button" id="retry">Riprova</button><button class="btn ghost" type="button" id="logout">Esci</button></div></div>`
        : `<div class="acct"><p class="note">Caricamento del profilo…</p></div>`;
      const r = el.querySelector("#retry");
      if (r) r.addEventListener("click", async () => { await loadProfile(); onChange(); });
      const lo = el.querySelector("#logout");
      if (lo) lo.addEventListener("click", logout(onChange));
      return;
    }
    if (!p.username) {
      el.innerHTML = `<form class="acct" id="name-form">
        <p class="acct-title">Completa il tuo profilo</p>
        <label class="field"><span>Nome utente (comparirà nella classifica dei fan)</span>
          <input id="name-input" required pattern="[A-Za-z0-9_.]{3,20}" maxlength="20" autocomplete="username"></label>
        ${avatarPicker("pf-avatar", p.avatar)}
        <button class="btn cta wide" type="submit">Salva</button>
        <p class="msg" id="name-msg" role="status"></p>
      </form>`;
      el.querySelector("#name-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const avatar = (el.querySelector('input[name="pf-avatar"]:checked') || {}).value || "rossa";
        const { error } = await sb.from("profiles").update({ username: el.querySelector("#name-input").value.trim(), avatar }).eq("id", p.id);
        if (error) { el.querySelector("#name-msg").textContent = nameError(error); return; }
        await loadProfile(); onChange();
      });
      return;
    }
    const claimed = p.last_daily === todayRome();
    const canRescue = p.balance < 50;
    const fan = AVATARS.find((x) => x[0] === p.avatar) || AVATARS[0];
    el.innerHTML = `<div class="acct acct-in">
      <div class="me">
        ${ball(p.avatar, 64)}
        <div>
          <p class="acct-title">${esc(p.username)}</p>
          <p class="note small">Tifi ${esc(fan[3])}${p.is_admin ? " · admin" : ""}</p>
          <p class="bal"><span class="num">${n(p.balance)}</span> gettoni</p>
          ${p.daily_streak > 1 ? `<p class="note small">Serie di ${p.daily_streak} giorni di fila</p>` : ""}
        </div>
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
      daily.disabled = true;
      const { data, error } = await sb.rpc("claim_daily");
      if (error) { daily.disabled = false; msg.textContent = errText(error); return; }
      await loadProfile(); onChange();
      document.dispatchEvent(new CustomEvent("club:toast", { detail: `+${n(data.bonus)} gettoni` }));
    });
    const rescue = el.querySelector("#rescue");
    if (rescue) rescue.addEventListener("click", async () => {
      const { error } = await sb.rpc("claim_rescue");
      if (error) { msg.textContent = errText(error); return; }
      await loadProfile(); onChange();
    });
    el.querySelector("#logout").addEventListener("click", logout(onChange));
  }

  const logout = (onChange) => async () => {
    await sb.auth.signOut();
    state.session = null; state.profile = null;
    if (document.getElementById("profilo")) location.hash = "profilo";
    onChange();
  };
  const nameError = (error) => error.code === "23505" ? "Nome già preso, scegline un altro."
    : error.code === "23514" ? "Da 3 a 20 caratteri: lettere, numeri, punto e trattino basso." : errText(error);

  // Gestione del profilo: nome, pallina, password, storico
  const REASONS = { benvenuto: "Benvenuto", giornaliero: "Bonus del giorno", salvagente: "Salvagente", puntata: "Puntata", vincita: "Vincita", rimborso: "Rimborso" };
  const shortDate = (iso) => new Date(iso).toLocaleDateString("it-IT", { day: "numeric", month: "short" });
  async function profileManager(el, onChange) {
    const p = state.profile;
    if (!sb || !p || !p.username) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="manage">
      <form class="acct" id="edit-form">
        <p class="acct-title">Modifica profilo</p>
        <label class="field"><span>Nome utente</span><input id="ed-name" required pattern="[A-Za-z0-9_.]{3,20}" maxlength="20" autocomplete="username" value="${esc(p.username)}"></label>
        ${avatarPicker("ed-avatar", p.avatar)}
        <button class="btn" type="submit">Salva modifiche</button>
        <p class="msg" id="ed-msg" role="status"></p>
      </form>
      <form class="acct" id="pw-form">
        <p class="acct-title">Accesso</p>
        <p class="note small">Email: ${esc(state.session.user.email || "")}</p>
        <input type="email" hidden autocomplete="username" value="${esc(state.session.user.email || "")}">
        <label class="field"><span>Nuova password (almeno 6 caratteri)</span><input id="pw-new" type="password" required minlength="6" autocomplete="new-password"></label>
        <button class="btn" type="submit">Cambia password</button>
        <p class="msg" id="pw-msg" role="status"></p>
      </form>
      <div class="acct"><p class="acct-title">I miei pronostici</p><div id="my-bets"><p class="note small">Caricamento…</p></div></div>
      <div class="acct"><p class="acct-title">Movimenti dei gettoni</p><div id="my-tx"><p class="note small">Caricamento…</p></div></div>
    </div>`;
    el.querySelector("#edit-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const m = el.querySelector("#ed-msg");
      const username = el.querySelector("#ed-name").value.trim();
      const avatar = (el.querySelector('input[name="ed-avatar"]:checked') || {}).value || p.avatar;
      if (username === p.username && avatar === p.avatar) { m.textContent = "Nessuna modifica da salvare."; return; }
      m.textContent = "Salvataggio…";
      const { error } = await sb.from("profiles").update({ username, avatar }).eq("id", p.id);
      if (error) { m.textContent = nameError(error); return; }
      await loadProfile(); onChange();
      document.dispatchEvent(new CustomEvent("club:toast", { detail: "Profilo aggiornato" }));
    });
    el.querySelector("#pw-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const m = el.querySelector("#pw-msg");
      m.textContent = "Salvataggio…";
      const { error } = await sb.auth.updateUser({ password: el.querySelector("#pw-new").value });
      if (error) { m.textContent = /different from the old/i.test(error.message) ? "È uguale a quella di prima: scegline una nuova." : authError(error); return; }
      el.querySelector("#pw-new").value = "";
      m.textContent = "Password cambiata.";
    });
    const [{ data: bets, error: e1 }, { data: tx, error: e2 }] = await Promise.all([
      sb.from("bets").select("amount, payout, created_at, picks, options(label), markets(question, status, kind, options(id, label)), option_id").eq("user_id", p.id).order("created_at", { ascending: false }).limit(30),
      sb.from("transactions").select("amount, reason, created_at").eq("user_id", p.id).order("created_at", { ascending: false }).limit(20),
    ]);
    const betsEl = el.querySelector("#my-bets"), txEl = el.querySelector("#my-tx");
    if (!betsEl) return;
    betsEl.innerHTML = e1 ? `<p class="note small">${esc(errText(e1))}</p>` : !bets.length
      ? `<p class="note small">Nessun pronostico ancora. <a href="#pronostici">Vai ai pronostici</a>.</p>`
      : `<ul class="hist">${bets.map((b) => {
          const mk = b.markets || {};
          const st = mk.status === "pagato" ? (b.payout > 0 ? `<span class="pos-amt">+${n(b.payout)}</span>` : `<span class="neg-amt">perso</span>`)
            : mk.status === "annullato" ? "rimborsato" : "in attesa";
          const lab = (id) => ((mk.options || []).find((o) => o.id === id) || {}).label || "?";
          const what = b.picks ? "Podio " + b.picks.map((id, i) => `${i + 1}° ${lab(id)}`).join(", ") : (b.options || {}).label || "";
          return `<li><span><strong>${esc(what)}</strong> · ${esc(mk.question || "")}<br><span class="note small">${shortDate(b.created_at)} · puntati ${n(b.amount)}</span></span><span class="hist-amt">${st}</span></li>`;
        }).join("")}</ul>`;
    txEl.innerHTML = e2 ? `<p class="note small">${esc(errText(e2))}</p>`
      : `<ul class="hist">${(tx || []).map((t) => `<li><span>${REASONS[t.reason] || esc(t.reason)}<br><span class="note small">${shortDate(t.created_at)}</span></span><span class="hist-amt ${t.amount > 0 ? "pos-amt" : "neg-amt"}">${t.amount > 0 ? "+" : ""}${n(t.amount)}</span></li>`).join("")}</ul>`;
  }

  // Striscia in cima ai pronostici: chi sei e quanti gettoni hai, oppure invito ad accedere
  function statusStrip(el) {
    if (!el) return;
    const p = state.profile;
    const steps = document.getElementById("club-steps");
    if (steps) steps.hidden = Boolean(p && p.username);
    if (!sb) { el.innerHTML = ""; return; }
    el.innerHTML = p && p.username
      ? `<a class="strip" href="#profilo">${ball(p.avatar, 36)}<span><strong>${esc(p.username)}</strong> · <span class="num">${n(p.balance)}</span> gettoni</span>${p.last_daily === todayRome() ? "" : '<span class="strip-tag">Bonus di oggi da ritirare</span>'}<span class="strip-go">Il mio profilo ›</span></a>`
      : state.session
        ? `<a class="strip" href="#profilo"><span>Completa il profilo per iniziare a puntare</span><span class="strip-go">Vai ›</span></a>`
        : `<div class="strip"><span>Per puntare ti serve un account (gratis, 1.000 gettoni in regalo).</span><a class="btn cta small" href="#profilo">Accedi o registrati</a></div>`;
  }

  // Quanti fan tifano ogni giocatore (in base alla pallina scelta)
  async function loadFanCounts() {
    const slots = document.querySelectorAll("[data-fans]");
    if (!sb || !slots.length) return;
    const { data, error } = await sb.rpc("fan_counts");
    if (error || !data) return;
    const by = {};
    data.forEach((r) => { const a = AVATARS.find((x) => x[0] === r.avatar); if (a) by[a[4]] = r.fans; });
    slots.forEach((s) => {
      const c = by[s.dataset.fans] || 0;
      s.innerHTML = `<strong class="num">${n(c)}</strong> ${c === 1 ? "fan lo tifa" : "fan lo tifano"}`;
      s.hidden = false;
    });
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
  const podPicks = {}; // domanda del podio -> [1°, 2°, 3°]
  const lastArgs = {}; // per ridisegnare una sola domanda

  // Pronostico del podio: si scelgono in ordine primo, secondo e terzo
  function podiumHtml(m, totals, myBets, canBet) {
    lastArgs[m.id] = [m, totals, myBets, canBet];
    const opts = (m.options || []).slice().sort((a, b) => a.sort - b.sort || a.id - b.id);
    const label = (id) => (opts.find((o) => o.id === id) || {}).label || "?";
    const pool = opts.reduce((s, o) => s + Number((totals[o.id] || {}).total || 0), 0);
    const bettors = opts.reduce((s, o) => s + Number((totals[o.id] || {}).bettors || 0), 0);
    const st = marketStatus(m);
    const open = st.open && canBet;
    const mine = myBets.filter((b) => b.market_id === m.id);
    const chosen = podPicks[m.id] || [];
    const real = m.status === "pagato" && m.podium ? m.podium : null;
    const rows = opts.map((o) => {
      const at = chosen.indexOf(o.id);
      const realAt = real ? real.indexOf(o.id) : -1;
      const badge = at >= 0 ? `<span class="pod-badge">${at + 1}°</span>` : realAt >= 0 ? `<span class="pod-badge real">${realAt + 1}°</span>` : "";
      const inner = `<span class="opt-label">${esc(o.label)}</span>${badge}`;
      return open
        ? `<li><button type="button" class="opt pick pod ${at >= 0 ? "chosen" : ""}" data-podpick="${o.id}" data-market="${m.id}" aria-pressed="${at >= 0}">${inner}</button></li>`
        : `<li class="opt pod ${realAt >= 0 ? "won" : ""}">${inner}</li>`;
    }).join("");
    const myList = mine.map((b) => `<li>${(b.picks || []).map((id, i) => `${i + 1}° ${esc(label(id))}`).join(" · ")} — ${n(b.amount)} gettoni${b.payout != null ? (b.payout > 0 ? ` <span class="pos-amt">vinti ${n(b.payout)}</span>` : m.status === "annullato" ? " (rimborsati)" : " (perso)") : ""}</li>`).join("");
    const next = ["primo", "secondo", "terzo"][chosen.length];
    return `<div class="market podium" data-market-id="${m.id}">
      <div class="market-head"><h4>${esc(m.question)}</h4><span class="market-state ${st.open ? "is-open" : ""}">${st.open ? "Chiude " + when(m.closes_at) : st.label}</span></div>
      ${open ? `<p class="note small">${chosen.length < 3 ? `1. Tocca chi arriva <strong>${next}</strong>` : "Podio scelto: tocca un nome per cambiarlo"}. Vinci solo se indovini l'ordine esatto, per questo rende molto di più.</p>` : ""}
      <ol class="opts">${rows}</ol>
      ${open ? `<div class="bet-box" ${chosen.length === 3 ? "" : "hidden"}>
        <p class="note small">2. Quanti gettoni punti?</p>
        <div class="row">
          ${[50, 100, 250].map((v) => `<button type="button" class="btn ghost small" data-amt="${v}" data-market="${m.id}">${v}</button>`).join("")}
          <label class="sr" for="amt-${m.id}">Gettoni</label>
          <input id="amt-${m.id}" class="amt" type="number" min="10" step="10" value="${esc(podAmt[m.id] || 100)}" inputmode="numeric">
        </div>
        <button type="button" class="btn cta wide" data-podbet="${m.id}">Punta su questo podio</button>
      </div>` : ""}
      ${!canBet && st.open ? `<p class="note small"><a href="#profilo" class="link-login">Accedi</a> per puntare.</p>` : ""}
      ${myList ? `<ul class="my-podiums">${myList}</ul>` : ""}
      <p class="msg" role="status" id="mmsg-${m.id}"></p>
      <p class="note small">In palio: <span class="num">${n(pool)}</span> gettoni · ${bettors} ${bettors === 1 ? "podio giocato" : "podi giocati"}</p>
    </div>`;
  }
  const podAmt = {};

  function marketHtml(m, totals, myBets, canBet) {
    if (m.kind === "podio") return podiumHtml(m, totals, myBets, canBet);
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
      ${!canBet && st.open ? `<p class="note small"><a href="#profilo" class="link-login">Accedi</a> per puntare.</p>` : ""}
      ${result}
      <p class="msg" role="status" id="mmsg-${m.id}"></p>
      <p class="note small">In palio: <span class="num">${n(pool)}</span> gettoni</p>
    </div>`;
  }

  function postHtml(p, totals, myBets, canBet) {
    return `<article class="post">
      <div class="top">${p.game ? `<span class="chip">${esc(p.game)}</span>` : "<span></span>"}<span class="date">${when(p.created_at)}</span></div>
      ${p.image_url ? `<img class="post-thumb" src="${esc(p.image_url)}" alt="Miniatura del video" loading="lazy">` : ""}
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
    profileManager(document.getElementById("club-manage"), rerender);
    statusStrip(document.getElementById("club-status"));
    renderChip();
    loadFanCounts();
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
      ? `<table class="lb fans"><thead><tr><th>Pos</th><th>Fan</th><th>Gettoni</th><th>Pronostici vinti</th></tr></thead><tbody>${fans.map((f, i) => `<tr${state.profile && f.username === state.profile.username ? ' class="first"' : ""}><td class="pos">${i + 1}</td><td><span class="fan">${ball(f.avatar, 22)}${esc(f.username)}</span></td><td>${n(f.balance)}</td><td>${f.wins} su ${f.bets}</td></tr>`).join("")}</tbody></table>`
      : `<p class="empty">Nessun fan in classifica per ora.</p>`;
  }

  function renderChip() {
    const chip = document.getElementById("club-chip");
    if (!chip) return;
    const p = state.profile;
    chip.classList.toggle("is-in", Boolean(p && p.username));
    if (p && p.username) { chip.innerHTML = `${ball(p.avatar, 22)}<span class="chip-name">${esc(p.username)}</span><span class="chip-bal num">${n(p.balance)}</span>`; chip.title = "Il mio profilo"; }
    else { chip.textContent = !sb ? "Area fan" : state.session ? "Completa il profilo" : "Accedi"; chip.title = ""; }
  }

  // Scelta dell'opzione, importo e puntata
  document.addEventListener("click", async (e) => {
    const pp = e.target.closest("[data-podpick]");
    if (pp) {
      const mid = pp.dataset.market, id = Number(pp.dataset.podpick);
      const list = podPicks[mid] || (podPicks[mid] = []);
      const at = list.indexOf(id);
      if (at >= 0) list.splice(at, 1); else if (list.length < 3) list.push(id);
      const amt = document.getElementById("amt-" + mid);
      if (amt) podAmt[mid] = amt.value;
      const el = document.querySelector(`[data-market-id="${mid}"]`);
      if (el && lastArgs[mid]) el.outerHTML = podiumHtml(...lastArgs[mid]);
      return;
    }
    const pb = e.target.closest("[data-podbet]");
    if (pb && sb) {
      const mid = pb.dataset.podbet;
      const amt = Number(document.getElementById("amt-" + mid).value);
      const msg = document.getElementById("mmsg-" + mid);
      pb.disabled = true;
      const { error } = await sb.rpc("place_podium_bet", { p_market: Number(mid), p_picks: podPicks[mid], p_amount: amt });
      pb.disabled = false;
      if (error) { msg.textContent = errText(error); return; }
      delete podPicks[mid];
      await loadProfile();
      await renderPronostici();
      document.dispatchEvent(new CustomEvent("club:toast", { detail: `Podio giocato: ${n(amt)} gettoni` }));
      return;
    }
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

  window.Club = { ball, AVATARS, sb, configured, state, init, loadProfile, accountPanel, loadPosts, marketStatus, esc, n, when, errText };

  if (document.getElementById("club-posts")) init(renderPronostici);
})();
