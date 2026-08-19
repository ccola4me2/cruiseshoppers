// Transactional email via Resend (https://resend.com).
// Set RESEND_API_KEY as a Worker secret and MAIL_FROM in [vars].
// If no key is configured, sending is skipped gracefully (documented in README);
// the reset flow still returns a generic success to avoid leaking account state.

export async function sendResetEmail(env, { to, resetUrl }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || 'Cruise Shoppers <noreply@cruiseshoppers.com>';

  if (!apiKey) {
    // Not configured: caller still returns a generic success message.
    return { sent: false, reason: 'not_configured' };
  }

  const html = resetEmailHtml(resetUrl);
  const text = `Reset your Cruise Shoppers password:\n\n${resetUrl}\n\nThis link expires soon. If you did not request it, you can ignore this email.`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Reset your Cruise Shoppers password',
      html,
      text,
    }),
  });

  if (!res.ok) {
    return { sent: false, reason: 'send_failed', status: res.status };
  }
  return { sent: true };
}

// Notify the other party of a new message on an accepted quote.
export async function sendNewMessage(env, { to, toName, fromName, sailing, preview, url }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || 'Cruise Shoppers <noreply@cruiseshoppers.com>';
  if (!apiKey || !to) return { sent: false, reason: 'not_configured' };
  const hi = toName ? ` ${toName}` : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f2438;">
  <div style="max-width:540px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border-radius:14px;padding:32px;border:1px solid #e2e8f2;">
      <div style="font-size:20px;font-weight:700;color:#0b3a66;">Cruise Shoppers</div>
      <h1 style="font-size:20px;margin:22px 0 8px;">New message${fromName ? ` from ${esc(fromName)}` : ''}</h1>
      <p style="font-size:14px;color:#40536b;margin:0 0 12px;">Hi${esc(hi)}, you have a new message${sailing ? ` about ${esc(sailing)}` : ''}.</p>
      ${preview ? `<blockquote style="margin:0 0 16px;padding:10px 14px;background:#f8fafd;border-left:3px solid #0b7285;color:#0f2438;font-size:14px;">${esc(preview)}</blockquote>` : ''}
      <p style="margin:22px 0 0;"><a href="${esc(url)}" style="background:#0b7285;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;display:inline-block;">View & reply</a></p>
    </div>
  </div></body></html>`;
  const text = `New message${fromName ? ` from ${fromName}` : ''}${sailing ? ` about ${sailing}` : ''}.\n\n${preview || ''}\n\nView & reply: ${url}`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: 'New message about your cruise quote', html, text }),
  });
  if (!res.ok) return { sent: false, reason: 'send_failed', status: res.status };
  return { sent: true };
}

// Notify an advisor that a client declined their quote or asked for a requote.
export async function sendQuoteResponse(env, { to, advisorName, clientName, sailing, action }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || 'Cruise Shoppers <noreply@cruiseshoppers.com>';
  if (!apiKey || !to) return { sent: false, reason: 'not_configured' };
  const isRequote = action === 'requote';
  const subject = isRequote ? 'A client requested a new quote' : 'A client declined your quote';
  const heading = isRequote ? 'Requote requested' : 'Quote declined';
  const hi = advisorName ? ` ${advisorName}` : '';
  const line = isRequote
    ? `${clientName || 'A client'} would like a revised quote${sailing ? ` for ${sailing}` : ''}. Open the request and submit an updated price.`
    : `${clientName || 'A client'} declined your quote${sailing ? ` for ${sailing}` : ''}. Other requests are waiting in your portal.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f2438;">
  <div style="max-width:540px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border-radius:14px;padding:32px;border:1px solid #e2e8f2;">
      <div style="font-size:20px;font-weight:700;color:#0b3a66;">Cruise Shoppers</div>
      <h1 style="font-size:20px;margin:22px 0 8px;">${esc(heading)}</h1>
      <p style="font-size:15px;line-height:1.6;color:#40536b;margin:0;">Hi${esc(hi)}, ${esc(line)}</p>
    </div>
  </div></body></html>`;
  const text = `${heading}. ${line}`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });
  if (!res.ok) return { sent: false, reason: 'send_failed', status: res.status };
  return { sent: true };
}

// Notify all approved advisors that a new client request is available to quote.
export async function sendAdvisorNewRequest(env, { advisors, rows = [], notes, clientName, quoteUrl }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || 'Cruise Shoppers <noreply@cruiseshoppers.com>';
  const list = [...new Set((advisors || []).filter(Boolean))];
  if (!apiKey || !list.length) return { sent: false, reason: 'not_configured' };

  const clean = rows.filter(([, v]) => v != null && String(v).trim() !== '');
  const html = noticeHtml({
    eyebrow: 'New quote request',
    title: 'A client is requesting a quote',
    intro: 'Review the details below and open it to submit your best price.',
    rows: clean,
    notes,
    ctaUrl: quoteUrl,
    ctaText: 'Give a price',
  });
  const text = [
    'New cruise quote request.',
    '',
    ...clean.map(([k, v]) => `${k}: ${v}`),
    notes ? `\nRequest details:\n${notes}` : '',
    `\nGive a price: ${quoteUrl}`,
  ].join('\n');

  // Send each advisor their own copy (To their address) rather than using a
  // placeholder To + BCC. The placeholder noreply@ address has no mailbox on
  // Microsoft 365 and would bounce. This also keeps advisor emails private.
  let sent = 0;
  await Promise.all(list.map(async (addr) => {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [addr], subject: 'New cruise quote request', html, text }),
      });
      if (res.ok) sent += 1;
    } catch (_) {}
  }));
  return { sent: sent > 0, recipients: sent };
}

// Alert a client that a new special matches one of their saved searches.
export async function sendSavedSearchAlert(env, { to, firstName, headline, cruiseLine, ship, rateFrom, searchName, specialsUrl }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || 'Cruise Shoppers <noreply@cruiseshoppers.com>';
  if (!apiKey || !to) return { sent: false, reason: 'not_configured' };
  const hi = firstName ? ` ${firstName}` : '';
  const shipLine = [cruiseLine, ship].filter(Boolean).join(' · ');
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f2438;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border-radius:14px;border:1px solid #e2e8f2;overflow:hidden;">
      <div style="background:#0b3a66;padding:20px 32px;">
        <div style="font-size:20px;font-weight:700;color:#ffffff;">Cruise Shoppers</div>
        <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#9fc0e0;margin-top:2px;">New deal alert</div>
      </div>
      <div style="padding:26px 32px;">
        <p style="font-size:15px;line-height:1.6;color:#40536b;margin:0 0 14px;">Hi${esc(hi)}, a new special just matched your saved search${searchName ? ` &ldquo;${esc(searchName)}&rdquo;` : ''}.</p>
        ${shipLine ? `<div style="font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:#0b7285;font-weight:700;margin-bottom:4px;">${esc(shipLine)}</div>` : ''}
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:17px;color:#0b3a66;line-height:1.35;margin:0 0 8px;">${esc(headline)}</div>
        ${rateFrom ? `<div style="font-size:20px;font-weight:800;color:#0b3a66;margin:6px 0 0;">${esc(rateFrom)} <span style="font-size:0.7em;font-weight:600;color:#7386a0;">pp</span></div>` : ''}
        <p style="margin:22px 0 0;"><a href="${esc(specialsUrl)}" style="background:#0b7285;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:600;display:inline-block;">View this special</a></p>
        <p style="font-size:12px;color:#9aa8bd;line-height:1.6;margin-top:20px;">You're getting this because you turned on alerts for a saved search. You can remove it from Browse Sailings anytime.</p>
      </div>
    </div>
  </div></body></html>`;
  const text = `Hi${hi}, a new special matched your saved search${searchName ? ` "${searchName}"` : ''}.\n\n${[shipLine, headline, rateFrom ? rateFrom + ' pp' : ''].filter(Boolean).join('\n')}\n\nView: ${specialsUrl}`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: 'A new cruise special matches your saved search', html, text }),
  });
  if (!res.ok) return { sent: false, reason: 'send_failed', status: res.status };
  return { sent: true };
}

