export const REQUIRED_TRIPS = [
  { key: 'OCT', alternatives: [
    { date: '2026-10-08', origin: 'NYC', destination: 'BOM' },
    { date: '2026-10-09', origin: 'NYC', destination: 'BOM' }
  ]},
  { key: 'DEC11', date: '2026-12-11', origin: 'NYC', destination: 'BOM' },
  { key: 'JAN05', date: '2027-01-05', origin: 'BOM', destination: 'NYC' },
  { key: 'FEB05', date: '2027-02-05', origin: 'NYC', destination: 'BOM' },
  { key: 'FEB16', date: '2027-02-16', origin: 'DEL', destination: 'NYC' },
  { key: 'FEB25', date: '2027-02-25', origin: 'NYC', destination: 'BOM' },
  { key: 'MAR02', date: '2027-03-02', origin: 'BOM', destination: 'NYC' }
];

const NYC_CODES = new Set(['NYC','JFK','EWR','LGA','HPN']);
export function canonicalAirport(v='') {
  const c = String(v || '').trim().toUpperCase();
  return NYC_CODES.has(c) ? 'NYC' : c;
}

export function movementKey(date, origin, destination) {
  return `${date}|${canonicalAirport(origin)}|${canonicalAirport(destination)}`;
}

export function asNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function optionComparisonValue(option) {
  return asNumber(option?.comparison_value_usd);
}

export function bestOptionForSearch(options, searchId) {
  return options
    .filter(o => o.search_id === searchId && optionComparisonValue(o) !== null)
    .sort((a,b) => optionComparisonValue(a) - optionComparisonValue(b))[0] || null;
}

function legsForSearch(search) {
  const legs = [{ date: search.leg1_date, origin: search.leg1_origin, destination: search.leg1_destination }];
  if (search.leg2_date) legs.push({ date: search.leg2_date, origin: search.leg2_origin, destination: search.leg2_destination });
  return legs;
}

function targetsForOctDate(octDate) {
  return [
    { date: octDate, origin: 'NYC', destination: 'BOM' },
    ...REQUIRED_TRIPS.slice(1).map(x => ({ date: x.date, origin: x.origin, destination: x.destination }))
  ];
}

export function enumerateBookingStructures(searches, octDate, limit = 5000) {
  const targets = targetsForOctDate(octDate);
  const targetIndex = new Map(targets.map((x,i) => [movementKey(x.date,x.origin,x.destination), i]));
  const fullMask = (1 << targets.length) - 1;
  const candidates = [];

  for (const s of searches) {
    const legs = legsForSearch(s);
    let mask = 0;
    let valid = true;
    for (const leg of legs) {
      const idx = targetIndex.get(movementKey(leg.date,leg.origin,leg.destination));
      if (idx === undefined || (mask & (1 << idx))) { valid = false; break; }
      mask |= 1 << idx;
    }
    if (valid && mask) candidates.push({ search: s, mask });
  }

  const byBit = Array.from({ length: targets.length }, () => []);
  candidates.forEach(c => {
    for (let i=0;i<targets.length;i++) if (c.mask & (1<<i)) byBit[i].push(c);
  });

  const results = [];
  function walk(mask, chosen) {
    if (results.length >= limit) return;
    if (mask === fullMask) {
      results.push([...chosen]);
      return;
    }
    let bit = 0;
    while (mask & (1 << bit)) bit++;
    for (const c of byBit[bit]) {
      if ((c.mask & mask) !== 0) continue;
      chosen.push(c.search.id);
      walk(mask | c.mask, chosen);
      chosen.pop();
    }
  }
  walk(0, []);

  const unique = new Map();
  for (const ids of results) {
    const sorted = [...ids].sort();
    unique.set(sorted.join('|'), sorted);
  }
  return [...unique.values()];
}

export function buildOptimizerPlans(searches, options) {
  const best = new Map(searches.map(s => [s.id, bestOptionForSearch(options, s.id)]));
  const all = [];
  for (const octDate of ['2026-10-08','2026-10-09']) {
    const structures = enumerateBookingStructures(searches, octDate);
    for (const ids of structures) {
      const selected = ids.map(id => ({ search: searches.find(s => s.id === id), option: best.get(id) || null }));
      const missing = selected.filter(x => !x.option).map(x => x.search.id);
      const knownValue = selected.reduce((sum,x) => sum + (x.option ? optionComparisonValue(x.option) : 0), 0);
      all.push({ octDate, ids, selected, missing, complete: missing.length === 0, knownValue, totalValue: missing.length ? null : knownValue });
    }
  }
  return all.sort((a,b) => {
    if (a.complete !== b.complete) return a.complete ? -1 : 1;
    if (a.complete) return a.totalValue - b.totalValue;
    if (a.missing.length !== b.missing.length) return a.missing.length - b.missing.length;
    return a.knownValue - b.knownValue;
  });
}
