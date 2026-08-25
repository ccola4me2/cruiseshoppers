// Admin: every quote a client has accepted, with dollar amounts, the 2.5%
// platform fee (on booked commissionable fares only), a per-advisor summary,
// date-range + booked-only filters, and CSV export.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => (n == null || n === '' ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
const $ = (id) => document.getElementById(id);

// Build the current filter query string (shared by the fetch and the CSV links).
function query(extra) {
  const p = new URLSearchParams();
  const from = $('r-from').value; if (from) p.set('from', from);
  const to = $('r-to').value; if (to) p.set('to', to);
  if ($('r-booked').checked) p.set('booked', '1');
  if (extra) for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

async function load() {
  const results = $('results');
  results.innerHTML = `<div class="state"><div class="spinner"></div>Loading accepted quotes…</div>`;
  const { ok, data } = await api('/api/admin/accepted-quotes?' + query());
  if (!ok) { results.innerHTML = `<div class="state">Could not load accepted quotes.</div>`; return; }
  render(data);
}

function render(d) {
  const q = d.quotes || [];
  const t = d.totals || {};
  const advisors = d.advisors || [];
  const ratePct = ((t.rate || 0.025) * 100).toFixed(1).replace(/\.0$/, '');
  $('count').textContent = `${q.length} accepted quote${q.length === 1 ? '' : 's'}`;

  const cards = [
    ['Accepted quotes', q.length],
    ['Quoted total', usd(t.quoted_total)],
    ['Booked total', usd(t.booked_total)],
    ['Commissionable fares', usd(t.commissionable_fare)],
    [`Platform fee (${ratePct}%)`, usd(t.platform_fee)],
  ].map(([l, v]) => `<div class="nb-card"><div class="nb-val">${typeof v === 'number' ? v : esc(v)}</div><div class="nb-lbl">${esc(l)}</div></div>`).join('');

  const dl = `
    <a href="/api/admin/accepted-quotes?${esc(query({ format: 'csv' }))}" class="btn btn-navy btn-sm">⬇ Download CSV</a>
    <a href="/api/admin/accepted-quotes?${esc(query({ format: 'csv', group: 'advisor' }))}" class="btn btn-ghost btn-sm">⬇ Advisor commission CSV</a>`;

  if (!q.length) {
    $('results').innerHTML = `<div class="nb-cards">${cards}</div><div class="state">No accepted quotes match these filters.</div>`;
    return;
  }

  // Per-advisor commission summary.
  const advRows = advisors.map((a) => `<tr>
    <td>${esc([a.advisor_name, a.agency].filter(Boolean).join(' · ') || a.advisor_email || '—')}</td>
    <td class="bk-num">${a.count}</td>
    <td class="bk-num">${usd(a.booked_total)}</td>
    <td class="bk-num">${usd(a.commissionable_fare)}</td>
    <td class="bk-num bk-total">${usd(a.platform_fee)}</td>
  </tr>`).join('');

  const rows = q.map((x) => {
    const who = [x.advisor_name, x.agency].filter(Boolean).join(' · ') || '—';
    const sailing = [x.cruise_line, x.ship || x.sailing].filter(Boolean).join(' · ') || '—';
    const booked = x.booking_status === 'booked';
    const fare = x.fare_type === 'commissionable' ? 'Commissionable' : x.fare_type === 'net_rate' ? 'Net rate' : (x.fare_type || '—');
    return `<tr>
      <td>${esc(niceDate(x.accepted_at))}</td>
      <td>${esc(who)}</td>
      <td>${esc(x.client || '—')}</td>
      <td><div class="bk-sail">${esc(sailing)}</div><div class="bk-sub">${esc(x.sailing_dates || '')}</div></td>
      <td class="bk-num">${usd(x.quoted_total)}</td>
      <td>${booked ? '<span class="status-badge status-active">Booked</span>' : '<span class="status-badge">Accepted</span>'}</td>
      <td class="bk-num">${x.booked_total != null ? usd(x.booked_total) : '—'}</td>
      <td>${esc(fare)}</td>
      <td class="bk-num bk-total">${x.platform_fee ? usd(x.platform_fee) : '—'}</td>
    </tr>`;
  }).join('');

  $('results').innerHTML = `
    <div class="nb-cards">${cards}</div>
    <div style="margin:12px 0;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">${dl}</div>
    ${advisors.length > 1 ? `
    <h2 class="form-section">By advisor</h2>
    <div class="bk-wrap"><table class="bk-table">
      <thead><tr><th>Advisor</th><th class="bk-num">Accepted</th><th class="bk-num">Booked total</th><th class="bk-num">Commissionable</th><th class="bk-num">Platform fee</th></tr></thead>
      <tbody>${advRows}</tbody>
    </table></div>` : ''}
    <h2 class="form-section">All accepted quotes</h2>
    <div class="bk-wrap"><table class="bk-table">
      <thead><tr><th>Accepted</th><th>Advisor</th><th>Client</th><th>Sailing &amp; sail dates</th><th class="bk-num">Quoted</th><th>Status</th><th class="bk-num">Booked</th><th>Fare type</th><th class="bk-num">Fee (${ratePct}%)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function niceDate(ms) {
  if (!ms) return '';
  return new Date(Number(ms)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function initFilters() {
  $('r-apply').addEventListener('click', load);
  $('r-clear').addEventListener('click', () => { $('r-from').value = ''; $('r-to').value = ''; $('r-booked').checked = false; load(); });
  $('r-booked').addEventListener('change', load);
  ['r-from', 'r-to'].forEach((id) => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); }));
}

async function init() {
  renderAccountNav(document.getElementById('accountNav'));
  initFilters();
  await load();
}

init();
