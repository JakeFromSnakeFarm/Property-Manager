/**
 * Run: node tests/metrics.test.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const metricsPath = path.join(__dirname, '..', 'metrics.js');
const code = fs.readFileSync(metricsPath, 'utf8');
const sandbox = { window: {}, globalThis: {} };
sandbox.window = sandbox.globalThis;
vm.runInNewContext(code, sandbox);
const Metrics = sandbox.Metrics || sandbox.window.Metrics;
if (!Metrics) throw new Error('Metrics module failed to load');

const config = {
  tracking_start: '2025-10-01',
  handyman_day_rate: 150,
  handyman_hourly_rate: 75,
};

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Completed reimbursed item
const completed = {
  status: 'completed',
  labor_time: 2,
  labor_cost_estimate: 100,
  parts_cost: 50,
  my_cost: 40,
  include_in_value_total: true,
  value_added_low: 500,
  value_added_high: 800,
};

const open = {
  status: 'new',
  labor_time: 4,
  labor_cost_estimate: 100,
  parts_cost: 100,
  my_cost: 0,
};

assert(Metrics.marketEstimate(completed) === 250, 'market estimate');
assert(Metrics.itemSavings(completed) === 210, 'item savings');
assert(Metrics.potentialSavings(open) === 500, 'potential savings');
assert(Metrics.itemSavings(open) === 0, 'open item no confirmed savings');

const m = Metrics.computeMetrics([completed, open], config, new Date('2026-01-01T12:00:00Z'));
assert(m.totalSavings === 210, 'total savings completed only');
assert(m.totalReimbursed === 40, 'total reimbursed');
assert(m.contractorCostAvoided === 250, 'contractor cost avoided');
assert(m.potentialSavingsTotal === 500, 'potential separate');
assert(m.valueAddedLowTotal === 500, 'value added low');
assert(m.partsShare === 20, 'parts share 50/250');

const zeroCost = {
  status: 'completed',
  labor_time: 0,
  labor_cost_estimate: 0,
  parts_cost: 0,
  my_cost: 0,
};
assert(Metrics.itemSavings(zeroCost) === 0, 'zero cost item');

console.log('All metrics tests passed.');
