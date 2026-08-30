import { json, errorJson } from '../_lib/http.js';

export async function onRequest(context) {
  if (context.request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  try {
    const DB = context.env?.DB;
    if (!DB) return json({ error: 'D1 binding DB is not configured.' }, 500);

    const [searchRes, optionRes, segmentRes, permutationRes] = await Promise.all([
      DB.prepare('SELECT * FROM searches ORDER BY sort_order').all(),
      DB.prepare('SELECT * FROM fare_options ORDER BY search_id, option_number').all(),
      DB.prepare('SELECT * FROM flight_segments ORDER BY option_id, direction, segment_order').all(),
      DB.prepare('SELECT * FROM permutations ORDER BY variant').all()
    ]);

    const searches = searchRes.results || [];
    const options = optionRes.results || [];
    const segments = segmentRes.results || [];
    const permutations = permutationRes.results || [];

    const segByOption = new Map();
    for (const s of segments) {
      const key = String(s.option_id);
      if (!segByOption.has(key)) segByOption.set(key, []);
      segByOption.get(key).push(s);
    }

    const optionsWithSegments = options.map(o => ({
      ...o,
      segments: segByOption.get(String(o.id)) || []
    }));

    return json({ searches, options: optionsWithSegments, permutations });
  } catch (e) {
    return errorJson(e, 'Failed to load planner data');
  }
}
