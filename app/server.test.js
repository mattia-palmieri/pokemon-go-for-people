// Unit tests for the game's pure helpers. Run: cd app && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { rarity, metersBetween, heat } = require('./server');

test('rarity: share of the crowd sets the tier', () => {
  assert.equal(rarity(10, 2000), 'legendary'); // 0.5%
  assert.equal(rarity(100, 2000), 'rare'); // 5%
  assert.equal(rarity(1800, 2000), 'common'); // 90%, e.g. Kubernetes
});

test('metersBetween: same point is 0 m, venue zones are tens of metres apart', () => {
  const keynote = { lat: 40.7676, lon: -111.8954 };
  const expo = { lat: 40.7666, lon: -111.8947 };
  assert.equal(metersBetween(keynote, keynote), 0);
  const d = metersBetween(keynote, expo);
  assert.ok(d > 100 && d < 150, `expected ~125 m, got ${d}`);
});

test('heat: hot / warm / cold by distance', () => {
  assert.equal(heat(10), 'hot');
  assert.equal(heat(60), 'warm');
  assert.equal(heat(500), 'cold');
});
