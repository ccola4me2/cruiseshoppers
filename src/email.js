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
