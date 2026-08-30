import { lookupFlight } from '../_lib/flightaware.js';
import { json, errorJson } from '../_lib/http.js';

export async function onRequest(context) {
  if (context.request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const { flight_number, date } = await context.request.json();
    const data = await lookupFlight(context.env, flight_number, date);
    if (!data.matches.length) {
      return json({
        ...data,
        error: `No published ${flight_number} schedule matched local departure date ${date}. Check the flight number/date or try again after the airline publishes/updates its schedule.`
      }, 404);
    }
    return json(data);
  } catch (e) {
    return errorJson(e, 'Flight lookup failed');
  }
}
