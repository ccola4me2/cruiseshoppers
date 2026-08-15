// GHL (LeadConnector) API v2 client: upsert a contact with the selected cruise
// written into the Cruise of Interest custom field.
//
// Requires Worker secrets GHL_API_TOKEN (Private Integration token, contacts.write
// + View Custom Fields) and GHL_LOCATION_ID.

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

// The custom field we write the cruise into.
const CRUISE_FIELD_KEY = 'contact.cruise_of_interest_1';

function headers(env) {
  return {
    Authorization: `Bearer ${env.GHL_API_TOKEN}`,
    Version: GHL_VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

// Map of custom field key -> id for the location, cached at the edge for an hour.
async function getFieldMap(env) {
  const cache = caches.default;
  const key = new Request('https://cruiseshoppers.internal/ghl/customfields-v1');
  const hit = await cache.match(key);
  if (hit) return hit.json();

  const res = await fetch(`${GHL_BASE}/locations/${env.GHL_LOCATION_ID}/customFields`, { headers: headers(env) });
  if (!res.ok) { const e = new Error('customFields_' + res.status); e.status = res.status; throw e; }
  const data = await res.json();
  const fields = data.customFields || data.customField || [];
  const map = {};
  for (const f of fields) {
    if (!f || !f.id) continue;
    if (f.fieldKey) {
      map[f.fieldKey] = f.id;
      map[f.fieldKey.replace(/^contact\./, '')] = f.id;
    }
  }
  const store = new Response(JSON.stringify(map), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' },
  });
  await cache.put(key, store.clone());
  return map;
}

// Upsert a contact (dedupes by email/phone) with the cruise + extra custom fields.
export async function upsertGhlContact(env, lead) {
  if (!env.GHL_API_TOKEN || !env.GHL_LOCATION_ID) return { ok: false, reason: 'not_configured' };

  let fieldMap = {};
  try { fieldMap = await getFieldMap(env); } catch (_) { fieldMap = {}; }

  const customFields = [];
  const addField = (fieldKey, value) => {
    const id = fieldMap[fieldKey] || fieldMap[fieldKey.replace(/^contact\./, '')];
    if (id && value != null && String(value).trim() !== '') {
      customFields.push({ id, field_value: String(value) });
    }
  };
  addField(CRUISE_FIELD_KEY, lead.cruise);
  addField('contact.number_of_cabins', lead.cabins);
  addField('contact.additional_information', lead.notes);

  const body = {
    locationId: env.GHL_LOCATION_ID,
    firstName: lead.first_name || undefined,
    lastName: lead.last_name || undefined,
    email: lead.email || undefined,
    phone: lead.phone || undefined,
    source: 'CruiseShoppers Website',
  };
  if (customFields.length) body.customFields = customFields;

  const res = await fetch(`${GHL_BASE}/contacts/upsert`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 400); } catch {}
    return { ok: false, reason: 'upsert_' + res.status, detail };
  }
  return { ok: true };
}
