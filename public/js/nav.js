// Shared header behavior: mobile hamburger menu + a keyboard skip-link.
// Progressive enhancement — if this doesn't run, the nav still renders inline.
(function () {
  'use strict';

  // --- Skip to content link (accessibility) ---
  try {
    var main = document.querySelector('main')
      || document.querySelector('.hero')
      || document.querySelector('header + section, header ~ section');
    if (main) {
      if (!main.id) main.id = 'main-content';
      main.setAttribute('tabindex', '-1');
      var skip = document.createElement('a');
      skip.className = 'skip-link';
      skip.href = '#' + main.id;
      skip.textContent = 'Skip to content';
      document.body.insertBefore(skip, document.body.firstChild);
    }
  } catch (e) { /* no-op */ }

  // --- Mobile hamburger toggle ---
  var header = document.querySelector('.site-header');
  if (!header) return;
  var bar = header.querySelector('.bar');
  var nav = header.querySelector('.nav');
  if (!bar || !nav) return;
  if (!nav.id) nav.id = 'site-nav';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-toggle';
  btn.setAttribute('aria-label', 'Open menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', nav.id);
  btn.innerHTML = '<span class="nav-toggle-bars" aria-hidden="true"></span>';
  bar.appendChild(btn);

  function setOpen(open) {
    header.classList.toggle('nav-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }

  btn.addEventListener('click', function () {
    setOpen(!header.classList.contains('nav-open'));
  });
  // Close after choosing a destination.
  nav.addEventListener('click', function (e) {
    if (e.target.closest('a')) setOpen(false);
  });
  // Close on Escape.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setOpen(false);
  });
  // Reset when returning to desktop width.
  window.addEventListener('resize', function () {
    if (window.innerWidth > 700) setOpen(false);
  });
})();
