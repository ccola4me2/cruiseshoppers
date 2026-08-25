// Admin: every quote a client has accepted, with dollar amounts + CSV export.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => (n == null || n === '' ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));

async function init() {
  renderAccountNav(document.getElementById('accountNav'));
  const { ok, data } = await api('/api/admin/accepted-quotes');
  const results = document.getElementById('results');
  if (!ok) { results.innerHTML = `<div class="state">Could not load accepted quotes.</div>`; return; }
  render(data);
}

function render(d) {
  const q = d.quotes || [];
  const t = d.totals || {};
  document.getElementById('count').textContent = `${q.length} accepted quote${q.length === 1 ? '' : 's'}`;

  const cards = [
    ['Accepted quotes', q.length],
    ['Quoted total', usd(t.quoted_total)],
    ['Booked total', usd(t.booked_total)],
  ].map(([l, v]) => `<div class="nb-card"><div class="nb-val">${typeof v === 'number' ? v : esc(v)}</div><div class="nb-lbl">${l}</div></div>`).join('');

  const dl = `<a href="/api/admin/accepted-quotes?format=csv" class="btn btn-navy btn-sm">⬇ Download CSV</a>`;

  if (!q.length) {
    document.getElementById('results').innerHTML =
      `<div class="nb-cards">${cards}</div><div class="state">No accepted quotes yet. They'll appear here once clients accept advisor quotes.</div>`;
    return;
  }

  const rows = q.map((x) => {
    const who = [x.advisor_name, x.agency].filter(Boolean).join(' · ') || '—';
    const sailing = [x.cruise_line, x.ship || x.sailing].filter(Boolean).join(' · ') || '—';
    const booked = x.booking_status === 'booked';
    return `<tr>
      <td>${esc(niceDate(x.accepted_at))}</td>
      <td>${esc(who)}</td>
      <td>${esc(x.client || '—')}</td>
      <td><div class="bk-sail">${esc(sailing)}</div><div class="bk-sub">${esc(x.sailing_dates || '')}</div></td>
      <td class="bk-num">${usd(x.quoted_total)}</td>
      <td>${booked ? '<span class="status-badge status-active">Booked</span>' : '<span class="status-badge">Accepted</span>'}</td>
      <td class="bk-num bk-total">${x.booked_total != null ? usd(x.booked_total) : '—'}</td>
    </tr>`;
  }).join('');

  document.getElementById('results').innerHTML = `
    <div class="nb-cards">${cards}</div>
    <div style="margin:12px 0;display:flex;justify-content:flex-end;">${dl}</div>
    <div class="bk-wrap">
      <table class="bk-table">
        <thead><tr><th>Accepted</th><th>Advisor</th><th>Client</th><th>Sailing</th><th class="bk-num">Quoted</th><th>Status</th><th class="bk-num">Booked</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function niceDate(ms) {
  if (!ms) return '';
  return new Date(Number(ms)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

init();
