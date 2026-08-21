// SEO landing pages: Worker-rendered, indexable pages for destinations, cruise
// lines, and departure ports. Each has a unique title/description/H1 + intro,
// a live list of matching sailings (loaded client-side), interlinking, and a
// quote CTA. Also serves /cruises hub, sitemap.xml, and robots.txt.

const DESTINATIONS = [
  { slug: 'caribbean', name: 'Caribbean', blurb: 'Warm beaches, turquoise water, and short flights make the Caribbean the most popular cruise region in the world.' },
  { slug: 'bahamas', name: 'Bahamas', blurb: 'Quick, sunny getaways to Nassau, Freeport, and the cruise lines’ private islands—perfect for a first cruise or a long weekend.' },
  { slug: 'mediterranean', name: 'Mediterranean', blurb: 'Sail from Barcelona, Rome, or Athens to iconic ports across Italy, Spain, France, and the Greek Isles.' },
  { slug: 'alaska', name: 'Alaska', blurb: 'Glaciers, whales, and dramatic fjords—Alaska cruises pair scenic cruising with unforgettable shore excursions.' },
  { slug: 'mexico', name: 'Mexican Riviera', blurb: 'Cabo, Puerto Vallarta, and Mazatlan on easy round-trip sailings from the West Coast.' },
  { slug: 'europe', name: 'Europe', blurb: 'From Northern Europe and the Baltic to the Med, European cruises reach dozens of world-class cities by sea.' },
  { slug: 'hawaii', name: 'Hawaii', blurb: 'Island-hop the Hawaiian islands or cruise round-trip from the mainland to paradise.' },
  { slug: 'greek-isles', name: 'Greek Isles', blurb: 'Santorini, Mykonos, and ancient ports—Greek Isles cruises are a bucket-list favorite.' },
  { slug: 'norwegian-fjords', name: 'Norwegian Fjords', blurb: 'Cruise deep into Norway’s dramatic fjords past waterfalls and cliffside villages.' },
  { slug: 'panama-canal', name: 'Panama Canal', blurb: 'A once-in-a-lifetime transit of one of the world’s great engineering marvels.' },
  { slug: 'transatlantic', name: 'Transatlantic', blurb: 'Relaxed repositioning crossings between North America and Europe with great value fares.' },
  { slug: 'canada-new-england', name: 'Canada & New England', blurb: 'Fall foliage, lighthouses, and historic ports from Boston and New York up to Quebec.' },
];

const LINES = [
  { slug: 'royal-caribbean', name: 'Royal Caribbean', blurb: 'Game-changing megaships packed with activities for families and first-timers.' },
  { slug: 'carnival', name: 'Carnival', blurb: 'Fun, casual, great-value cruises from ports all across the U.S.' },
  { slug: 'norwegian', name: 'Norwegian Cruise Line', blurb: 'Freestyle cruising with flexible dining and a laid-back vibe.' },
  { slug: 'celebrity', name: 'Celebrity Cruises', blurb: 'Premium, modern ships with elevated dining and design.' },
  { slug: 'princess', name: 'Princess Cruises', blurb: 'Classic, comfortable cruising with strong Alaska and Europe programs.' },
  { slug: 'msc', name: 'MSC Cruises', blurb: 'European style and modern ships at a great value.' },
  { slug: 'holland-america', name: 'Holland America Line', blurb: 'Refined, mid-size ships known for service and immersive itineraries.' },
  { slug: 'disney', name: 'Disney Cruise Line', blurb: 'Unmatched family cruising with Disney entertainment and character experiences.' },
  { slug: 'virgin-voyages', name: 'Virgin Voyages', blurb: 'Adults-only, boutique-hotel-at-sea sailings with a bold, modern style.' },
  { slug: 'margaritaville-at-sea', name: 'Margaritaville at Sea', blurb: 'Laid-back, island-inspired short cruises and a relaxed “no worries” vibe.' },
  { slug: 'viking', name: 'Viking', blurb: 'Destination-focused ocean and river cruising for curious travelers.' },
  { slug: 'oceania', name: 'Oceania Cruises', blurb: 'Upper-premium cruising renowned for its cuisine and longer itineraries.' },
];

