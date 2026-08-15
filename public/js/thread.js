// Reusable message thread for an accepted quote. Used on the client's
// My Quotes page and the advisor portal. Relies on api()/escapeHtml() from
// auth-client.js (loaded first).

function msgTime(ms) {
  const d = new Date(Number(ms));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

async function mountThread(container, offerId) {
  if (!container || container.dataset.mounted) return;
  container.dataset.mounted = '1';
  container.insertAdjacentHTML('beforeend',
    `<div class="thread-msgs">Loading…</div>
     <form class="thread-form">
       <textarea rows="2" placeholder="Type a message…" required></textarea>
       <button type="submit" class="btn btn-primary">Send</button>
     </form>`);
  const msgs = container.querySelector('.thread-msgs');
  const form = container.querySelector('.thread-form');

  async function loadMsgs() {
    const { ok, data } = await api(`/api/messages?offer_id=${encodeURIComponent(offerId)}`);
    if (!ok) { msgs.innerHTML = `<div class="no-price">Couldn't load messages.</div>`; return; }
    const list = data.messages || [];
    msgs.innerHTML = list.length
      ? list.map((m) =>
          `<div class="msg ${m.mine ? 'mine' : ''}"><div class="msg-meta">${escapeHtml(m.sender_name || m.sender_role)} · ${msgTime(m.created_at)}</div><div class="msg-body">${escapeHtml(m.body)}</div></div>`
        ).join('')
      : `<div class="no-price">No messages yet. Send the first one below.</div>`;
    msgs.scrollTop = msgs.scrollHeight;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ta = form.querySelector('textarea');
    const body = ta.value.trim();
    if (!body) return;
    const btn = form.querySelector('button');
    btn.disabled = true;
    const { ok } = await api('/api/messages', { method: 'POST', body: { offer_id: offerId, body } });
    btn.disabled = false;
    if (ok) { ta.value = ''; await loadMsgs(); } else { alert('Could not send your message. Please try again.'); }
  });

  await loadMsgs();
}

function mountThreads(scope) {
  (scope || document).querySelectorAll('.thread[data-offer]').forEach((el) =>
    mountThread(el, el.getAttribute('data-offer')));
}

// Threads open on click (so opening marks them read). The toggle button may
// carry an unread badge, cleared once opened.
function wireThreadToggles(scope) {
  const root = scope || document;
  root.querySelectorAll('.thread-toggle').forEach((btn) => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      const offerId = btn.getAttribute('data-offer');
      const panel = root.querySelector(`.thread[data-offer="${offerId}"]`);
      if (!panel) return;
      if (panel.hidden) {
        panel.hidden = false;
        mountThread(panel, offerId);
        const dot = btn.querySelector('.unread-dot');
        if (dot) dot.remove();
        btn.classList.add('is-open');
      } else {
        panel.hidden = true;
      }
    });
  });
}
