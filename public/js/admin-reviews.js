// Admin: view and moderate advisor reviews (hide/show).

let REVIEWS = [];

async function init() {
  renderAccountNav(document.getElementById('accountNav'));
  await load();
}

async function load() {
  const { ok, data } = await api('/api/admin/reviews');
  const results = document.getElementById('results');
  if (!ok) { results.innerHTML = `<div class="state">Could not load reviews.</div>`; return; }
  REVIEWS = data.reviews || [];
  document.getElementById('count').textContent = `${REVIEWS.length} review${REVIEWS.length === 1 ? '' : 's'}`;
  render();
}

function niceDate(ms) {
  if (!ms) return '';
  return new Date(Number(ms)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function render() {
  const results = document.getElementById('results');
  if (!REVIEWS.length) { results.innerHTML = `<div class="state">No reviews yet.</div>`; return; }
  results.innerHTML = `<div class="lead-list">${REVIEWS.map(card).join('')}</div>`;
  results.querySelectorAll('[data-toggle]').forEach((b) =>
    b.addEventListener('click', () => toggle(b.getAttribute('data-id'), b.getAttribute('data-toggle'))));
}

function card(r) {
  const hidden = r.status === 'hidden';
  return `<article class="lead"${hidden ? ' style="opacity:.6"' : ''}>
    <div class="lead-head">
      <div>
        <h3>${escapeHtml(r.advisor)}</h3>
        <div class="lead-sub">${starsStatic(r.rating)} &middot; by ${escapeHtml(r.client)} &middot; ${escapeHtml(niceDate(r.created_at))}</div>
      </div>
      <span class="status-badge ${hidden ? 'status-declined' : 'status-active'}">${hidden ? 'Hidden' : 'Visible'}</span>
    </div>
    ${r.comment ? `<div class="lead-body"><div class="lead-notes" style="white-space:pre-line">${escapeHtml(r.comment)}</div></div>` : ''}
    <div class="lead-foot">
      <button type="button" class="btn ${hidden ? 'btn-ghost' : 'btn-danger'}" data-toggle="${hidden ? 'visible' : 'hidden'}" data-id="${escapeHtml(r.id)}">${hidden ? 'Show' : 'Hide'}</button>
    </div>
  </article>`;
}

async function toggle(id, status) {
  const { ok } = await api('/api/admin/reviews/status', { method: 'POST', body: { id, status } });
  if (ok) await load();
}

init();