// Invite a new advisor seat added under an agency, with temp credentials.
export async function sendSeatInvite(env, { to, firstName, agencyName, tempPassword, loginUrl }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || 'Cruise Shoppers <noreply@cruiseshoppers.com>';
  if (!apiKey || !to) return { sent: false, reason: 'not_configured' };
  const hi = firstName ? ` ${firstName}` : '';
  const agency = agencyName ? esc(agencyName) : 'your agency';
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f2438;">
  <div style="max-width:540px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border-radius:14px;padding:32px;border:1px solid #e2e8f2;">
      <div style="font-size:20px;font-weight:700;color:#0b3a66;">Cruise Shoppers</div>
      <h1 style="font-size:20px;margin:22px 0 8px;">You've been added as an advisor</h1>
      <p style="font-size:15px;line-height:1.6;color:#40536b;margin:0 0 14px;">Hi${esc(hi)}, ${agency} added you as a travel advisor on Cruise Shoppers. Sign in with the temporary password below, then change it right away.</p>
      <table style="border-collapse:collapse;width:100%;">
        <tr><td style="padding:6px 12px 6px 0;color:#7386a0;font-size:13px;">Email</td><td style="padding:6px 0;color:#0f2438;font-size:14px;">${esc(to)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#7386a0;font-size:13px;">Temporary password</td><td style="padding:6px 0;color:#0f2438;font-size:14px;font-family:monospace;">${esc(tempPassword)}</td></tr>
      </table>
      <p style="margin:26px 0 0;"><a href="${esc(loginUrl)}" style="background:#0b7285;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;display:inline-block;">Sign in to your advisor portal</a></p>
      <p style="font-size:13px;color:#7386a0;margin-top:16px;">For security, change your password after your first sign-in using "Forgot your password?" on the login page. Then complete your profile so it appears on your quotes.</p>
    </div>
  </div></body></html>`;
  const text = `Hi${hi}, ${agencyName || 'your agency'} added you as a travel advisor on Cruise Shoppers.\n\nEmail: ${to}\nTemporary password: ${tempPassword}\n\nSign in: ${loginUrl}\nPlease change your password after signing in.`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: "You've been added as a Cruise Shoppers advisor", html, text }),
  });
  if (!res.ok) return { sent: false, reason: 'send_failed', status: res.status };
  return { sent: true };
}

// Notify a newly created admin with their temporary login credentials.
export async function sendAdminInvite(env, { to, firstName, tempPassword, loginUrl }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || 'Cruise Shoppers <noreply@cruiseshoppers.com>';
  if (!apiKey || !to) return { sent: false, reason: 'not_configured' };
  const hi = firstName ? ` ${firstName}` : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f2438;">
  <div style="max-width:540px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border-radius:14px;padding:32px;border:1px solid #e2e8f2;">
      <div style="font-size:20px;font-weight:700;color:#0b3a66;">Cruise Shoppers</div>
      <h1 style="font-size:20px;margin:22px 0 8px;">You've been added as an admin</h1>
      <p style="font-size:15px;line-height:1.6;color:#40536b;margin:0 0 14px;">Hi${esc(hi)}, an administrator created a Cruise Shoppers admin account for you. Sign in with the temporary password below, then change it right away.</p>
      <table style="border-collapse:collapse;width:100%;">
        <tr><td style="padding:6px 12px 6px 0;color:#7386a0;font-size:13px;">Email</td><td style="padding:6px 0;color:#0f2438;font-size:14px;">${esc(to)}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#7386a0;font-size:13px;">Temporary password</td><td style="padding:6px 0;color:#0f2438;font-size:14px;font-family:monospace;">${esc(tempPassword)}</td></tr>
      </table>
      <p style="margin:26px 0 0;"><a href="${esc(loginUrl)}" style="background:#0b3a66;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;display:inline-block;">Sign in to admin</a></p>
      <p style="font-size:13px;color:#7386a0;margin-top:16px;">For security, change your password after your first sign-in using "Forgot your password?" on the login page.</p>
    </div>
  </div></body></html>`;
  const text = `You've been added as a Cruise Shoppers admin.\n\nEmail: ${to}\nTemporary password: ${tempPassword}\n\nSign in: ${loginUrl}\nPlease change your password after signing in.`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: "You're now a Cruise Shoppers admin", html, text }),
  });
  if (!res.ok) return { sent: false, reason: 'send_failed', status: res.status };
  return { sent: true };
}

