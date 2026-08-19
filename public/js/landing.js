// SEO landing pages: fill the results container with sailings matching the
// page's topic (destination / cruise line / departure port) and let visitors
// request a quote (which routes through sign-in).

(function () {
  const box = document.getElementById('seo-results');
  if (!box) return;
  const field = box.getAttribute('data-filter-type');   // destination | line | departure_port
  const value = (box.getAttribute('data-filter-value') || '').toLowerCase();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function nights(s) { return s.nights ? `${s.nights} ${Number(s.nights) === 1 ? 'night' : 'nights'}` : ''; }

  function card(s) {
    const shipLine = [s.line, s.ship].filter(Boolean).map(esc).join(' · ');
    const meta = [nights(s), s.destination, s.departure_port ? `Departs ${s.departure_port}` : ''].filter(Boolean).map(esc).join(' · ');
    return `<article class="seo-card">
      <div>
        ${shipLine ? `<div class="seo-card-ship">${shipLine}</div>` : ''}
        <div class="seo-card-name">${esc(s.name || s.destination || 'Cruise')}</div>
        ${meta ? `<div class="seo-card-meta">${meta}</div>` : ''}
      </div>
      <button type="button" class="btn btn-primary btn-sm" data-quote="${esc(s.id || '')}">Request a quote</button>
    </article>`;
  }

  function requestQuote(s) {
    const sailing = {
      line: s.line || '', ship: s.ship || '', name: s.name || '',
      sailing_dates: s.sailing_dates || s.depart_date || '', depart_date: s.depart_date || '',
      nights: s.nights || '', departure_port: s.departure_port || '', destination: s.destination || '',
    };
    try { sessionStorage.setItem('cs_quote_sailing', JSON.stringify(sailing)); } catch (e) {}
    window.location.href = '/quote';
  }

  async function run() {
    let data;
    try {
      const res = await fetch('/api/sailings', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('bad');
      data = await res.json();
    } catch (e) {
      box.innerHTML = `<div class="state">Couldn't load sailings right now. <a href="/app">Search all sailings</a>.</div>`;
      return;
    }
    const all = data.sailings || data.results || [];
    const match = (s) => {
      const v = String(s[field] || '').toLowerCase();
      return v.includes(value) || value.includes(v.split(' ')[0] || '~~');
    };
    let list = all.filter(match);
    if (!list.length) {
      box.innerHTML = `<div class="state">New sailings are added often. <a href="/app">Search all sailings</a> or <a href="/quote?manual=1">request any cruise</a>.</div>`;
      return;
    }
    const shown = list.slice(0, 24);
    box.innerHTML = `<div class="seo-grid">${shown.map(card).join('')}</div>` +
      (list.length > shown.length ? `<p style="margin-top:14px;"><a href="/app" class="btn btn-ghost">See all ${list.length} sailings in search</a></p>` : '');
    box.querySelectorAll('[data-quote]').forEach((b) => {
      const id = b.getAttribute('data-quote');
      b.addEventListener('click', () => { const s = shown.find((x) => String(x.id) === id) || {}; requestQuote(s); });
    });
  }

  run();
})();
