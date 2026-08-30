import { json, errorJson } from '../_lib/http.js';

const segmentFields = [
  'entered_date','entered_flight_number','ident','ident_iata','ident_icao','actual_ident',
  'origin_code','origin_iata','origin_icao','origin_name','origin_city','origin_timezone',
  'destination_code','destination_iata','destination_icao','destination_name','destination_city','destination_timezone',
  'scheduled_out_utc','scheduled_in_utc','aircraft_type','cabin','source_mode'
];

function nullableNumber(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function deleteOption(request, DB) {
  const url = new URL(request.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) return json({ error: 'Missing option id' }, 400);
  await DB.prepare('DELETE FROM fare_options WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

function normalizePricing(body) {
  const {
    total_price, currency = 'USD', pricing_type = 'cash', points_amount,
    points_program = '', taxes_fees, taxes_currency = 'USD',
    point_value_cents, comparison_value_usd
  } = body;

  if (!['cash', 'points'].includes(pricing_type)) throw new Error('Unknown pricing type.');

  const totalPrice = nullableNumber(total_price);
  const pointsAmount = nullableNumber(points_amount);
  const taxesFees = nullableNumber(taxes_fees) ?? 0;
  const pointValue = nullableNumber(point_value_cents);
  let comparisonValue = nullableNumber(comparison_value_usd);

  if (pricing_type === 'cash') {
    if (totalPrice === null || totalPrice < 0) throw new Error('Enter the cash fare.');
    if (currency === 'USD') comparisonValue = totalPrice;
    if (comparisonValue === null) throw new Error('For non-USD cash fares, enter the optimizer value in USD.');
  } else {
    if (pointsAmount === null || pointsAmount <= 0) throw new Error('Enter the points / miles amount.');
    if (taxesFees < 0) throw new Error('Taxes / fees cannot be negative.');
    if (pointValue === null || pointValue < 0) throw new Error('Enter a cents-per-point value for optimizer comparisons.');
    if (taxes_currency === 'USD') comparisonValue = (pointsAmount * pointValue / 100) + taxesFees;
    if (comparisonValue === null) throw new Error('For non-USD award taxes, enter the optimizer value in USD.');
  }

  return {
    pricing_type,
    total_price: pricing_type === 'cash' ? totalPrice : null,
    currency,
    points_amount: pricing_type === 'points' ? Math.round(pointsAmount) : null,
    points_program: pricing_type === 'points' ? points_program : '',
    taxes_fees: pricing_type === 'points' ? taxesFees : null,
    taxes_currency: pricing_type === 'points' ? taxes_currency : 'USD',
    point_value_cents: pricing_type === 'points' ? pointValue : null,
    comparison_value_usd: comparisonValue
  };
}

function validateSegments(search, segments) {
  if (!segments.length) throw new Error('Add at least one flight segment.');
  const outbound = segments.filter(s => s.direction === 'outbound');
  const returns = segments.filter(s => s.direction === 'return');
  if (!outbound.length) throw new Error('Outbound needs at least one segment.');
  if (search.ticket_type !== 'One Way' && !returns.length) throw new Error('This search needs return segments too.');
  if (search.ticket_type === 'One Way' && returns.length) throw new Error('One-way searches cannot contain return segments.');

  segments.forEach((s, index) => {
    if (!s.entered_date || !s.entered_flight_number) throw new Error(`Segment ${index + 1} is missing date or flight number.`);
  });
}

function segmentStatement(DB, optionId, s, index) {
  const vals = Object.fromEntries(segmentFields.map(k => [k, s[k] ?? null]));
  return DB.prepare(`
    INSERT INTO flight_segments (
      option_id,direction,segment_order,entered_date,entered_flight_number,ident,ident_iata,ident_icao,actual_ident,
      origin_code,origin_iata,origin_icao,origin_name,origin_city,origin_timezone,
      destination_code,destination_iata,destination_icao,destination_name,destination_city,destination_timezone,
      scheduled_out_utc,scheduled_in_utc,aircraft_type,cabin,source_mode,fetched_at,lookup_json
    ) VALUES (
      ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?
    )
  `).bind(
    optionId, s.direction, Number(s.segment_order || index + 1), vals.entered_date, vals.entered_flight_number,
    vals.ident, vals.ident_iata, vals.ident_icao, vals.actual_ident,
    vals.origin_code, vals.origin_iata, vals.origin_icao, vals.origin_name, vals.origin_city, vals.origin_timezone,
    vals.destination_code, vals.destination_iata, vals.destination_icao, vals.destination_name, vals.destination_city, vals.destination_timezone,
    vals.scheduled_out_utc, vals.scheduled_in_utc, vals.aircraft_type, vals.cabin, vals.source_mode,
    JSON.stringify(s.raw ?? null)
  );
}

async function saveOption(request, DB) {
  const body = await request.json();
  const {
    id, search_id, booking_source = '', notes = '', segments = []
  } = body;

  if (!search_id) return json({ error: 'search_id is required' }, 400);

  let pricing;
  try { pricing = normalizePricing(body); }
  catch (e) { return json({ error: e.message }, 400); }

  const search = await DB.prepare('SELECT * FROM searches WHERE id = ?').bind(search_id).first();
  if (!search) return json({ error: 'Unknown search ID' }, 400);

  try { validateSegments(search, segments); }
  catch (e) { return json({ error: e.message }, 400); }

  let optionId;
  let optionNumber;
  let insertedNew = false;

  try {
    if (id) {
      const existing = await DB.prepare('SELECT id, option_number FROM fare_options WHERE id = ? AND search_id = ?')
        .bind(Number(id), search_id).first();
      if (!existing) return json({ error: 'Option not found.' }, 404);
      optionId = Number(existing.id);
      optionNumber = Number(existing.option_number);

      const statements = [
        DB.prepare(`
          UPDATE fare_options SET
            pricing_type=?, total_price=?, currency=?, points_amount=?, points_program=?, taxes_fees=?, taxes_currency=?,
            point_value_cents=?, comparison_value_usd=?, booking_source=?, notes=?, updated_at=CURRENT_TIMESTAMP
          WHERE id=?
        `).bind(
          pricing.pricing_type, pricing.total_price, pricing.currency, pricing.points_amount, pricing.points_program,
          pricing.taxes_fees, pricing.taxes_currency, pricing.point_value_cents, pricing.comparison_value_usd,
          booking_source, notes, optionId
        ),
        DB.prepare('DELETE FROM flight_segments WHERE option_id = ?').bind(optionId),
        ...segments.map((s, index) => segmentStatement(DB, optionId, s, index))
      ];
      await DB.batch(statements);
    } else {
      const n = await DB.prepare('SELECT COALESCE(MAX(option_number), 0) + 1 AS next_num FROM fare_options WHERE search_id = ?')
        .bind(search_id).first();
      optionNumber = Number(n?.next_num || 1);

      const inserted = await DB.prepare(`
        INSERT INTO fare_options
          (search_id, option_number, pricing_type, total_price, currency, points_amount, points_program, taxes_fees, taxes_currency,
           point_value_cents, comparison_value_usd, booking_source, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        search_id, optionNumber, pricing.pricing_type, pricing.total_price, pricing.currency,
        pricing.points_amount, pricing.points_program, pricing.taxes_fees, pricing.taxes_currency,
        pricing.point_value_cents, pricing.comparison_value_usd, booking_source, notes
      ).run();

      optionId = Number(inserted?.meta?.last_row_id);
      if (!Number.isFinite(optionId) || optionId <= 0) throw new Error('D1 did not return the new option ID.');
      insertedNew = true;
      await DB.batch(segments.map((s, index) => segmentStatement(DB, optionId, s, index)));
    }

    return json({ ok: true, id: optionId, option_number: optionNumber });
  } catch (e) {
    if (insertedNew && optionId) {
      try { await DB.prepare('DELETE FROM fare_options WHERE id = ?').bind(optionId).run(); } catch {}
    }
    throw e;
  }
}

export async function onRequest(context) {
  try {
    const DB = context.env?.DB;
    if (!DB) return json({ error: 'D1 binding DB is not configured.' }, 500);

    if (context.request.method === 'DELETE') return await deleteOption(context.request, DB);
    if (context.request.method === 'POST') return await saveOption(context.request, DB);
    return json({ error: 'Method not allowed' }, 405);
  } catch (e) {
    return errorJson(e, 'Save failed');
  }
}
