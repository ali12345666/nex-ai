/**
 * CalculationTool — calculation
 *
 * Evaluates a math expression safely (no eval).
 * Supports: +, -, *, /, **, %, parentheses, basic functions (sin, cos, sqrt, etc.).
 *
 * IMPORTANT: Engineering calculations must NOT be done by LLMs — they hallucinate
 * numbers. The agent delegates calculations to this tool and verifies the result.
 */

import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

export class CalculationTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'calculation',
    description: 'Evaluate a mathematical expression and return the numeric result. Supports + - * / ** %, parentheses, and functions: sin, cos, tan, sqrt, abs, log, log10, exp, floor, ceil, round, atan2, pow. Constants: pi, e. Does NOT support eval, function definitions, or arbitrary code.',
    category: 'calculation',
    permission: 'read',  // calculation is non-destructive
    parameters: [
      {
        name: 'expression',
        type: 'string',
        description: 'Math expression to evaluate, e.g. "2 + 2 * 3", "sin(pi/4) + sqrt(2)"',
        required: true,
      },
      {
        name: 'precision',
        type: 'number',
        description: 'Number of decimal places (default: 6)',
        default: 6,
      },
    ],
    returns: { type: 'object', description: '{ value, originalExpression }' },
    tags: ['calculation', 'math'],
  };

  async execute(params: Record<string, any>, _context: ToolContext): Promise<ToolResult> {
    const expr = params.expression;
    if (!expr) {
      return { success: false, error: 'Missing required parameter: expression' };
    }
    try {
      const value = safeMathEval(expr);
      const precision = Math.max(0, Math.min(15, params.precision ?? 6));
      const rounded = typeof value === 'number' ? Number(value.toFixed(precision)) : value;
      return {
        success: true,
        output: `${expr} = ${rounded}`,
        data: { value: rounded, originalExpression: expr },
      };
    } catch (err: any) {
      return { success: false, error: `Calculation failed: ${err.message}` };
    }
  }
}

// ─── Safe Math Evaluator (no eval, no Function constructor) ──────────────────

const ALLOWED_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sqrt: Math.sqrt, abs: Math.abs,
  log: Math.log, log10: Math.log10, log2: Math.log2, exp: Math.exp,
  floor: Math.floor, ceil: Math.ceil, round: Math.round,
  pow: Math.pow, max: Math.max, min: Math.min,
  sign: Math.sign, hypot: Math.hypot,
};

const ALLOWED_CONSTANTS: Record<string, number> = {
  pi: Math.PI, e: Math.E, tau: Math.PI * 2, phi: 1.618033988749895,
};

/**
 * Tokenize and evaluate a math expression using a recursive descent parser.
 * No eval(), no Function() — pure TypeScript.
 */
function safeMathEval(expr: string): number {
  // Strip whitespace
  const input = expr.replace(/\s+/g, '').toLowerCase();
  let pos = 0;

  function peek(): string {
    return input[pos] || '';
  }
  function consume(): string {
    return input[pos++] || '';
  }
  function eof(): boolean {
    return pos >= input.length;
  }

  function parseExpression(): number {
    let left = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parseFactor();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = consume();
      const right = parseFactor();
      if (op === '*') left *= right;
      else if (op === '/') {
        if (right === 0) throw new Error('Division by zero');
        left /= right;
      } else {
        if (right === 0) throw new Error('Modulo by zero');
        left %= right;
      }
    }
    return left;
  }

  function parseFactor(): number {
    let left = parseUnary();
    // Power operator: ** (with 2-char lookahead, so single * is handled by parseTerm)
    while (pos + 1 < input.length && input[pos] === '*' && input[pos + 1] === '*') {
      consume(); // first *
      consume(); // second *
      const right = parseFactor(); // right-associative: 2**3**2 = 2**(3**2)
      left = Math.pow(left, right);
    }
    return left;
  }

  function parseUnary(): number {
    if (peek() === '-') {
      consume();
      return -parseUnary();
    }
    if (peek() === '+') {
      consume();
      return parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    // Parenthesized expression
    if (peek() === '(') {
      consume();
      const value = parseExpression();
      if (peek() !== ')') throw new Error('Expected closing )');
      consume();
      return value;
    }
    // Number
    if (/[0-9.]/.test(peek())) {
      let num = '';
      while (/[0-9.]/.test(peek())) num += consume();
      // Optional exponent
      if (peek() === 'e') {
        num += consume();
        if (peek() === '+' || peek() === '-') num += consume();
        while (/[0-9]/.test(peek())) num += consume();
      }
      const value = parseFloat(num);
      if (isNaN(value)) throw new Error(`Invalid number: ${num}`);
      return value;
    }
    // Identifier (function call or constant)
    if (/[a-z_]/.test(peek())) {
      let name = '';
      while (/[a-z0-9_]/.test(peek())) name += consume();
      // Function call
      if (peek() === '(') {
        consume();
        const args: number[] = [];
        if (peek() !== ')') {
          args.push(parseExpression());
          while (peek() === ',') {
            consume();
            args.push(parseExpression());
          }
        }
        if (peek() !== ')') throw new Error(`Expected ) after function args`);
        consume();
        const fn = ALLOWED_FUNCTIONS[name];
        if (!fn) throw new Error(`Unknown function: ${name}`);
        return fn(...args);
      }
      // Constant
      if (name in ALLOWED_CONSTANTS) {
        return ALLOWED_CONSTANTS[name];
      }
      throw new Error(`Unknown identifier: ${name}`);
    }
    throw new Error(`Unexpected character: ${peek()}`);
  }

  const result = parseExpression();
  if (!eof()) throw new Error(`Unexpected trailing input at position ${pos}`);
  return result;
}
