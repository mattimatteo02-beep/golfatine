// Banner pubblicitari (Google AdSense). Si attivano solo quando config.adsenseClient è impostato.
// Il consenso ai cookie in Europa lo chiede il messaggio di Google (AdSense → Privacy e messaggi),
// che arriva insieme allo script degli annunci: il sito da solo usa solo l'archivio tecnico del login.
(() => {
  const cfg = window.GOLFATINE_CONFIG || {};
  const prefs = document.getElementById("cookie-open");
  const preview = new URLSearchParams(location.search).has("anteprima");

  if (cfg.adsenseClient) {
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
    // "Preferenze cookie" riapre il messaggio di consenso di Google
    if (prefs) prefs.addEventListener("click", () => {
      window.googlefc = window.googlefc || {};
      (window.googlefc.callbackQueue = window.googlefc.callbackQueue || []).push(() => window.googlefc.showRevocationMessage && window.googlefc.showRevocationMessage());
    });
  } else if (prefs) {
    // Senza pubblicità non c'è niente da scegliere: il link sparisce
    if (prefs.previousSibling && prefs.previousSibling.nodeType === 3) prefs.previousSibling.remove();
    prefs.remove();
  }
  if (preview) document.querySelectorAll(".ad-slot").forEach((el) => (el.hidden = false));
})();
