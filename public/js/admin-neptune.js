// Admin: Neptune (AI concierge) usage dashboard.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (n, tot) => (tot ? Math.round((n / tot) * 100) : 0);

async function init() {
  renderAccountNav(document.getElementById('accountNav'));
  const { ok, data } = await api('/api/admin/concierge-stats');
  const results = document.getElementById('results');
  if (!ok) {
    results.innerHTML = `<div class="state">Could not load usage. If this persists, apply migration 0020 (concierge_log) in the D1 Console.</div>`;
    return;
  }
  render(data);
}

function render(d) {
  document.getElementById('count').textContent = `${d.week || 0} search${d.week === 1 ? '' : 'es'} in the last 7 days`;
  const freeWeek = (d.cachedWeek || 0) + (d.skippedWeek || 0);

  const cards = [
    ['Today', d.today], ['Last 7 days', d.week], ['All time', d.total],
    ['AI calls (7d)', d.aiCallsWeek], ['Cache hits (7d)', d.cachedWeek], ['AI skipped (7d)', d.skippedWeek],
  ].map(([l, v]) => `<div class="nb-card"><div class="nb-val">${v || 0}</div><div class="nb-lbl">${l}</div></div>`).join('');

  const maxC = Math.max(1, ...(d.daily || []).map((x) => x.c));
  const bars = (d.daily || []).length
    ? (d.daily || []).map((x) => `<div class="nb-bar"><div class="nb-bar-fill" style="height:${Math.round((x.c / maxC) * 100)}%"></div><div class="nb-bar-c">${x.c}</div><div class="nb-bar-d">${esc(x.d.slice(5))}</div></div>`).join('')
    : '<div class="muted">No searches yet.</div>';

  const top = (d.topQueries || []).length
    ? (d.topQueries || []).map((x) => `<tr><td>${esc(x.q)}</td><td style="text-align:right">${x.c}</td></tr>`).join('')
    : '<tr><td class="muted" colspan="2">No queries yet.</td></tr>';

  document.getElementById('results').innerHTML = `
    <div class="nb-cards">${cards}</div>
    <div class="nb-row">
      <div class="nb-panel">
        <h3>Cost mix (last 7 days)</h3>
        <p class="muted" style="margin-top:0">${pct(freeWeek, d.week)}% of searches avoided a model call (cache hits + trivial).</p>
        <div class="nb-meter">
          <span class="seg seg-ai" style="width:${pct(d.aiCallsWeek, d.week)}%"></span>
          <span class="seg seg-cache" style="width:${pct(d.cachedWeek, d.week)}%"></span>
          <span class="seg seg-skip" style="width:${pct(d.skippedWeek, d.week)}%"></span>
        </div>
        <div class="nb-legend"><span><i class="seg-ai"></i> AI calls ${d.aiCallsWeek || 0}</span><span><i class="seg-cache"></i> Cache ${d.cachedWeek || 0}</span><span><i class="seg-skip"></i> Skipped ${d.skippedWeek || 0}</span></div>
        <p class="muted" style="margin-bottom:0">CruiseFeed results returned (7d): <strong>${d.resultsWeek || 0}</strong></p>
      </div>
      <div class="nb-panel">
        <h3>Searches per day</h3>
        <div class="nb-chart">${bars}</div>
      </div>
    </div>
    <div class="nb-panel">
      <h3>Top searches (last 7 days)</h3>
      <table class="nb-table"><thead><tr><th>Query</th><th style="text-align:right">Count</th></tr></thead><tbody>${top}</tbody></table>
    </div>`;
}

init();
