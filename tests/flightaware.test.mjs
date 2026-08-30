import test from 'node:test';
import assert from 'node:assert/strict';

import { lookupFlight, parseFlightNumber } from '../functions/_lib/flightaware.js';

test('converts common passenger-facing IATA operators for schedule lookups', () => {
  assert.deepEqual(parseFlightNumber('LH413'), {
    normalized: 'LH413',
    airline: 'LH',
    scheduleAirline: 'DLH',
    flightNumber: '413'
  });
});

test('keeps an ICAO operator unchanged', () => {
  assert.deepEqual(parseFlightNumber('DLH413'), {
    normalized: 'DLH413',
    airline: 'DLH',
    scheduleAirline: 'DLH',
    flightNumber: '413'
  });
});

test('looks up an IATA flight with its ICAO schedule operator', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async url => {
    requested.push(String(url));
    return new Response(JSON.stringify({ scheduled: [{
      ident: 'DLH413',
      ident_icao: 'DLH413',
      flight_number: '413',
      origin: { code: 'KJFK', code_iata: 'JFK', timezone: 'America/New_York' },
      destination: { code: 'EDDM', code_iata: 'MUC', timezone: 'Europe/Berlin' },
      scheduled_out: '2099-10-08T20:00:00Z',
      scheduled_in: '2099-10-09T03:30:00Z'
    }] }), { status: 200 });
  };

  try {
    const result = await lookupFlight({ DB: {}, FLIGHTAWARE_API_KEY: 'test' }, 'LH413', '2099-10-08');
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].ident_icao, 'DLH413');
    assert.match(requested[0], /airline=DLH/);
    assert.equal(requested.length, 1, 'inline airport data should not cause extra API requests');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
