// Transactional email via Resend (https://resend.com).
// Set RESEND_API_KEY as a Worker secret and MAIL_FROM in [vars].
// If no key is configured, sending is skipped gracefully (documented in README);
// the reset flow still returns a generic success to avoid leaking account state.

export async function sendResetEmail(env, { to, resetUrl }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || 'CruiseShoppers <noreply@cruiseshoppers.com>';

  if (!apiKey) {
    // Not configured: caller still returns a generic success message.
    return { sent: false, reason: 'not_configured' };
  }

  const html = resetEmailHtml(resetUrl);
  const text = `Reset your CruiseShoppers password:\n\n${resetUrl}\n\nThis link expires soon. If you did not request it, you can ignore this email.`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Reset your CruiseShoppers password',
      html,
      text,
    }),
  });

  if (!res.ok) {
    return { sent: false, reason: 'send_failed', status: res.status };
  }
  return { sent: true };
}

// Notify a client that a travel advisor submitted a quote on their request.
export async function sendQuoteToClient(env, { to, clientName, advisorName, sailing, price, specials, additionalInfo }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || 'CruiseShoppers <noreply@cruiseshoppers.com>';
  if (!apiKey || !to) return { sent: false, reason: 'not_configured' };

  const hi = clientName ? ` ${clientName}` : '';
  const rows = [
    ['Sailing', sailing],
    ['Price', price],
    ['Special offers', specials],
    ['Details', additionalInfo],
    ['From advisor', advisorName],
  ];
  const html = quoteToClientHtml({ hi, rows });
  const text =
    `Good news${hi}! A travel advisor has prepared a quote for your cruise request.\n\n` +
    rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n') +
    `\n\nReply to this email to move forward.`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: 'Your CruiseShoppers quote is ready', html, text }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch {}
    return { sent: false, reason: 'send_failed', status: res.status, detail };
  }
  return { sent: true };
}

function quoteToClientHtml({ hi, rows }) {
  const rowsHtml = rows
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#7386a0;font-size:13px;vertical-align:top;white-space:nowrap;">${esc(k)}</td><td style="padding:6px 0;color:#0f2438;font-size:14px;">${esc(v)}</td></tr>`
    )
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f2438;">
  <div style="max-width:540px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border-radius:14px;padding:32px;border:1px solid #e2e8f2;">
      <div style="font-size:20px;font-weight:700;color:#0b3a66;">CruiseShoppers</div>
      <h1 style="font-size:20px;margin:22px 0 8px;">Your quote is ready!</h1>
      <p style="font-size:15px;line-height:1.6;color:#40536b;margin:0 0 14px;">
        Good news${esc(hi)}, a travel advisor has prepared a personalized quote for your cruise request.
      </p>
      <table style="border-collapse:collapse;width:100%;">${rowsHtml}</table>
      <p style="font-size:13px;color:#7386a0;line-height:1.6;margin-top:22px;">Simply reply to this email to move forward or ask questions.</p>
    </div>
  </div></body></html>`;
}

// Welcome / confirmation email to a newly registered user.
export async function sendSignupEmail(env, { to, firstName, role, baseUrl }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || 'CruiseShoppers <noreply@cruiseshoppers.com>';
  if (!apiKey || !to) return { sent: false, reason: 'not_configured' };

  const isAdvisor = role === 'advisor';
  const hi = firstName ? ` ${firstName}` : '';
  const subject = isAdvisor
    ? 'We received your advisor application'
    : 'Welcome to CruiseShoppers';
  const html = isAdvisor ? advisorReceivedHtml(firstName, baseUrl) : welcomeHtml(firstName, baseUrl);
  const text = isAdvisor
    ? `Hi${hi}, thanks for applying to the CruiseShoppers advisor network. Your application is under review and we will email you as soon as it is approved.`
    : `Welcome to CruiseShoppers${hi}! Your account is ready. Browse sailings and request personalized quotes anytime: ${baseUrl || 'https://cruiseshoppers.com'}`;

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
      <div style="font-size:20px;font-weight:700;color:#0b3a66;">CruiseShoppers</div>
      <h1 style="font-size:21px;margin:22px 0 8px;">${greeting}</h1>
      <p style="font-size:15px;line-height:1.6;color:#40536b;">
        Your account is ready. Search sailings from the world's top cruise lines, then request a
        free, personalized quote on any cruise you love. No pressure, no obligation.
      </p>
      <p style="margin:26px 0;">
        <a href="${esc(base)}" style="background:#0b7285;color:#fff;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:600;display:inline-block;">Browse sailings</a>
      </p>
      <p style="font-size:13px;color:#7386a0;line-height:1.6;">Happy cruising,<br>The CruiseShoppers Team</p>
    </div>
  </div></body></html>`;
}

