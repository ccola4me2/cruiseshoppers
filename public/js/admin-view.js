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

  // In list view, clicking a card's header expands/collapses that card to show
  // its full details. Delegated on the document so it keeps working after a page
  // re-renders its list. Real links/buttons in the header still work normally.
  document.addEventListener('click', function (e) {
    if (!document.body.classList.contains('admin-view-list')) return;
    var head = e.target.closest('.lead-head');
    if (!head) return;
    if (e.target.closest('a, button, input, select, label')) return;
    var lead = head.closest('.lead');
    if (lead) lead.classList.toggle('is-open');
  });

  function mount() {
    // Only list pages (those that render cards into #results) get the toggle.
    var results = document.getElementById('results');
    if (!results) return;
    var heads = document.querySelectorAll('.catalog-top');
    if (!heads.length) return;
    // Use the header nearest the list: the last .catalog-top before #results
    // (a page may have more than one, e.g. the advisor specials page).
    var head = heads[0];
    heads.forEach(function (h) {
      if (results.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_PRECEDING) head = h;
    });
    if (head.querySelector('.admin-view-toggle')) return;

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
