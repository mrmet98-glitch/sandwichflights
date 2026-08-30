import test from 'node:test';
import assert from 'node:assert/strict';
import { enumerateBookingStructures, buildOptimizerPlans, canonicalAirport } from '../public/optimizer.js';

const searches = [
  ['O8','One Way','2026-10-08','NYC','BOM',null,null,null],
  ['O9','One Way','2026-10-09','NYC','BOM',null,null,null],
  ['OD','One Way','2026-12-11','NYC','BOM',null,null,null],
  ['OF5','One Way','2027-02-05','NYC','BOM',null,null,null],
  ['OF25','One Way','2027-02-25','NYC','BOM',null,null,null],
  ['D','Round Trip','2026-12-11','NYC','BOM','2027-01-05','BOM','NYC'],
  ['H','Open-Jaw RT','2027-02-05','NYC','BOM','2027-02-16','DEL','NYC'],
  ['L','Round Trip','2027-02-25','NYC','BOM','2027-03-02','BOM','NYC'],
].map((x,i)=>({ id:x[0],ticket_type:x[1],leg1_date:x[2],leg1_origin:x[3],leg1_destination:x[4],leg2_date:x[5],leg2_origin:x[6],leg2_destination:x[7],sort_order:i+1 }));

test('NYC-area airports canonicalize to NYC', () => {
  assert.equal(canonicalAirport('JFK'), 'NYC');
  assert.equal(canonicalAirport('EWR'), 'NYC');
  assert.equal(canonicalAirport('BOM'), 'BOM');
});

test('custom exact-cover engine finds a valid sandwich structure', () => {
  const structures = enumerateBookingStructures(searches, '2026-10-08');
  assert.ok(structures.some(ids => ['O8','D','H','L'].every(id => ids.includes(id))));
});

test('optimizer ranks complete plans by comparison USD and exposes partial plans', () => {
  const options = [
    {search_id:'O8',comparison_value_usd:'800'},
    {search_id:'D',comparison_value_usd:'1100'},
    {search_id:'H',comparison_value_usd:'900'},
    {search_id:'L',comparison_value_usd:'700'},
  ];
  const plans = buildOptimizerPlans(searches, options);
  const best = plans.find(p => p.complete && p.octDate === '2026-10-08');
  assert.ok(best);
  assert.equal(best.totalValue, 3500);
  assert.ok(plans.some(p => !p.complete));
});
