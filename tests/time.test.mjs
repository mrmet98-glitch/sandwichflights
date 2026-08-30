import test from 'node:test';
import assert from 'node:assert/strict';
import { localDateISO, durationMinutes, calendarDayDifference } from '../functions/_lib/time.js';

test('JFK UTC converts to prior local calendar date when appropriate', () => {
  assert.equal(localDateISO('2027-02-05T01:30:00Z','America/New_York'),'2027-02-04');
});

test('Mumbai half-hour timezone is handled by IANA timezone', () => {
  assert.equal(localDateISO('2027-02-05T20:00:00Z','Asia/Kolkata'),'2027-02-06');
});

test('layovers are calculated from UTC instants, independent of local date changes', () => {
  assert.equal(durationMinutes('2027-02-06T09:00:00Z','2027-02-06T11:15:00Z'),135);
});

test('calendar day change label can be computed between localized dates', () => {
  assert.equal(calendarDayDifference('2027-02-05','2027-02-06'),1);
});
