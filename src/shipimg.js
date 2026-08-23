// Ship photos via Wikipedia/Wikimedia. CruiseFeed carries no images, so we
// resolve a ship's lead photo by name and cache the result at the edge (30 days
// for a hit, 7 for a miss). Attribution is fetched best-effort so we can show a
// small credit and stay license-compliant.

import { json } from './util.js';

const UA = 'CruiseShoppers/1.0 (https://cruiseshoppers.com)';
const HIT_TTL = 2592000; // 30 days
const MISS_TTL = 604800; // 7 days

function normName(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function cacheKey(name) { return new Request(`https://cache.internal/shipimg/${encodeURIComponent(normName(name))}`); }
function stripHtml(s) { return String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 120); }

// POST /api/ship-images  { ships: ["Harmony of the Seas", ...] }
export async function handleShipImages(request, env, ctx) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const list = Array.isArray(body.ships) ? body.ships : [];
  const ships = [...new Set(list.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()))].slice(0, 20);
  const images = {};
  await Promise.all(ships.map(async (ship) => { images[ship] = await resolveShipImage(ship, ctx); }));
  return json({ images }, 200, { 'Cache-Control': 'public, max-age=86400' });
}

async function resolveShipImage(ship, ctx) {
  try {
    const hit = await caches.default.match(cacheKey(ship));
    if (hit) return await hit.json();
  } catch (_) {}
  let value = { image: null };
  try {
    const r = await lookupWikipedia(ship);
    if (r) value = r;
  } catch (_) {}
  try {
    const res = new Response(JSON.stringify(value), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${value.image ? HIT_TTL : MISS_TTL}` },
    });
    const p = caches.default.put(cacheKey(ship), res);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
  } catch (_) {}
  return value;
}

async function lookupWikipedia(ship) {
  const title = encodeURIComponent(ship.trim().replace(/\s+/g, '_'));
  const sres = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    cf: { cacheTtl: HIT_TTL, cacheEverything: true },
  });
  if (!sres.ok) return null;
  const s = await sres.json();
  if (s.type === 'disambiguation') return null;
  const thumb = s.thumbnail && s.thumbnail.source;
  if (!thumb) return null;
  // Sharper image: bump the width in the thumb URL and drop tracking params.
  const image = thumb.replace(/\/\d+px-/, '/800px-').replace(/\?.*$/, '');
  const source = (s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page) || null;

  // Attribution (best-effort) via Commons imageinfo on the underlying file.
  let credit = 'Wikimedia Commons';
  try {
    const seg = (thumb.split('/thumb/')[1] || '').split('/');
    const fname = seg.length >= 3 ? decodeURIComponent(seg[2]) : '';
    if (fname) {
      const ires = await fetch(
        `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=extmetadata&format=json&titles=${encodeURIComponent('File:' + fname)}`,
        { headers: { Accept: 'application/json', 'User-Agent': UA }, cf: { cacheTtl: HIT_TTL } }
      );
      if (ires.ok) {
        const d = await ires.json();
        const pages = d.query && d.query.pages;
        const first = pages && pages[Object.keys(pages)[0]];
        const ext = first && first.imageinfo && first.imageinfo[0] && first.imageinfo[0].extmetadata;
        if (ext) {
          const artist = ext.Artist && stripHtml(ext.Artist.value);
          const lic = ext.LicenseShortName && ext.LicenseShortName.value;
          credit = [artist, lic].filter(Boolean).join(' · ') || credit;
        }
      }
    }
  } catch (_) {}

  return { image, credit, source };
}
