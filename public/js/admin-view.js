// Shared admin Card / List view toggle. Mounts a small toggle in the page header
// on any admin list page (one with a #results container), remembers the choice,
// and switches the whole page between the card grid and a compact list via a
// body class. The class lives on <body>, so it survives the pages re-rendering
// their #results contents when data loads.
(function () {
  'use strict';
  var KEY = 'cs_admin_view';

  function current() { return document.body.classList.contains('admin-view-list') ? 'list' : 'card'; }
  function apply(v) { document.body.classList.toggle('admin-view-list', v === 'list'); }

  var saved = 'card';
  try { saved = localStorage.getItem(KEY) || 'card'; } catch (e) {}
  apply(saved);

  function mount() {
    // Only list pages (those that render cards into #results) get the toggle.
    if (!document.getElementById('results')) return;
    var head = document.querySelector('.catalog-top');
    if (!head || head.querySelector('.admin-view-toggle')) return;

    var wrap = document.createElement('div');
    wrap.className = 'admin-view-toggle';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'View');
    // HTML entities (ASCII in this source file) so the icons render regardless
    // of how the .js file's charset is served.
    wrap.innerHTML =
      '<button type="button" data-v="card" title="Card view">&#9638; Cards</button>' +
      '<button type="button" data-v="list" title="List view">&#9776; List</button>';

    function sync() {
      var cur = current();
      wrap.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-v') === cur);
      });
    }

    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var v = b.getAttribute('data-v');
      try { localStorage.setItem(KEY, v); } catch (_) {}
      apply(v);
      sync();
    });

    var badge = head.querySelector('.role-badge');
    if (badge) head.insertBefore(wrap, badge);
    else head.appendChild(wrap);
    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