// Notify an advisor that a client accepted their quote.
export async function sendQuoteAccepted(env, { to, advisorName, clientName, clientEmail, sailing, price }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || 'Cruise Shoppers <noreply@cruiseshoppers.com>';
  if (!apiKey || !to) return { sent: false, reason: 'not_configured' };

  const hi = advisorName ? ` ${advisorName}` : '';
  const rows = [
    ['Client', clientName],
    ['Client email', clientEmail],
    ['Sailing', sailing],
    ['Your price', price],
  ].filter(([, v]) => v);
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f2438;">
  <div style="max-width:540px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border-radius:14px;padding:32px;border:1px solid #e2e8f2;">
      <div style="font-size:20px;font-weight:700;color:#0b3a66;">Cruise Shoppers</div>
      <h1 style="font-size:20px;margin:22px 0 8px;">Your quote was accepted!</h1>
      <p style="font-size:15px;line-height:1.6;color:#40536b;margin:0 0 14px;">Great news${esc(hi)}! The client accepted your quote. Reach out to finalize the booking.</p>
      <table style="border-collapse:collapse;width:100%;">${rows.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#7386a0;font-size:13px;white-space:nowrap;">${esc(k)}</td><td style="padding:6px 0;color:#0f2438;font-size:14px;">${esc(v)}</td></tr>`).join('')}</table>
    </div>
  </div></body></html>`;
  const text = `Your quote was accepted${hi}.\n\n` + rows.map(([k, v]) => `${k}: ${v}`).join('\n');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: 'Your Cruise Shoppers quote was accepted', html, text }),
  });
  if (!res.ok) return { sent: false, reason: 'send_failed', status: res.status };
  return { sent: true };
}

// Notify a client that a travel advisor submitted a quote on their request.
export async function sendQuoteToClient(env, {
  to, clientName, advisorName, agency, location, advisorEmail, advisorPhone, advisorHours, advisorBio,
  advisorRating, advisorReviewCount, sailing, price, specials, additionalInfo, quotesUrl,
}) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || 'Cruise Shoppers <noreply@cruiseshoppers.com>';
  if (!apiKey || !to) return { sent: false, reason: 'not_configured' };

  const hi = clientName ? ` ${clientName}` : '';
  const html = quoteToClientHtml({
    hi, advisorName, agency, location, advisorEmail, advisorPhone, advisorHours, advisorBio,
    advisorRating, advisorReviewCount, sailing, price, specials, additionalInfo, quotesUrl,
  });

  const lines = [];
  if (sailing) lines.push(`Sailing: ${sailing}`);
  if (price) lines.push(`Price: ${money(price)}`);
  lines.push('Prices include all port charges, taxes, and fees. No hidden agency booking fees.');
  if (specials) lines.push(`\nSpecial offer: ${specials}`);
  if (additionalInfo) lines.push(`\nAdditional information: ${additionalInfo}`);
  const agentLine = [advisorName, agency].filter(Boolean).join(', ');
  if (agentLine) lines.push(`\nYour advisor: ${agentLine}${location ? ` (${location})` : ''}`);
  const contact = [advisorEmail, advisorPhone].filter(Boolean).join(' | ');
  if (contact) lines.push(`Contact: ${contact}`);
  if (advisorHours) lines.push(`Available: ${advisorHours}`);
  lines.push('\nQuoted prices can change without notice. Contact your advisor to lock in your rate. No obligation.');
  if (quotesUrl) lines.push(`\nView your quotes: ${quotesUrl}`);
  const text = `Good news${hi}! A travel advisor has prepared a personalized quote for your cruise request.\n\n${lines.join('\n')}`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: 'Your Cruise Shoppers cruise quote is ready', html, text }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch {}
    return { sent: false, reason: 'send_failed', status: res.status, detail };
  }
  return { sent: true };
}

function quoteToClientHtml({
  hi, advisorName, agency, location, advisorEmail, advisorPhone, advisorHours, advisorBio,
  advisorRating, advisorReviewCount, sailing, price, specials, additionalInfo, quotesUrl,
}) {
  const ratingText = (advisorRating && advisorReviewCount)
    ? `${'★'.repeat(Math.round(advisorRating))}${'☆'.repeat(5 - Math.round(advisorRating))} ${Number(advisorRating).toFixed(1)} (${advisorReviewCount})`
    : '';
  const metaRow = (k, v) =>
    `<tr><td style="padding:5px 14px 5px 0;color:#7386a0;font-size:13px;vertical-align:top;white-space:nowrap;">${esc(k)}</td><td style="padding:5px 0;color:#0f2438;font-size:14px;">${v}</td></tr>`;

  const contactBits = [];
  if (advisorEmail) contactBits.push(`<a href="mailto:${esc(advisorEmail)}" style="color:#0b7285;text-decoration:none;">${esc(advisorEmail)}</a>`);
  if (advisorPhone) contactBits.push(`<a href="tel:${esc(String(advisorPhone).replace(/[^0-9+]/g, ''))}" style="color:#0b7285;text-decoration:none;">${esc(advisorPhone)}</a>`);

  const agentRows = [
    advisorName ? metaRow('Advisor', esc(advisorName)) : '',
    ratingText ? metaRow('Rating', `<span style="color:#d9a441;">${esc(ratingText)}</span>`) : '',
    agency ? metaRow('Agency', esc(agency) + (location ? ` <span style="color:#7386a0;">&middot; ${esc(location)}</span>` : '')) : '',
    contactBits.length ? metaRow('Contact', contactBits.join(' &nbsp;&middot;&nbsp; ')) : '',
    advisorHours ? metaRow('Available', esc(advisorHours)) : '',
  ].filter(Boolean).join('');

  return `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f2438;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border-radius:14px;border:1px solid #e2e8f2;overflow:hidden;">
      <div style="background:#0b3a66;padding:22px 32px;">
        <div style="font-size:20px;font-weight:700;color:#ffffff;">Cruise Shoppers</div>
        <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#9fc0e0;margin-top:2px;">Your cruise quote</div>
      </div>
      <div style="padding:28px 32px;">
        <p style="font-size:15px;line-height:1.6;color:#40536b;margin:0 0 18px;">
          Good news${esc(hi)}! A cruise specialist has prepared a personalized quote for your request.
        </p>

        ${sailing ? `<div style="font-family:Georgia,'Times New Roman',serif;font-size:16px;color:#0b3a66;line-height:1.4;margin:0 0 16px;">${esc(sailing)}</div>` : ''}

        <div style="background:#f8fafd;border:1px solid #e2e8f2;border-radius:10px;padding:16px 18px;margin:0 0 18px;">
          <div style="font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:#7386a0;font-weight:700;margin-bottom:4px;">Your price</div>
          <div style="font-size:22px;font-weight:800;color:#0b3a66;">${price ? esc(money(price)) : 'See details'}</div>
          <div style="font-size:12px;color:#7386a0;margin-top:6px;">Prices include all port charges, taxes, and fees. No hidden agency booking fees.</div>
        </div>

        ${specials ? `<div style="border-left:4px solid #d9a441;background:#fffaf0;padding:12px 16px;border-radius:0 8px 8px 0;margin:0 0 16px;">
          <div style="font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:#a9791f;font-weight:700;margin-bottom:4px;">Special offer</div>
          <div style="font-size:14px;color:#0f2438;line-height:1.55;white-space:pre-line;">${esc(specials)}</div>
        </div>` : ''}

        ${additionalInfo ? `<div style="margin:0 0 18px;">
          <div style="font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:#7386a0;font-weight:700;margin-bottom:4px;">Additional information</div>
          <div style="font-size:14px;color:#0f2438;line-height:1.55;white-space:pre-line;">${esc(additionalInfo)}</div>
        </div>` : ''}

        ${agentRows ? `<div style="border-top:1px solid #eef2f8;padding-top:16px;margin-top:4px;">
          <div style="font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:#7386a0;font-weight:700;margin-bottom:8px;">Contact your advisor</div>
          <table style="border-collapse:collapse;width:100%;">${agentRows}</table>
          ${advisorBio ? `<div style="font-size:13px;color:#40536b;line-height:1.6;margin-top:12px;white-space:pre-line;">${esc(advisorBio)}</div>` : ''}
        </div>` : ''}

        ${quotesUrl ? `<p style="margin:22px 0 6px;"><a href="${esc(quotesUrl)}" style="background:#0b7285;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:600;display:inline-block;">View my quotes</a></p>` : ''}

        <p style="font-size:12px;color:#9aa8bd;line-height:1.6;margin-top:20px;">
          Quoted prices can change without notice. Contact your advisor to lock in your rate. There is no obligation. You can also reply to this email with questions.
        </p>
      </div>
    </div>
  </div></body></html>`;
}

// Welcome / confirmation email to a newly registered user.
export async function sendSignupEmail(env, { to, firstName, role, baseUrl }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || 'Cruise Shoppers <noreply@cruiseshoppers.com>';
  if (!apiKey || !to) return { sent: false, reason: 'not_configured' };

  const isAdvisor = role === 'advisor';
  const hi = firstName ? ` ${firstName}` : '';
  const subject = isAdvisor
    ? 'We received your advisor application'
    : 'Welcome to Cruise Shoppers';
  const html = isAdvisor ? advisorReceivedHtml(firstName, baseUrl) : welcomeHtml(firstName, baseUrl);
  const text = isAdvisor
    ? `Hi${hi}, thanks for applying to the Cruise Shoppers advisor network. Your application is under review and we will email you as soon as it is approved.`
    : `Welcome to Cruise Shoppers${hi}! Your account is ready. Browse sailings and request personalized quotes anytime: ${baseUrl || 'https://cruiseshoppers.com'}`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch {}
    return { sent: false, reason: 'send_failed', status: res.status, detail };
  }
  return { sent: true };
}

function welcomeHtml(firstName, baseUrl) {
  const base = (baseUrl || 'https://cruiseshoppers.com').replace(/\/$/, '');
  const greeting = firstName ? `Welcome aboard, ${esc(firstName)}!` : 'Welcome aboard!';
  return `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f2438;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border-radius:14px;padding:32px;border:1px solid #e2e8f2;">
      <div style="font-size:20px;font-weight:700;color:#0b3a66;">Cruise Shoppers</div>
      <h1 style="font-size:21px;margin:22px 0 8px;">${greeting}</h1>
      <p style="font-size:15px;line-height:1.6;color:#40536b;">
        Your account is ready. Search sailings from the world's top cruise lines, then request a
        free, personalized quote on any cruise you love. No pressure, no obligation.
      </p>
      <p style="margin:26px 0;">
        <a href="${esc(base)}" style="background:#0b7285;color:#fff;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:600;display:inline-block;">Browse sailings</a>
      </p>
      <p style="font-size:13px;color:#7386a0;line-height:1.6;">Happy cruising,<br>The Cruise Shoppers Team</p>
    </div>
  </div></body></html>`;
}

function advisorReceivedHtml(firstName, baseUrl) {
  const base = (baseUrl || 'https://cruiseshoppers.com').replace(/\/$/, '');
  const greeting = firstName ? `Hi ${esc(firstName)},` : 'Hello,';
  return `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f2438;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border-radius:14px;padding:32px;border:1px solid #e2e8f2;">
      <div style="font-size:20px;font-weight:700;color:#0b3a66;">Cruise Shoppers</div>
      <h1 style="font-size:20px;margin:22px 0 8px;">Application received</h1>
      <p style="font-size:15px;line-height:1.6;color:#40536b;">
        ${greeting} Thanks for applying to the Cruise Shoppers advisor network. We are reviewing your
        CLIA / IATA details, and you will be able to view client quote requests as soon as your
        account is approved. We will email you the moment that happens.
      </p>
      <p style="font-size:13px;color:#7386a0;line-height:1.6;">Talk soon,<br>The Cruise Shoppers Team</p>
    </div>
  </div></body></html>`;
}

// Send an internal notification to the site operators (NOTIFY_EMAIL, or
// ADMIN_EMAILS as a fallback). Used for new signups, applications, and leads.
export async function sendAdminNotice(env, { subject, title, intro, rows = [], notes, ctaUrl, ctaText }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || 'Cruise Shoppers <noreply@cruiseshoppers.com>';
  const recipients = String(env.NOTIFY_EMAIL || env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!apiKey || !recipients.length) return { sent: false, reason: 'not_configured' };

  const clean = rows.filter(([, v]) => v != null && String(v).trim() !== '');
  const html = adminNoticeHtml({ title, intro, rows: clean, notes, ctaUrl, ctaText });
  const text = [
    title,
    intro || '',
    '',
    ...clean.map(([k, v]) => `${k}: ${v}`),
    notes ? `\nRequest details:\n${notes}` : '',
    ctaUrl ? `\n${ctaText || 'Open'}: ${ctaUrl}` : '',
  ].join('\n');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: recipients, subject, html, text }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch {}
    return { sent: false, reason: 'send_failed', status: res.status, detail };
  }
  return { sent: true, recipients: recipients.length };
}

// Report email configuration + optionally attempt a live test send. No secret
// values are returned — only whether they are present.
export async function emailDiagnostics(env, { doSend } = {}) {
  const config = {
    has_resend_key: !!env.RESEND_API_KEY,
    mail_from: env.MAIL_FROM || '(default) noreply@cruiseshoppers.com',
    notify_email_set: !!env.NOTIFY_EMAIL,
    admin_emails_set: !!env.ADMIN_EMAILS,
    recipients: String(env.NOTIFY_EMAIL || env.ADMIN_EMAILS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean).length,
  };
  let send = null;
  if (doSend) {
    send = await sendAdminNotice(env, {
      subject: 'Cruise Shoppers email test',
      title: 'Email test',
      intro: 'If you are reading this, notification email is working.',
      rows: [['Test', 'success']],
    });
  }
  return { config, send };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// Ensure a free-text price reads as USD: adds thousands-separator commas to
// each number and prepends a $ if one isn't already present.
function money(v) {
  if (v == null) return '';
  let s = String(v).trim();
  if (!s) return '';
  s = s.replace(/\d[\d,]*(\.\d+)?/g, (num) => {
    const clean = num.replace(/,/g, '');
    const dot = clean.indexOf('.');
    const intPart = dot === -1 ? clean : clean.slice(0, dot);
    const decPart = dot === -1 ? '' : clean.slice(dot);
    return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + decPart;
  });
  if (s.indexOf('$') !== -1) return s;
  return /\d/.test(s) ? s.replace(/\d/, (m) => '$' + m) : s;
}

function adminNoticeHtml({ title, intro, rows = [], notes, ctaUrl, ctaText }) {
  return noticeHtml({ eyebrow: 'Notification', title, intro, rows, notes, ctaUrl, ctaText });
}

// Shared, polished layout for operator/advisor notifications: navy header,
// a clean detail table, an optional line-by-line "request details" block
// (so multi-line client answers don't collapse into a run-on paragraph),
// and a call-to-action button.
function noticeHtml({ eyebrow, title, intro, rows = [], notes, ctaUrl, ctaText }) {
  const rowsHtml = rows
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(
      ([k, v]) =>
        `<tr><td style="padding:7px 16px 7px 0;color:#7386a0;font-size:13px;vertical-align:top;white-space:nowrap;">${esc(k)}</td><td style="padding:7px 0;color:#0f2438;font-size:14px;border-bottom:1px solid #f0f3f8;">${esc(v)}</td></tr>`
    )
    .join('');

  const notesBlock = (notes && String(notes).trim())
    ? `<div style="margin:20px 0 0;">
        <div style="font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:#7386a0;font-weight:700;margin-bottom:6px;">Request details</div>
        <div style="background:#f8fafd;border:1px solid #e2e8f2;border-radius:10px;padding:14px 16px;font-size:14px;color:#0f2438;line-height:1.6;white-space:pre-line;">${esc(notes)}</div>
      </div>`
    : '';

  const cta = ctaUrl
    ? `<p style="margin:24px 0 0;"><a href="${esc(ctaUrl)}" style="background:#0b7285;color:#fff;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:600;display:inline-block;">${esc(ctaText || 'Open dashboard')}</a></p>`
    : '';

  return `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f2438;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border-radius:14px;border:1px solid #e2e8f2;overflow:hidden;">
      <div style="background:#0b3a66;padding:20px 32px;">
        <div style="font-size:20px;font-weight:700;color:#ffffff;">Cruise Shoppers</div>
        ${eyebrow ? `<div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#9fc0e0;margin-top:2px;">${esc(eyebrow)}</div>` : ''}
      </div>
      <div style="padding:26px 32px;">
        <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#0b3a66;margin:0 0 8px;">${esc(title)}</h1>
        ${intro ? `<p style="font-size:14px;line-height:1.6;color:#40536b;margin:0 0 16px;">${esc(intro)}</p>` : ''}
        <table style="border-collapse:collapse;width:100%;">${rowsHtml}</table>
        ${notesBlock}
        ${cta}
      </div>
    </div>
  </div></body></html>`;
}

// Notify an advisor that their application has been approved.
export async function sendAdvisorApprovedEmail(env, { to, firstName, loginUrl }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || 'Cruise Shoppers <noreply@cruiseshoppers.com>';
  if (!apiKey) return { sent: false, reason: 'not_configured' };

  const name = firstName ? ` ${firstName}` : '';
  const html = advisorApprovedHtml(loginUrl, firstName);
  const text = `Good news${name}! Your Cruise Shoppers advisor account has been approved. Log in to view client quote requests:\n\n${loginUrl}`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Your Cruise Shoppers advisor account is approved',
      html,
      text,
    }),
  });

  if (!res.ok) return { sent: false, reason: 'send_failed', status: res.status };
  return { sent: true };
}

function advisorApprovedHtml(loginUrl, firstName) {
  const greeting = firstName ? `Hi ${firstName},` : 'Hello,';
  return `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f2438;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border-radius:14px;padding:32px;border:1px solid #e2e8f2;">
      <div style="font-size:20px;font-weight:700;color:#0b3a66;">Cruise Shoppers</div>
      <h1 style="font-size:20px;margin:24px 0 8px;">You're approved!</h1>
      <p style="font-size:15px;line-height:1.6;color:#40536b;">
        ${greeting} Welcome to the Cruise Shoppers advisor network. Your account has been
        approved, and you can now view client quote requests in your dashboard.
      </p>
      <p style="margin:28px 0;">
        <a href="${loginUrl}" style="background:#0b7285;color:#fff;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:600;display:inline-block;">Go to your dashboard</a>
      </p>
      <p style="font-size:13px;color:#7386a0;line-height:1.6;">
        If the button doesn't work, paste this link into your browser:<br>
        <span style="color:#0b7285;word-break:break-all;">${loginUrl}</span>
      </p>
    </div>
  </div></body></html>`;
}

function resetEmailHtml(resetUrl) {
  return `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f2438;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border-radius:14px;padding:32px;border:1px solid #e2e8f2;">
      <div style="font-size:20px;font-weight:700;color:#0b3a66;">Cruise Shoppers</div>
      <h1 style="font-size:20px;margin:24px 0 8px;">Reset your password</h1>
      <p style="font-size:15px;line-height:1.6;color:#40536b;">
        We received a request to reset your password. Click the button below to choose a new one.
        This link expires shortly for your security.
      </p>
      <p style="margin:28px 0;">
        <a href="${resetUrl}" style="background:#0b7285;color:#fff;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:600;display:inline-block;">Reset password</a>
      </p>
      <p style="font-size:13px;color:#7386a0;line-height:1.6;">
        If the button doesn't work, paste this link into your browser:<br>
        <span style="color:#0b7285;word-break:break-all;">${resetUrl}</span>
      </p>
      <p style="font-size:13px;color:#7386a0;">If you didn't request this, you can safely ignore this email.</p>
    </div>
  </div></body></html>`;
}