const PORTS = [
  { slug: 'miami', name: 'Miami', blurb: 'The cruise capital of the world, with sailings to the Caribbean and Bahamas year-round.' },
  { slug: 'fort-lauderdale', name: 'Fort Lauderdale', blurb: 'Port Everglades is a launch point for Caribbean, Panama Canal, and transatlantic cruises.' },
  { slug: 'port-canaveral', name: 'Port Canaveral', blurb: 'Near Orlando, ideal for pairing a cruise with a theme-park vacation.' },
  { slug: 'galveston', name: 'Galveston', blurb: 'Texas’ busy Gulf Coast port for Western Caribbean and Bahamas cruises.' },
  { slug: 'new-york', name: 'New York', blurb: 'Sail the East Coast, Bermuda, Canada & New England, and beyond from Manhattan and Brooklyn.' },
  { slug: 'seattle', name: 'Seattle', blurb: 'The gateway to Alaska’s Inside Passage every summer.' },
  { slug: 'los-angeles', name: 'Los Angeles', blurb: 'Round-trip Mexican Riviera and Hawaii cruises from Southern California.' },
  { slug: 'tampa', name: 'Tampa', blurb: 'A convenient Gulf Coast departure for Western Caribbean sailings.' },
  { slug: 'new-orleans', name: 'New Orleans', blurb: 'Cruise the Caribbean with a side of Big Easy culture before you sail.' },
  { slug: 'baltimore', name: 'Baltimore', blurb: 'Drive-to cruising to the Bahamas, Caribbean, and New England from the Mid-Atlantic.' },
];

