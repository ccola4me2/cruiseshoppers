// Admin campaigns & sources report: aggregates leads by where they came from,
// so you can track which postings and campaigns are driving quote requests.

const $ = (id) => document.getElementById(id);

async function init() {
  const u = await getMe();
  if (!u) { window.location.href = '/admin/login?next=/admin/campaigns'; return; }
  if (u.role !== 'admin') { window.location.href = '/admin/login?next=/admin/campaigns'; return; }

  $('apply').addEventListener('click', load);
  $('clear').addEventListener('click', () => { $('from').value = ''; $('to').value = ''; load(); });
  await load();
}

function query() {
  const p = new URLSearchParams();
  if ($('from').value) p.set('from', $('from').value);
  if ($('to').value) p.set('to', $('to').value);
  return p.toString();
}

async function load() {
  const qs = query();
  $('csv').href = '/api/admin/attribution-report?format=csv' + (qs ? '&' + qs : '');
  $('count').textContent = 'Loading…';
  const { ok, data } = await api('/api/admin/attribution-report' + (qs ? '?' + qs : ''));
  if (!ok) { $('count').textContent = 'Could not load the report.'; return; }
  render(data);
}

function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }

function render(r) {
  $('count').textContent = `${r.total} lead${r.total === 1 ? '' : 's'} in range`;

  $('stats').innerHTML = [
    ['Total leads', r.total],
    ['Tagged (from a link)', `${r.tagged} · ${pct(r.tagged, r.total)}%`],
    ['Direct / untagged', r.untagged],
    ['Accepted', r.accepted_total],
  ].map(([l, n]) => `<div class="cmp-stat"><div class="n">${escapeHtml(String(n))}</div><div class="l">${escapeHtml(l)}</div></div>`).join('');

  table('byPerson', r.by_person, 'Person');
  table('bySource', r.by_source, 'Source');
  table('byCampaign', r.by_campaign, 'Campaign');
  table('byLink', r.by_link, 'Link (source / medium / campaign / person)');
}

function table(id, rows, label) {
  const box = $(id);
  if (!rows || !rows.length) { box.innerHTML = `<div class="cmp-empty">No data yet.</div>`; return; }
  const total = rows.reduce((s, e) => s + e.leads, 0);
  box.innerHTML = `<table class="cmp-table">
    <thead><tr>
      <th>${escapeHtml(label)}</th>
      <th class="num">Leads</th>
      <th class="num">Share</th>
      <th class="num">Accepted</th>
    </tr></thead>
    <tbody>${rows.map((e) => `<tr>
      <td>${escapeHtml(e.label)}</td>
      <td class="num">${e.leads}</td>
      <td class="num">${pct(e.leads, total)}%</td>
      <td class="num">${e.accepted}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

init();