function advisorReceivedHtml(firstName, baseUrl) {
  const base = (baseUrl || 'https://cruiseshoppers.com').replace(/\/$/, '');
  const greeting = firstName ? `Hi ${esc(firstName)},` : 'Hello,';
  return `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f2438;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border-radius:14px;padding:32px;border:1px solid #e2e8f2;">
      <div style="font-size:20px;font-weight:700;color:#0b3a66;">CruiseShoppers</div>
      <h1 style="font-size:20px;margin:22px 0 8px;">Application received</h1>
      <p style="font-size:15px;line-height:1.6;color:#40536b;">
        ${greeting} Thanks for applying to the CruiseShoppers advisor network. We are reviewing your
        CLIA / IATA details, and you will be able to view client quote requests as soon as your
        account is approved. We will email you the moment that happens.
      </p>
      <p style="font-size:13px;color:#7386a0;line-height:1.6;">Talk soon,<br>The CruiseShoppers Team</p>
    </div>
  </div></body></html>`;
}

// Send an internal notification to the site operators (NOTIFY_EMAIL, or
// ADMIN_EMAILS as a fallback). Used for new signups, applications, and leads.
export async function sendAdminNotice(env, { subject, title, intro, rows = [], ctaUrl, ctaText }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || 'CruiseShoppers <noreply@cruiseshoppers.com>';
  const recipients = String(env.NOTIFY_EMAIL || env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!apiKey || !recipients.length) return { sent: false, reason: 'not_configured' };

  const clean = rows.filter(([, v]) => v != null && String(v).trim() !== '');
  const html = adminNoticeHtml({ title, intro, rows: clean, ctaUrl, ctaText });
  const text = [
    title,
    intro || '',
    '',
    ...clean.map(([k, v]) => `${k}: ${v}`),
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
      subject: 'CruiseShoppers email test',
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

function adminNoticeHtml({ title, intro, rows = [], ctaUrl, ctaText }) {
  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#7386a0;font-size:13px;vertical-align:top;white-space:nowrap;">${esc(k)}</td><td style="padding:6px 0;color:#0f2438;font-size:14px;">${esc(v)}</td></tr>`
    )
    .join('');
  const cta = ctaUrl
    ? `<p style="margin:26px 0 0;"><a href="${esc(ctaUrl)}" style="background:#0b7285;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;display:inline-block;">${esc(ctaText || 'Open dashboard')}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f2438;">
  <div style="max-width:540px;margin:0 auto;padding:32px 20px;">
    <div style="background:#ffffff;border-radius:14px;padding:32px;border:1px solid #e2e8f2;">
      <div style="font-size:20px;font-weight:700;color:#0b3a66;">CruiseShoppers</div>
      <h1 style="font-size:19px;margin:22px 0 8px;">${esc(title)}</h1>
      ${intro ? `<p style="font-size:14px;line-height:1.6;color:#40536b;margin:0 0 14px;">${esc(intro)}</p>` : ''}
      <table style="border-collapse:collapse;width:100%;">${rowsHtml}</table>
      ${cta}
    </div>
  </div></body></html>`;
}

// Notify an advisor that their application has been approved.
export async function sendAdvisorApprovedEmail(env, { to, firstName, loginUrl }) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM || 'CruiseShoppers <noreply@cruiseshoppers.com>';
  if (!apiKey) return { sent: false, reason: 'not_configured' };

  const name = firstName ? ` ${firstName}` : '';
  const html = advisorApprovedHtml(loginUrl, firstName);
  const text = `Good news${name}! Your CruiseShoppers advisor account has been approved. Log in to view client quote requests:\n\n${loginUrl}`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Your CruiseShoppers advisor account is approved',
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
      <div style="font-size:20px;font-weight:700;color:#0b3a66;">CruiseShoppers</div>
      <h1 style="font-size:20px;margin:24px 0 8px;">You're approved!</h1>
      <p style="font-size:15px;line-height:1.6;color:#40536b;">
        ${greeting} Welcome to the CruiseShoppers advisor network. Your account has been
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
      <div style="font-size:20px;font-weight:700;color:#0b3a66;">CruiseShoppers</div>
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