const TYPES = {
  destination: { list: DESTINATIONS, label: 'Destination', path: 'destination', field: 'destination', h: (n) => `${n} Cruises`, kw: (n) => `${n} cruises` },
  line: { list: LINES, label: 'Cruise line', path: 'line', field: 'line', h: (n) => `${n} Cruises`, kw: (n) => `${n} cruises` },
  from: { list: PORTS, label: 'Departure port', path: 'from', field: 'departure_port', h: (n) => `Cruises from ${n}`, kw: (n) => `cruises from ${n}` },
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function htmlResponse(html, status = 200) {
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}

function shell({ title, description, canonical, bodyHtml }) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${esc(canonical)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:type" content="website" />
<link rel="icon" type="image/png" href="/img/favicon.png" />
<link rel="stylesheet" href="/css/styles.css" />
</head><body>
<header class="site-header">
  <div class="container bar">
    <a class="brand" href="/"><img src="/img/logo.png" alt="Cruise Shoppers" class="logo" /></a>
    <nav class="nav">
      <a href="/cruises" class="hide-sm">Cruises</a>
      <a href="/specials">Specials</a>
      <a href="/login">Client log in</a>
      <a href="/signup" class="btn btn-primary" style="padding:9px 18px;">Sign up free</a>
    </nav>
  </div>
</header>
${bodyHtml}
<footer class="site-footer">
  <div class="container row">
    <div class="footer-brand">
      <span class="brand" style="color:#fff;font-family:var(--font-head);"><span style="color:#fff;">Cruise</span> <span style="color:var(--teal-bright);">Shoppers</span></span>
      <div class="small">&copy; <span id="yr"></span> Cruise Shoppers Network, LLC. Lithia, FL.</div>
    </div>
    <nav class="footer-links">
      <a href="/cruises">All cruises</a>
      <a href="/specials">Specials</a>
      <a href="/how-it-works">How it works</a>
      <a href="/faq">FAQ</a>
      <a href="/for-advisors">Travel advisors</a>
      <a href="/terms">Terms</a>
      <a href="/privacy">Privacy</a>
    </nav>
  </div>
</footer>
<script>var _y=document.getElementById('yr');if(_y)_y.textContent=new Date().getFullYear();</script>
<script src="/js/nav.js" defer></script>
</body></html>`;
}

function linkGrid(type, items, activeSlug) {
  const cfg = TYPES[type];
  return `<div class="seo-links">${items.map((t) =>
    `<a href="/cruises/${cfg.path}/${t.slug}"${t.slug === activeSlug ? ' class="is-active"' : ''}>${esc(t.name)}</a>`).join('')}</div>`;
}

// A landing page for one topic.
export function renderLanding(type, slug, url) {
  const cfg = TYPES[type];
  if (!cfg) return null;
  const topic = cfg.list.find((t) => t.slug === slug);
  if (!topic) return null;
  const origin = url.origin;
  const canonical = `${origin}/cruises/${cfg.path}/${slug}`;
  const h1 = cfg.h(topic.name);
  const title = `${h1} | Compare Quotes | Cruise Shoppers`;
  const description = `${topic.blurb} Compare personalized quotes on ${cfg.kw(topic.name)} from trusted travel advisors. No pricing games, no obligation.`;

  const related = TYPES[type].list.filter((t) => t.slug !== slug).slice(0, 11);
  const body = `<main class="section">
  <div class="container" style="max-width:1000px;">
    <p class="seo-crumb"><a href="/cruises">All cruises</a> &rsaquo; ${esc(cfg.label)}</p>
    <h1 style="font-family:var(--font-head);color:var(--navy);font-size:2.2rem;margin:0 0 10px;">${esc(h1)}</h1>
    <p class="sub" style="max-width:720px;margin:0 0 6px;">${esc(topic.blurb)}</p>
    <p style="color:var(--ink-soft);max-width:720px;margin:0 0 20px;line-height:1.6;">On Cruise Shoppers you don’t just see a price—trusted travel advisors compete to send you their best personalized quote on ${esc(cfg.kw(topic.name))}. It’s free, there’s no obligation, and no pricing is shown online.</p>
    <div class="cta-row" style="margin-bottom:26px;">
      <a href="/signup" class="btn btn-primary btn-lg">Get quotes on ${esc(topic.name)}</a>
      <a href="/app" class="btn btn-ghost btn-lg">Browse sailings</a>
    </div>

    <h2 style="font-family:var(--font-head);color:var(--navy);">${esc(topic.name)} sailings</h2>
    <div id="seo-results" data-filter-type="${esc(cfg.field)}" data-filter-value="${esc(topic.name)}">
      <div class="state"><div class="spinner"></div>Loading sailings…</div>
    </div>

    <h2 style="font-family:var(--font-head);color:var(--navy);margin-top:34px;">More ${esc(cfg.label.toLowerCase())}s</h2>
    ${linkGrid(type, related, slug)}

    <h2 style="font-family:var(--font-head);color:var(--navy);margin-top:30px;">Explore by cruise line &amp; port</h2>
    ${linkGrid('line', LINES.slice(0, 8))}
    ${linkGrid('from', PORTS.slice(0, 8))}
  </div>
</main>
<script src="/js/landing.js"></script>`;

  return htmlResponse(shell({ title, description, canonical, bodyHtml: body }));
}

// The /cruises hub index.
export function renderHub(url) {
  const canonical = `${url.origin}/cruises`;
  const section = (type, heading) => {
    const cfg = TYPES[type];
    return `<h2 style="font-family:var(--font-head);color:var(--navy);margin-top:26px;">${esc(heading)}</h2>${linkGrid(type, cfg.list)}`;
  };
  const body = `<main class="section"><div class="container" style="max-width:1000px;">
    <h1 style="font-family:var(--font-head);color:var(--navy);font-size:2.2rem;margin:0 0 10px;">Find your cruise</h1>
    <p class="sub" style="max-width:720px;margin:0 0 20px;">Browse cruises by destination, cruise line, or departure port—then let trusted travel advisors compete to send you the best personalized quote. No obligation.</p>
    <div class="cta-row" style="margin-bottom:20px;"><a href="/app" class="btn btn-primary btn-lg">Search all sailings</a><a href="/help-me-choose" class="btn btn-navy btn-lg">Help me choose</a><a href="/specials" class="btn btn-ghost btn-lg">See specials</a></div>
    ${section('destination', 'Cruises by destination')}
    ${section('line', 'Cruises by cruise line')}
    ${section('from', 'Cruises by departure port')}
  </div></main>`;
  return htmlResponse(shell({
    title: 'Find Your Cruise by Destination, Line & Port | Cruise Shoppers',
    description: 'Browse cruises by destination, cruise line, and departure port. Compare personalized quotes from trusted travel advisors. No pricing games, no obligation.',
    canonical, bodyHtml: body,
  }));
}

export function renderSitemap(url) {
  const o = url.origin;
  const urls = [
    `${o}/`, `${o}/cruises`, `${o}/specials`, `${o}/how-it-works`, `${o}/why-us`,
    `${o}/faq`, `${o}/for-advisors`, `${o}/signup`, `${o}/terms`, `${o}/privacy`, `${o}/advisor-terms`,
  ];
  for (const [type, cfg] of Object.entries(TYPES)) {
    for (const t of cfg.list) urls.push(`${o}/cruises/${cfg.path}/${t.slug}`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}\n</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}

export function renderRobots(url) {
  const body = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /profile\nDisallow: /my-quotes\nDisallow: /quote\nDisallow: /forgot-password\nDisallow: /reset-password\nSitemap: ${url.origin}/sitemap.xml\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

// Route helper: returns a Response for SEO paths, or null if not an SEO path.
export function handleSeo(url) {
  const path = url.pathname;
  if (path === '/sitemap.xml') return renderSitemap(url);
  if (path === '/robots.txt') return renderRobots(url);
  if (path === '/cruises' || path === '/cruises/') return renderHub(url);
  const m = /^\/cruises\/(destination|line|from)\/([a-z0-9-]+)\/?$/.exec(path);
  if (m) return renderLanding(m[1], m[2], url);
  return null;
}
