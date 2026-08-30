export async function getAirportCached(DB, code) {
  if (!DB || !code) return null;
  return await DB.prepare(`
    SELECT airport_code, code_iata, code_icao, name, city, timezone, updated_at
    FROM airport_cache
    WHERE airport_code = ?
  `).bind(code).first();
}

export async function putAirportCache(DB, code, info) {
  if (!DB || !code) return;
  await DB.prepare(`
    INSERT INTO airport_cache (airport_code, code_iata, code_icao, name, city, timezone, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(airport_code) DO UPDATE SET
      code_iata = excluded.code_iata,
      code_icao = excluded.code_icao,
      name = excluded.name,
      city = excluded.city,
      timezone = excluded.timezone,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    code,
    info.code_iata ?? null,
    info.code_icao ?? null,
    info.name ?? null,
    info.city ?? null,
    info.timezone ?? null
  ).run();
}
