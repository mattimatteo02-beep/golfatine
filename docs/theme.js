// Cookie consent + ad slots. Ads load only with consent and only once config.adsenseClient is set.
(() => {
  const KEY = "umc-consent";
  const cfg = window.GOLFATINE_CONFIG || {};
  const box = document.getElementById("cookie");
  const opt = box.querySelector(".cookie-opt");
  const adsBox = document.getElementById("cookie-ads");
  const preview = new URLSearchParams(location.search).has("anteprima");

  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  const save = (ads) => { try { localStorage.setItem(KEY, JSON.stringify({ ads, date: new Date().toISOString() })); } catch {} };

  function loadAds() {
    if (!cfg.adsenseClient || document.getElementById("adsense")) return;
    const s = document.createElement("script");
    s.id = "adsense"; s.async = true; s.crossOrigin = "anonymous";
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(cfg.adsenseClient);
    document.head.appendChild(s);
    document.querySelectorAll(".ad-slot").forEach((el) => {
      el.hidden = false;
      el.innerHTML = '<ins class="adsbygoogle" style="display:block" data-ad-format="auto" data-full-width-responsive="true"></ins>';
      el.firstChild.dataset.adClient = cfg.adsenseClient;
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    });
  }

  function apply() {
    const c = read();
    if (c && c.ads) loadAds();
    if (preview) document.querySelectorAll(".ad-slot").forEach((el) => (el.hidden = false));
  }

  function open() {
    box.hidden = false; opt.hidden = true;
    box.querySelector('[data-c="custom"]').textContent = "Personalizza";
    adsBox.checked = !!(read() || {}).ads;
  }

  box.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-c]");
    if (!b) return;
    const c = b.dataset.c;
    if (c === "custom" && opt.hidden) { opt.hidden = false; b.textContent = "Salva scelta"; return; }
    save(c === "yes" ? true : c === "no" ? false : adsBox.checked);
    box.hidden = true; apply();
  });
  document.getElementById("cookie-open").addEventListener("click", open);

  if (!read()) open();
  apply();
})();
