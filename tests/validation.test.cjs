const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/apiHarness.cjs');
test('schedule validation rejects impossible dates, reversed dates and invalid times', () => {
  const { validateSchedule } = createHarness().load('src/utils/validation.js');
  const data = { dateFrom: '2026-10-07', dateTo: '2026-10-08', startTime: '08:00', endTime: '21:30' };
  assert.equal(validateSchedule(data, '2026-10-07'), null);
  for (const change of [{ dateFrom: '2026-02-30' }, { dateTo: '2026-10-06' }, { startTime: '8:00' }, { endTime: '24:00' }, { startTime: '22:00' }, { endTime: '08:00' }, { startTime: '08:60' }]) assert.ok(validateSchedule({ ...data, ...change }, '2026-10-07'));
});
test('leap dates and preferred seats are normalized without reordering preferences', () => {
  const { isValidDate, parsePreferredSeats } = createHarness().load('src/utils/validation.js');
  assert.equal(isValidDate('2028-02-29'), true);
  assert.equal(isValidDate('2026-02-29'), false);
  assert.deepEqual(Array.from(parsePreferredSeats(' 80，75,80, , ')), ['80', '75']);
});
test('local date is preserved at Beijing midnight, including tomorrow rollover', () => {
  const { formatDate } = createHarness().load('src/utils/time.js');
  assert.equal(formatDate(new Date(2026, 9, 7, 0, 1)), '2026-10-07');
  assert.equal(formatDate(new Date(2026, 11, 32, 0, 1)), '2027-01-01');
});
