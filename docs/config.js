// Collegamento a Supabase (login, post e pronostici).
// Copia qui "Project URL" e la chiave "anon public" da Supabase → Project Settings → API.
// La chiave anon è pubblica per natura: la sicurezza sta nelle regole di supabase/schema.sql.
window.GOLFATINE_CONFIG = {
  supabaseUrl: "https://qvlaobvuthnzinrsvxnr.supabase.co",
  supabaseAnonKey: "sb_publishable_klheITUS01XZGu3sVcSK9w_43hHHIll",
  // Dominio del sito (es. "umc-melagodo.com"). Quando è impostato, build_data.py crea docs/CNAME,
  // robots.txt e sitemap.xml con questo indirizzo. Lascialo vuoto finché il dominio non punta a GitHub Pages.
  siteDomain: "umc-melagodo.com",
  // ID editore AdSense (es. "ca-pub-1234567890123456"). Quando è impostato si attivano i banner
  // e build_data.py crea docs/ads.txt. Il consenso in Europa lo chiede il messaggio di Google (Privacy e messaggi).
  adsenseClient: "ca-pub-6410464030440942",
};
