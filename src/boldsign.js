// BoldSign integration: e-mail the Participating Agency Agreement (set up in
// BoldSign as a reusable Template) to a new agency owner for signature the
// moment they sign up. Best-effort — it never throws into the signup flow, and
// no-ops when BoldSign isn't configured, so account creation always succeeds.
//
// Required Worker secrets/vars:
//   BOLDSIGN_API_KEY      - your BoldSign API key (Settings -> API)
//   BOLDSIGN_TEMPLATE_ID  - the Template ID of the uploaded agreement
// Optional:
//   BOLDSIGN_ROLE         - the signer role name in the template (default "Agent")
//
// The template's prefill fields must be given these ids so the merge values land:
//   AgentName, AgencyName, Email, Phone
// (Set the field's "Field Id" in the BoldSign template editor to match.)

const BASE = 'https://api.boldsign.com';

// Send the agreement template to one agency owner. `agency` is
// { agentName, agencyName, email, phone }. Fires in the background via
// ctx.waitUntil when available so the HTTP response isn't held up.
export async function sendAgencyAgreement(env, ctx, agency) {
  const key = env.BOLDSIGN_API_KEY;
  const templateId = env.BOLDSIGN_TEMPLATE_ID;
  if (!key || !templateId || !agency || !agency.email) {
    return { ok: false, reason: 'not_configured' };
  }

  const prefill = [
    { id: 'AgentName', value: agency.agentName || '' },
    { id: 'AgencyName', value: agency.agencyName || '' },
    { id: 'Email', value: agency.email || '' },
    { id: 'Phone', value: agency.phone || '' },
  ].filter((f) => f.value);

  const payload = {
    title: 'Cruise Shoppers Participating Agency Agreement',
    message: 'Please review and sign the Cruise Shoppers Participating Agency Agreement to activate your agency.',
    roles: [
      {
        roleIndex: 1,
        roleName: env.BOLDSIGN_ROLE || 'Agent',
        signerName: agency.agentName || agency.agencyName || agency.email,
        signerEmail: agency.email,
        signerType: 'Signer',
        existingFormFields: prefill,
      },
    ],
  };

  const task = (async () => {
    try {
      const res = await fetch(`${BASE}/v1/template/send?templateId=${encodeURIComponent(templateId)}`, {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.error('boldsign send failed', res.status, detail.slice(0, 500));
      }
    } catch (e) {
      console.error('boldsign error', (e && (e.message || e)) || 'unknown');
    }
  })();

  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
  else await task;
  return { ok: true };
}
