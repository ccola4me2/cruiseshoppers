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

  // Seamless infinite carousel: if the specials overflow the strip, duplicate
  // them once so the track is two identical copies, then scroll continuously and
  // wrap by one copy-width the instant we pass it. Because the content past the
  // wrap point is identical, the reset is invisible, so it reads as an endless
  // stream of specials. Arrows step a page; interaction pauses it.
  const prev = document.getElementById('specials-prev');
  const next = document.getElementById('specials-next');
  if (prev && next) {
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const page = () => Math.max(grid.clientWidth * 0.9, 260);

    // Set up the loop once layout has settled (widths are real).
    setTimeout(() => {
      const singleWidth = grid.scrollWidth;          // width of one copy of the set
      if (singleWidth < 40) return;                   // nothing rendered

      // Repeat the set enough times to fill well past the viewport, so it always
      // has content to scroll and loops even with only a few specials. The wrap
      // point stays at one set-width, and every copy is identical, so the reset
      // is invisible.
      const target = Math.max(grid.clientWidth * 2.5, singleWidth + grid.clientWidth + 40);
      const copies = Math.max(2, Math.ceil(target / singleWidth));
      const base = grid.innerHTML;
      let html = '';
      for (let i = 0; i < copies; i++) html += base;
      grid.innerHTML = html;
      prev.hidden = false;
      next.hidden = false;

      let paused = false;
      let resumeTimer;
      let x = 0;                                      // float scroll position
      const pauseFor = (ms) => { paused = true; clearTimeout(resumeTimer); if (ms) resumeTimer = setTimeout(() => { paused = false; }, ms); };

      grid.addEventListener('mouseenter', () => pauseFor(0));
      grid.addEventListener('mouseleave', () => pauseFor(1));
      grid.addEventListener('focusin', () => pauseFor(0));
      grid.addEventListener('focusout', () => pauseFor(1));
      grid.addEventListener('touchstart', () => pauseFor(6000), { passive: true });
      prev.addEventListener('click', () => { grid.scrollBy({ left: -page(), behavior: 'smooth' }); pauseFor(6000); });
      next.addEventListener('click', () => { grid.scrollBy({ left: page(), behavior: 'smooth' }); pauseFor(6000); });

      const SPEED = 0.55;                             // px per frame (~33px/s), gentle
      const wrap = (v) => { while (v >= singleWidth) v -= singleWidth; while (v < 0) v += singleWidth; return v; };
      function frame() {
        if (paused || document.visibilityState !== 'visible') {
          x = grid.scrollLeft;                        // stay in sync while paused/manual
        } else {
          x = wrap(x + SPEED);
          grid.scrollLeft = x;
        }
        requestAnimationFrame(frame);
      }
      if (!reduceMotion) requestAnimationFrame(frame);
    }, 80);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
