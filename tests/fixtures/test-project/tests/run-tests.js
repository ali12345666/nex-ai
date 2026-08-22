/**
 * Test suite for calculator.ts
 *
 * These tests will FAIL because of the intentional bug in `add()`.
 * The Agent should detect this and propose a fix.
 */

const { add, subtract, multiply, divide } = require('../dist/calculator');

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  PASS: ${name}`);
  } catch (err) {
    fail++;
    console.log(`  FAIL: ${name} — ${err.message}`);
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || ''} expected ${expected}, got ${actual}`);
  }
}

console.log('\n=== Calculator Tests ===\n');

test('add: 2 + 3 = 5', () => {
  assertEqual(add(2, 3), 5, 'add(2,3)');
});

test('add: 0 + 0 = 0', () => {
  assertEqual(add(0, 0), 0, 'add(0,0)');
});

test('add: -1 + 1 = 0', () => {
  assertEqual(add(-1, 1), 0, 'add(-1,1)');
});

test('subtract: 5 - 3 = 2', () => {
  assertEqual(subtract(5, 3), 2, 'subtract(5,3)');
});

test('multiply: 3 * 4 = 12', () => {
  assertEqual(multiply(3, 4), 12, 'multiply(3,4)');
});

test('divide: 10 / 2 = 5', () => {
  assertEqual(divide(10, 2), 5, 'divide(10,2)');
});

test('divide by zero throws', () => {
  let threw = false;
  try { divide(1, 0); } catch { threw = true; }
  if (!threw) throw new Error('divide(1,0) should throw');
});

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);
