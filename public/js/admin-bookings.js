// Admin: all reported bookings with commission detail.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => (n == null || n === '' ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));

async function init() {
  renderAccountNav(document.getElementById('accountNav'));
  const { ok, data } = await api('/api/admin/bookings');
  const results = document.getElementById('results');
  if (!ok) { results.innerHTML = `<div class="state">Could not load bookings.</div>`; return; }
  render(data);
}

function render(d) {
  const b = d.bookings || [];
  const t = d.totals || {};
  document.getElementById('count').textContent = `${b.length} booking${b.length === 1 ? '' : 's'}`;

  const cards = [
    ['Bookings', b.length],
    ['Cruise fare', usd(t.cruise_fare)],
    ['Add-ons', usd((t.addons_high || 0) + (t.addons_low || 0))],
    ['Total booked', usd(t.total)],
  ].map(([l, v]) => `<div class="nb-card"><div class="nb-val">${typeof v === 'number' ? v : esc(v)}</div><div class="nb-lbl">${l}</div></div>`).join('');

  if (!b.length) {
    document.getElementById('results').innerHTML =
      `<div class="nb-cards">${cards}</div><div class="state">No bookings reported yet. They'll appear here as advisors report booked clients.</div>`;
    return;
  }

  const rows = b.map((x) => {
    const who = [x.advisor_name, x.agency].filter(Boolean).join(' · ') || '—';
    const sailing = [x.cruise_line, x.ship || x.sailing].filter(Boolean).join(' · ') || '—';
    const addons = (x.addons_high || 0) + (x.addons_low || 0);
    const fare = x.cruise_fare != null ? `${usd(x.cruise_fare)}${x.fare_type === 'net_rate' ? ' (Net)' : x.fare_type === 'commissionable' ? ' (Comm.)' : ''}` : '—';
    return `<tr>
      <td>${esc(niceDate(x.booked_at))}</td>
      <td>${esc(who)}</td>
      <td><div class="bk-sail">${esc(sailing)}</div><div class="bk-sub">${esc([x.sailing_dates, x.passengers].filter(Boolean).join(' · '))}</div></td>
      <td>${esc(x.booking_ref || '—')}</td>
      <td class="bk-num">${fare}</td>
      <td class="bk-num">${addons ? usd(addons) : '—'}</td>
      <td class="bk-num bk-total">${usd(x.total)}</td>
    </tr>`;
  }).join('');

  document.getElementById('results').innerHTML = `
    <div class="nb-cards">${cards}</div>
    <div class="bk-wrap">
      <table class="bk-table">
        <thead><tr><th>Booked</th><th>Advisor</th><th>Sailing</th><th>Booking ID</th><th class="bk-num">Cruise fare</th><th class="bk-num">Add-ons</th><th class="bk-num">Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function niceDate(ms) {
  if (!ms) return '';
  return new Date(Number(ms)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

init();
