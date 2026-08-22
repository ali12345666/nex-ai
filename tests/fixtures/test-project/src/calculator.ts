/**
 * Test fixture: calculator module with an INTENTIONAL BUG.
 *
 * The `add` function has a typo — it returns a - b instead of a + b.
 * NEX AI Agent should detect this by:
 *   1. Running the test suite (which fails)
 *   2. Reading the source code
 *   3. Identifying the bug
 *   4. Proposing a fix
 *   5. Running tests again to verify
 */

export function add(a: number, b: number): number {
  // BUG: should be `a + b`
  return a - b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error('Division by zero');
  }
  return a / b;
}
