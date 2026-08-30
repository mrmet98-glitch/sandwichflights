import { json, errorJson } from '../_lib/http.js';

function code(v) { return String(v || '').trim().toUpperCase(); }
function validCode(v) { return /^[A-Z0-9]{3,4}$/.test(v); }
function validDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }
function prettyDate(v) {
  if (!validDate(v)) return v;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' })
    .format(new Date(`${v}T12:00:00Z`));
}

async function deleteSearch(request, DB) {
  const url = new URL(request.url);
  const id = String(url.searchParams.get('id') || '').trim();
  if (!id) return json({ error: 'Missing search id.' }, 400);

  const row = await DB.prepare('SELECT id, is_custom FROM searches WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Search not found.' }, 404);
  if (!row.is_custom) return json({ error: 'Built-in workbook searches cannot be deleted.' }, 400);

  await DB.prepare('DELETE FROM searches WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function createSearch(request, DB) {
  const body = await request.json();
  const ticketType = String(body.ticket_type || '').trim();
  const leg1Date = String(body.leg1_date || '').trim();
  const leg1Origin = code(body.leg1_origin);
  const leg1Destination = code(body.leg1_destination);
  const isOneWay = ticketType === 'One Way';
  const leg2Date = isOneWay ? null : String(body.leg2_date || '').trim();
  const leg2Origin = isOneWay ? null : code(body.leg2_origin);
  const leg2Destination = isOneWay ? null : code(body.leg2_destination);

  if (!ticketType) return json({ error: 'Choose a ticket type.' }, 400);
  if (!validDate(leg1Date) || !validCode(leg1Origin) || !validCode(leg1Destination)) {
    return json({ error: 'Leg 1 needs a valid date and 3–4 character airport/metro codes.' }, 400);
  }
  if (!isOneWay && (!validDate(leg2Date) || !validCode(leg2Origin) || !validCode(leg2Destination))) {
    return json({ error: 'This ticket type needs a valid second leg.' }, 400);
  }

  const autoLabel = isOneWay
    ? `${prettyDate(leg1Date)} ${leg1Origin}→${leg1Destination} (one-way)`
    : `${prettyDate(leg1Date)} ${leg1Origin}→${leg1Destination} + ${prettyDate(leg2Date)} ${leg2Origin}→${leg2Destination}`;
  const whatToSearch = String(body.what_to_search || '').trim() || autoLabel;

  const next = await DB.prepare(`
    SELECT
      COALESCE(MAX(CASE WHEN id GLOB 'X[0-9]*' THEN CAST(SUBSTR(id, 2) AS INTEGER) END), 0) + 1 AS next_id,
      COALESCE(MAX(sort_order), 0) + 1 AS next_sort
    FROM searches
  `).first();

  const id = `X${Number(next?.next_id || 1)}`;
  await DB.prepare(`
    INSERT INTO searches
      (id, ticket_type, leg1_date, leg1_origin, leg1_destination, leg2_date, leg2_origin, leg2_destination, what_to_search, sort_order, is_custom)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).bind(
    id, ticketType, leg1Date, leg1Origin, leg1Destination,
    leg2Date, leg2Origin, leg2Destination, whatToSearch, Number(next?.next_sort || 1)
  ).run();

  return json({ ok: true, id });
}

export async function onRequest(context) {
  try {
    const DB = context.env?.DB;
    if (!DB) return json({ error: 'D1 binding DB is not configured.' }, 500);

    if (context.request.method === 'DELETE') return await deleteSearch(context.request, DB);
    if (context.request.method === 'POST') return await createSearch(context.request, DB);
    return json({ error: 'Method not allowed' }, 405);
  } catch (e) {
    return errorJson(e, 'Could not update searches.');
  }
}
