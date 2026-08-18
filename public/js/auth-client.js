// Shared auth helpers used across pages.

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch (_) {}
  return { ok: res.ok, status: res.status, data };
}

async function getMe() {
  const { data } = await api('/api/auth/me');
  return data.user || null;
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
}

function showAlert(el, type, msg) {
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideAlert(el) {
  if (el) el.classList.add('hidden');
}

// Redirect signed-in users away from auth pages; the target honors ?next=.
async function redirectIfAuthed() {
  const user = await getMe();
  if (user) {
    const next = new URLSearchParams(location.search).get('next');
    window.location.href = next && next.startsWith('/') ? next : '/app';
  }
}

// Populate a header's account area based on auth state.
async function renderAccountNav(navEl) {
  if (!navEl) return;
  const user = await getMe();
  if (user) {
    navEl.innerHTML =
      `<a href="/app">Browse Sailings</a>` +
      `<a href="/specials">Specials</a>` +
      `<a href="/my-quotes">My quotes</a>` +
      `<a href="/profile">My profile</a>` +
      `<span class="hide-sm" style="color:var(--muted);font-size:.92rem;">Hi, ${escapeHtml(user.first_name || 'traveler')}</span>` +
      `<a href="#" id="logoutLink" class="btn btn-ghost" style="padding:8px 16px;">Sign out</a>`;
    const link = navEl.querySelector('#logoutLink');
    if (link) link.addEventListener('click', (e) => { e.preventDefault(); logout(); });
  } else {
    navEl.innerHTML =
      `<a href="/login" class="hide-sm">Log in</a>` +
      `<a href="/signup" class="btn btn-primary" style="padding:9px 18px;">Sign up free</a>`;
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// Shared US state list + helpers (used by client & advisor forms).
const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
  'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois',
  'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts',
  'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota',
  'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
  'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
  'West Virginia', 'Wisconsin', 'Wyoming', 'Puerto Rico', 'U.S. Virgin Islands',
  'Guam', 'Other / Outside the U.S.',
];

function stateOptions(selected) {
  return US_STATES
    .map((s) => `<option value="${escapeHtml(s)}"${s === selected ? ' selected' : ''}>${escapeHtml(s)}</option>`)
    .join('');
}

// Best-effort split of a stored "City, State" string into its parts.
function splitLocation(loc) {
  loc = String(loc == null ? '' : loc).trim();
  if (!loc) return { city: '', state: '' };
  const i = loc.lastIndexOf(',');
  if (i >= 0) {
    const maybeState = loc.slice(i + 1).trim();
    if (US_STATES.includes(maybeState)) return { city: loc.slice(0, i).trim(), state: maybeState };
  }
  if (US_STATES.includes(loc)) return { city: '', state: loc };
  return { city: loc, state: '' };
}
