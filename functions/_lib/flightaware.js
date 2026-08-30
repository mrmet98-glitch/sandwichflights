import { getAirportCached, putAirportCache } from './db.js';
import { addDaysISO, calendarDayDifference, durationMinutes, formatLocal, localDateISO } from './time.js';

const BASE = 'https://aeroapi.flightaware.com/aeroapi';

// AeroAPI's schedules endpoint filters on ICAO operator codes, while people
// normally enter the IATA flight number printed on their ticket.
const IATA_TO_ICAO = {
  AA: 'AAL', AC: 'ACA', AI: 'AIC', AS: 'ASA', BA: 'BAW', B6: 'JBU',
  DL: 'DAL', EK: 'UAE', EY: 'ETD', F9: 'FFT', LH: 'DLH', LX: 'SWR',
  QR: 'QTR', SQ: 'SIA', TK: 'THY', UA: 'UAL', WN: 'SWA', VS: 'VIR'
};

function apiKey(env) {
  const key = env?.FLIGHTAWARE_API_KEY;
  if (!key) throw new Error('FLIGHTAWARE_API_KEY is not configured in Cloudflare Pages Variables and Secrets.');
  return key;
}

async function faFetch(env, path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });

  const res = await fetch(url, { headers: { 'x-apikey': apiKey(env) } });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!res.ok) {
    const msg = data?.title || data?.detail || data?.error || `FlightAware returned HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

export function parseFlightNumber(input) {
  const normalized = String(input || '').toUpperCase().replace(/[\s-]/g, '');
  // An ICAO designator is three letters; passenger-facing IATA designators
  // are two alphanumeric characters. Do not greedily consume the first digit
  // of an IATA flight number as part of its airline (LH413 => LH + 413).
  const m = normalized.match(/^([A-Z]{3}|[A-Z0-9]{2})(\d{1,4}[A-Z]?)$/);
  if (!m) throw new Error('Enter a flight number like LH413, AI119, UA48, etc.');
  return {
    normalized,
    airline: m[1],
    scheduleAirline: IATA_TO_ICAO[m[1]] || m[1],
    flightNumber: m[2]
  };
}

function airportCodeFrom(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.code_icao || value.code_iata || value.code_lid || value.code || null;
}

async function airportInfo(env, code, inline = null) {
  if (inline && typeof inline === 'object' && inline.timezone) {
    return {
      airport_code: airportCodeFrom(inline) || code,
      code_iata: inline.code_iata || null,
      code_icao: inline.code_icao || null,
      name: inline.name || null,
      city: inline.city || null,
      timezone: inline.timezone
    };
  }

  if (!code) return null;
  const cached = await getAirportCached(env.DB, code);
  if (cached?.timezone) return cached;

  const data = await faFetch(env, `/airports/${encodeURIComponent(code)}`);
  const info = {
    airport_code: code,
    code_iata: data.code_iata || data.airport_code_iata || null,
    code_icao: data.code_icao || data.airport_code || (String(code).length === 4 ? code : null),
    name: data.name || null,
    city: data.city || null,
    timezone: data.timezone || null
  };
  await putAirportCache(env.DB, code, info);
  return info;
}

function identMatches(record, normalized) {
  const values = [record.ident_iata, record.ident_icao, record.ident, record.actual_ident_iata, record.actual_ident_icao, record.actual_ident]
    .filter(Boolean)
    .map(x => String(x).toUpperCase().replace(/[\s-]/g, ''));
  return values.includes(normalized);
}

function flightNumberMatches(record, flightNumber) {
  const wanted = String(flightNumber).replace(/[A-Z]$/, '').replace(/^0+/, '') || '0';
  const explicit = record.flight_number == null
    ? ''
    : String(record.flight_number).replace(/[A-Z]$/, '').replace(/^0+/, '');
  if (explicit && explicit === wanted) return true;

  // Schedule records are commonly identified with an ICAO ident (DLH413)
  // even when the passenger entered its IATA equivalent (LH413).
  const idents = [record.ident_iata, record.ident_icao, record.ident,
    record.actual_ident_iata, record.actual_ident_icao, record.actual_ident];
  return idents.filter(Boolean).some(value => {
    const match = String(value).toUpperCase().replace(/[\s-]/g, '').match(/(\d{1,4})[A-Z]?$/);
    return match && (match[1].replace(/^0+/, '') || '0') === wanted;
  });
}

function scoreMatch(record, normalized) {
  if (String(record.ident_iata || '').toUpperCase() === normalized) return 100;
  if (String(record.actual_ident_iata || '').toUpperCase() === normalized) return 90;
  if (String(record.ident || '').toUpperCase() === normalized) return 80;
  if (String(record.ident_icao || '').toUpperCase() === normalized) return 70;
  if (String(record.actual_ident || '').toUpperCase() === normalized) return 60;
  return 10;
}

async function normalizeRecord(env, record, requestedDate, enteredFlightNumber, sourceMode) {
  const originRaw = record.origin;
  const destRaw = record.destination;
  const originCode = airportCodeFrom(originRaw) || record.origin_icao || record.origin_iata || record.origin_lid;
  const destinationCode = airportCodeFrom(destRaw) || record.destination_icao || record.destination_iata || record.destination_lid;

  const [origin, destination] = await Promise.all([
    airportInfo(env, originCode, typeof originRaw === 'object' ? originRaw : null),
    airportInfo(env, destinationCode, typeof destRaw === 'object' ? destRaw : null)
  ]);

  const scheduledOut = record.scheduled_out || record.estimated_out || record.actual_out;
  const scheduledIn = record.scheduled_in || record.estimated_in || record.actual_in;
  const originTimezone = origin?.timezone || (typeof originRaw === 'object' ? originRaw.timezone : null);
  const destinationTimezone = destination?.timezone || (typeof destRaw === 'object' ? destRaw.timezone : null);
  const departureLocalDate = localDateISO(scheduledOut, originTimezone);
  const arrivalLocalDate = localDateISO(scheduledIn, destinationTimezone);
  const dayChange = calendarDayDifference(departureLocalDate, arrivalLocalDate);

  return {
    entered_date: requestedDate,
    entered_flight_number: enteredFlightNumber,
    ident: record.ident || null,
    ident_iata: record.ident_iata || null,
    ident_icao: record.ident_icao || null,
    actual_ident: record.actual_ident || record.actual_ident_iata || null,
    origin_code: originCode || null,
    origin_iata: origin?.code_iata || record.origin_iata || (typeof originRaw === 'object' ? originRaw.code_iata : null) || null,
    origin_icao: origin?.code_icao || record.origin_icao || (typeof originRaw === 'object' ? originRaw.code_icao : null) || null,
    origin_name: origin?.name || (typeof originRaw === 'object' ? originRaw.name : null) || null,
    origin_city: origin?.city || (typeof originRaw === 'object' ? originRaw.city : null) || null,
    origin_timezone: originTimezone || null,
    destination_code: destinationCode || null,
    destination_iata: destination?.code_iata || record.destination_iata || (typeof destRaw === 'object' ? destRaw.code_iata : null) || null,
    destination_icao: destination?.code_icao || record.destination_icao || (typeof destRaw === 'object' ? destRaw.code_icao : null) || null,
    destination_name: destination?.name || (typeof destRaw === 'object' ? destRaw.name : null) || null,
    destination_city: destination?.city || (typeof destRaw === 'object' ? destRaw.city : null) || null,
    destination_timezone: destinationTimezone || null,
    scheduled_out_utc: scheduledOut || null,
    scheduled_in_utc: scheduledIn || null,
    departure_local: formatLocal(scheduledOut, originTimezone),
    arrival_local: formatLocal(scheduledIn, destinationTimezone),
    departure_local_date: departureLocalDate,
    arrival_local_date: arrivalLocalDate,
    arrival_day_change: dayChange,
    duration_minutes: durationMinutes(scheduledOut, scheduledIn),
    aircraft_type: record.aircraft_type || null,
    source_mode: sourceMode,
    score: scoreMatch(record, enteredFlightNumber),
    raw: record
  };
}

async function lookupSchedule(env, parsed, requestedDate) {
  const start = addDaysISO(requestedDate, -1);
  const end = addDaysISO(requestedDate, 2);
  const data = await faFetch(env, `/schedules/${start}/${end}`, {
    airline: parsed.scheduleAirline,
    flight_number: parsed.flightNumber.replace(/[A-Z]$/, ''),
    include_codeshares: 'true',
    max_pages: 2
  });
  const records = data.scheduled || data.flights || [];
  const likely = records.filter(r => identMatches(r, parsed.normalized) || flightNumberMatches(r, parsed.flightNumber));
  // Never enrich every record returned by a broad schedule response. Besides
  // producing false matches, that can turn one lookup into dozens of airport
  // requests and exhaust AeroAPI's per-minute allowance.
  const normalized = await Promise.all(likely.map(r => normalizeRecord(env, r, requestedDate, parsed.normalized, 'schedule')));
  return normalized.filter(r => r.departure_local_date === requestedDate).sort((a,b) => b.score - a.score);
}

async function lookupActive(env, parsed, requestedDate) {
  const start = `${addDaysISO(requestedDate, -1)}T00:00:00Z`;
  const end = `${addDaysISO(requestedDate, 2)}T23:59:59Z`;
  const data = await faFetch(env, `/flights/${encodeURIComponent(parsed.normalized)}`, { start, end, max_pages: 2 });
  const records = data.flights || [];
  const normalized = await Promise.all(records.map(r => normalizeRecord(env, r, requestedDate, parsed.normalized, 'active')));
  return normalized.filter(r => r.departure_local_date === requestedDate).sort((a,b) => b.score - a.score);
}

export async function lookupFlight(env, flightNumber, requestedDate) {
  if (!env?.DB) throw new Error('Cloudflare D1 binding DB is not configured for this Pages project.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate || '')) throw new Error('Date must be YYYY-MM-DD.');

  const parsed = parseFlightNumber(flightNumber);
  const requested = new Date(`${requestedDate}T12:00:00Z`);
  const now = new Date();
  const daysAway = (requested - now) / 86400000;

  let matches = [];
  const attempted = [];
  if (daysAway <= 2.5) {
    attempted.push('active');
    try { matches = await lookupActive(env, parsed, requestedDate); } catch (e) {
      if (![400,404].includes(e.status)) throw e;
    }
  }
  if (!matches.length) {
    attempted.push('schedule');
    matches = await lookupSchedule(env, parsed, requestedDate);
  }

  return {
    query: { flight_number: parsed.normalized, requested_date: requestedDate },
    attempted,
    matches
  };
}
