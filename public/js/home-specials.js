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

  // On the homepage strip we intentionally omit the "Offered by {advisor}" line
  // so a single advisor's specials don't read as the whole marketplace. The
  // advisor is still credited on the full /specials page. Easy to restore later.
  grid.innerHTML = specials.slice(0, 6).map((s) => {
    const shipLine = [s.cruise_line, s.ship].filter(Boolean).map(esc).join(' · ');
    const price = s.rate_from
      ? `<div class="special-price">${esc(money(s.rate_from))} <span class="special-pp">pp</span>${s.brochure_price ? ` <span class="special-was">${esc(money(s.brochure_price))}</span>` : ''}</div>`
      : '';
    return `<article class="special-card">
      <div class="special-body">
        ${shipLine ? `<div class="special-ship">${shipLine}</div>` : ''}
        <h3 class="special-headline">${esc(s.headline)}</h3>
        ${s.sail_dates ? `<div class="special-dates">${esc(s.sail_dates)}</div>` : ''}
        ${price}
      </div>
      <div class="special-foot"><a href="/specials" class="btn btn-primary btn-block">View special</a></div>
    </article>`;
  }).join('');

  section.hidden = false;

  // Carousel: arrows scroll the track one "page" at a time and only appear when
  // the specials actually overflow. On touch devices the row simply swipes.
  const prev = document.getElementById('specials-prev');
  const next = document.getElementById('specials-next');
  if (prev && next) {
    const page = () => Math.max(grid.clientWidth * 0.9, 260);
    const sync = () => {
      const overflow = grid.scrollWidth - grid.clientWidth > 4;
      prev.hidden = !overflow || grid.scrollLeft <= 4;
      next.hidden = !overflow || grid.scrollLeft >= grid.scrollWidth - grid.clientWidth - 4;
    };
    prev.addEventListener('click', () => grid.scrollBy({ left: -page(), behavior: 'smooth' }));
    next.addEventListener('click', () => grid.scrollBy({ left: page(), behavior: 'smooth' }));
    grid.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    // Let layout settle (fonts/images) before measuring overflow.
    setTimeout(sync, 60);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
