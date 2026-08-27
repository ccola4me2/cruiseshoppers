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

  // Shuffle so the strip shows a fresh mix each visit (no single advisor's
  // specials always leading). Fisher-Yates.
  for (let i = specials.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = specials[i]; specials[i] = specials[j]; specials[j] = t;
  }

  // On the homepage strip we intentionally omit the "Offered by {advisor}" line
  // so a single advisor's specials don't read as the whole marketplace. The
  // advisor is still credited on the full /specials page. Easy to restore later.
  grid.innerHTML = specials.slice(0, 12).map((s) => {
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

  // Carousel: auto-advances one card at a time and loops back to the start;
  // arrows step a page forward/back; hovering, focusing, or touching pauses it.
  const prev = document.getElementById('specials-prev');
  const next = document.getElementById('specials-next');
  if (prev && next) {
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const page = () => Math.max(grid.clientWidth * 0.9, 260);
    const cardStep = () => {
      const first = grid.querySelector('.special-card');
      return first ? first.getBoundingClientRect().width + 18 : 300; // width + gap
    };
    const overflowed = () => grid.scrollWidth - grid.clientWidth > 4;
    const atEnd = () => grid.scrollLeft >= grid.scrollWidth - grid.clientWidth - 8;

    const sync = () => {
      const o = overflowed();
      prev.hidden = !o;
      next.hidden = !o;
    };

    // Pause auto-advance on interaction; resume a few seconds after it stops.
    let paused = false;
    let resumeTimer;
    const pauseFor = (ms) => { paused = true; clearTimeout(resumeTimer); if (ms) resumeTimer = setTimeout(() => { paused = false; }, ms); };
    grid.addEventListener('mouseenter', () => pauseFor(0));
    grid.addEventListener('mouseleave', () => pauseFor(1));
    grid.addEventListener('focusin', () => pauseFor(0));
    grid.addEventListener('focusout', () => pauseFor(1));
    grid.addEventListener('touchstart', () => pauseFor(9000), { passive: true });

    prev.addEventListener('click', () => { grid.scrollBy({ left: -page(), behavior: 'smooth' }); pauseFor(9000); });
    next.addEventListener('click', () => { grid.scrollBy({ left: page(), behavior: 'smooth' }); pauseFor(9000); });
    window.addEventListener('resize', sync);
    setTimeout(sync, 60);

    if (!reduceMotion) {
      setInterval(() => {
        if (paused || document.visibilityState !== 'visible' || !overflowed()) return;
        if (atEnd()) grid.scrollTo({ left: 0, behavior: 'smooth' });
        else grid.scrollBy({ left: cardStep(), behavior: 'smooth' });
      }, 3800);
    }
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
