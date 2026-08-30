export function formatLocal(utcIso, timeZone) {
  if (!utcIso || !timeZone) return null;
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  });
  return fmt.format(d);
}

export function localDateISO(utcIso, timeZone) {
  if (!utcIso || !timeZone) return null;
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function calendarDayDifference(startLocalDate, endLocalDate) {
  if (!startLocalDate || !endLocalDate) return null;
  const a = Date.parse(`${startLocalDate}T12:00:00Z`);
  const b = Date.parse(`${endLocalDate}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function durationMinutes(startUtc, endUtc) {
  if (!startUtc || !endUtc) return null;
  const a = Date.parse(startUtc);
  const b = Date.parse(endUtc);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 60000);
}

export function humanDuration(minutes) {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '—';
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h ${String(m).padStart(2, '0')}m`;
}

export function addDaysISO(dateISO, days) {
  const d = new Date(`${dateISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
