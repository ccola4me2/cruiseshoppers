// Home-page "Featured specials" strip: shows up to 3 active specials and links
// to the full Specials page. Hidden entirely when there are none.

(async () => {
  const section = document.getElementById('specials-strip');
  const grid = document.getElementById('specials-strip-grid');
  if (!section || !grid) return;
  let data;
  try {
    const res = await fetch('/api/specials', { headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    data = await res.json();
  } catch { return; }
  const specials = (data && data.specials) || [];
  if (!specials.length) return;

  grid.innerHTML = specials.slice(0, 3).map((s) => {
    const shipLine = [s.cruise_line, s.ship].filter(Boolean).map(esc).join(' · ');
    const offeredBy = [s.advisor_name, s.agency].filter(Boolean).join(', ');
    const price = s.rate_from
      ? `<div class="special-price">${esc(money(s.rate_from))} <span class="special-pp">pp</span>${s.brochure_price ? ` <span class="special-was">${esc(money(s.brochure_price))}</span>` : ''}</div>`
      : '';
    return `<article class="special-card">
      <div class="special-body">
        ${shipLine ? `<div class="special-ship">${shipLine}</div>` : ''}
        <h3 class="special-headline">${esc(s.headline)}</h3>
        ${s.sail_dates ? `<div class="special-dates">${esc(s.sail_dates)}</div>` : ''}
        ${price}
        ${offeredBy ? `<div class="special-advisor">Offered by ${esc(offeredBy)}</div>` : ''}
      </div>
      <div class="special-foot"><a href="/specials" class="btn btn-primary btn-block">View special</a></div>
    </article>`;
  }).join('');

  section.hidden = false;

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
