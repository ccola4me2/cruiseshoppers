// Advisor "specials": highlighted deals an advisor posts that all clients can
// browse. A quote request made on a special is routed only to the posting
// advisor (handled in quotes.js via target_advisor_id).

import { json } from './util.js';
import { getCurrentUser } from './auth.js';
import {
  createSpecial,
  listSpecialsByAdvisor,
  listActiveSpecials,
  findSpecialById,
  updateSpecial,
  deleteSpecial,
  setSpecialStatus,
  offAllSpecials,
  getAdvisorRatings,
  listAlertRecipientsForCruiseLine,
} from './db.js';
import { sendSavedSearchAlert } from './email.js';

const clip = (v, n = 400) => {
  if (v == null) return null;
  const s = String(v).trim().slice(0, n);
  return s || null;
};

async function requireAdvisor(request, env, { active = false } = {}) {
  const user = await getCurrentUser(request, env);
  if (!user) return { error: json({ error: 'unauthorized' }, 401) };
  if (user.role !== 'advisor') return { error: json({ error: 'forbidden' }, 403) };
  if (active && user.status !== 'active') {
    return { error: json({ error: 'pending_approval', message: 'Your advisor account is awaiting approval.' }, 403) };
  }
  return { user };
}

function mapOwn(s) {
  return {
    id: s.id,
    cruise_line: s.cruise_line,
    ship: s.ship,
    headline: s.headline,
    description: s.description,
    sail_dates: s.sail_dates,
    rate_from: s.rate_from,
    brochure_price: s.brochure_price,
    us_canada_only: !!s.us_canada_only,
    status: s.status,
    created_at: s.created_at,
  };
}

// GET /api/advisor/specials - the advisor's own specials.
export async function handleListAdvisorSpecials(request, env) {
  const { user, error } = await requireAdvisor(request, env);
  if (error) return error;
  const rows = await listSpecialsByAdvisor(env.DB, user.id);
  return json({ specials: rows.map(mapOwn), count: rows.length }, 200);
}

// POST /api/advisor/specials - create a special.
export async function handleCreateSpecial(request, env, ctx) {
  const { user, error } = await requireAdvisor(request, env, { active: true });
  if (error) return error;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const headline = clip(body.headline, 160);
  if (!headline) return json({ error: 'missing_headline', message: 'A headline is required.' }, 400);
  let special;
  try {
    special = await createSpecial(env.DB, {
      id: crypto.randomUUID(),
      advisor_id: user.id,
      cruise_line: clip(body.cruise_line, 120),
      ship: clip(body.ship, 120),
      headline,
      description: clip(body.description, 2000),
      sail_dates: clip(body.sail_dates, 300),
      rate_from: clip(body.rate_from, 60),
      brochure_price: clip(body.brochure_price, 60),
      us_canada_only: !!body.us_canada_only,
    });
  } catch (e) {
    const msg = String((e && e.message) || '');
    if (/no such table/i.test(msg)) {
      return json({ error: 'not_migrated', message: 'Specials are not set up yet. The database migration (0010) still needs to be applied.' }, 503);
    }
    return json({ error: 'save_failed', message: 'Could not save the special. Please try again.' }, 500);
  }

  // Alert clients whose saved search (with alerts on) matches this cruise line.
  if (special.cruise_line) {
    const alertP = (async () => {
      try {
        const recipients = await listAlertRecipientsForCruiseLine(env.DB, special.cruise_line);
        const base = (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
        for (const r of recipients) {
          await sendSavedSearchAlert(env, {
            to: r.email,
            firstName: r.first_name,
            headline: special.headline,
            cruiseLine: special.cruise_line,
            ship: special.ship,
            rateFrom: special.rate_from,
            searchName: r.search_name,
            specialsUrl: `${base}/specials`,
          });
        }
      } catch (_) {}
    })();
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(alertP);
  }

  return json({ ok: true, id: special.id }, 201);
}

// POST /api/advisor/specials/edit - update one of the advisor's specials.
export async function handleEditSpecial(request, env) {
  const { user, error } = await requireAdvisor(request, env, { active: true });
  if (error) return error;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const id = String(body.id || '').trim();
  if (!id) return json({ error: 'invalid_request' }, 400);
  const existing = await findSpecialById(env.DB, id);
  if (!existing || existing.advisor_id !== user.id) return json({ error: 'not_found' }, 404);
  const headline = clip(body.headline, 160);
  if (!headline) return json({ error: 'missing_headline', message: 'A headline is required.' }, 400);
  await updateSpecial(env.DB, id, user.id, {
    cruise_line: clip(body.cruise_line, 120),
    ship: clip(body.ship, 120),
    headline,
    description: clip(body.description, 2000),
    sail_dates: clip(body.sail_dates, 300),
    rate_from: clip(body.rate_from, 60),
    brochure_price: clip(body.brochure_price, 60),
    us_canada_only: !!body.us_canada_only,
  });
  return json({ ok: true }, 200);
}

// POST /api/advisor/specials/status - toggle one special on/off, or turn all off.
export async function handleSpecialStatus(request, env) {
  const { user, error } = await requireAdvisor(request, env, { active: true });
  if (error) return error;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  if (body.all === true || body.action === 'off_all') {
    await offAllSpecials(env.DB, user.id);
    return json({ ok: true }, 200);
  }
  const id = String(body.id || '').trim();
  const status = body.status === 'off' ? 'off' : 'active';
  if (!id) return json({ error: 'invalid_request' }, 400);
  const existing = await findSpecialById(env.DB, id);
  if (!existing || existing.advisor_id !== user.id) return json({ error: 'not_found' }, 404);
  await setSpecialStatus(env.DB, id, user.id, status);
  return json({ ok: true, status }, 200);
}

// POST /api/advisor/specials/delete - remove one of the advisor's specials.
export async function handleDeleteSpecial(request, env) {
  const { user, error } = await requireAdvisor(request, env, { active: true });
  if (error) return error;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const id = String(body.id || '').trim();
  if (!id) return json({ error: 'invalid_request' }, 400);
  const existing = await findSpecialById(env.DB, id);
  if (!existing || existing.advisor_id !== user.id) return json({ error: 'not_found' }, 404);
  await deleteSpecial(env.DB, id, user.id);
  return json({ ok: true }, 200);
}

// GET /api/specials - public list of active specials for clients to browse.
export async function handleListPublicSpecials(request, env) {
  const rows = await listActiveSpecials(env.DB, 100);
  const ratings = await getAdvisorRatings(env.DB, rows.map((s) => s.advisor_id));
  const specials = rows.map((s) => {
    let prof = s.advisor_profile_json;
    if (typeof prof === 'string') { try { prof = JSON.parse(prof); } catch { prof = null; } }
    prof = prof || {};
    const advisorName = [s.advisor_first, s.advisor_last].filter(Boolean).join(' ') || null;
    const rt = ratings[s.advisor_id];
    return {
      id: s.id,
      cruise_line: s.cruise_line,
      ship: s.ship,
      headline: s.headline,
      description: s.description,
      sail_dates: s.sail_dates,
      rate_from: s.rate_from,
      brochure_price: s.brochure_price,
      us_canada_only: !!s.us_canada_only,
      advisor_name: advisorName,
      agency: prof.agency || null,
      advisor_rating: rt ? rt.avg : null,
      advisor_review_count: rt ? rt.count : 0,
    };
  });
  return json({ specials, count: specials.length }, 200);
}
