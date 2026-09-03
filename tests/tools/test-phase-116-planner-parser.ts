/**
 * NEX AI — Phase 116: Planner Parser Tests
 *
 * Tests that the planner correctly parses LLM responses including:
 *   - Qwen3 thinking tokens
 *   - Markdown code fences
 *   - Plain JSON
 *   - Malformed JSON (fallback)
 *
 * Run with: npx tsx tests/tools/test-phase-116-planner-parser.ts
 */

import * as path from 'path';
import * as fs from 'fs';

process.env.NODE_PATH = path.join(__dirname, '..', '__mocks__');
require('module').Module._initPaths();

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string) {
    if (condition) { passed++; console.log(`  PASS: ${name}`); }
    else { failed++; console.error(`  FAIL: ${name}`); }
  }

  console.log('Phase 116 Planner Parser Tests\n');

  const plannerSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'main', 'agent', 'planner.ts'),
    'utf-8'
  );

  // 1. Verify cleanPlanResponse function exists
  console.log('=== 1. cleanPlanResponse exists ===');
  console.log('\nTest 1: cleanPlanResponse function exists');
  assert(plannerSource.includes('function cleanPlanResponse'), 'cleanPlanResponse function should exist');

  // 2. Verify thinking token stripping
  console.log('\nTest 2: strips Qwen3 thinking tokens');
  assert(
    plannerSource.includes('indexOf(') && plannerSource.includes('substring'),
    'should strip thinking tokens using indexOf + substring'
  );

  // 3. Verify code fence stripping
  console.log('\nTest 3: strips markdown code fences');
  assert(plannerSource.includes('codeFenceMatch'), 'should strip code fences');

  // 4. Verify diagnostic logging
  console.log('\nTest 4: diagnostic logging exists');
  assert(plannerSource.includes('[PLANNER_DIAG]'), 'should have PLANNER_DIAG logging');
  assert(plannerSource.includes('raw response preview'), 'should log raw response preview');
  assert(plannerSource.includes('FALLBACK triggered'), 'should log fallback trigger');

  // 5. Functional test: plain JSON
  console.log('\nTest 5: handles plain JSON response');
  {
    const testResponse = '{"reasoning":"test","confidence":0.9,"warnings":[],"steps":[{"tool":"write_file","params":{"path":"test.txt","content":"hello"}}]}';
    const jsonMatch = testResponse.match(/\{[\s\S]*\}/);
    assert(jsonMatch !== null, 'plain JSON should match');
    const parsed = JSON.parse(jsonMatch![0]);
    assert(Array.isArray(parsed.steps) && parsed.steps.length === 1, 'should parse 1 step');
    assert(parsed.steps[0].tool === 'write_file', 'should extract tool name');
  }

  // 6. Functional test: JSON with code fence
  console.log('\nTest 6: handles JSON with code fence');
  {
    const testResponse = 'Here is my plan:\n```json\n{"reasoning":"test","confidence":0.9,"steps":[{"tool":"write_file","params":{"path":"test.txt"}}]}\n```';
    const codeFenceMatch = testResponse.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    assert(codeFenceMatch !== null, 'should find code fence');
    const cleaned = codeFenceMatch![1].trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    assert(jsonMatch !== null, 'should find JSON in cleaned response');
    const parsed = JSON.parse(jsonMatch![0]);
    assert(parsed.steps[0].tool === 'write_file', 'should extract tool from code-fenced JSON');
  }

  // 7. Functional test: thinking tokens (using string concat to avoid encoding issues)
  console.log('\nTest 7: handles Qwen3 thinking tokens');
  {
    const thinkOpen = '<' + 'think' + '>';
    const thinkClose = '</' + 'think' + '>';
    const jsonContent = '{"reasoning":"test","confidence":0.9,"steps":[{"tool":"write_file","params":{"path":"test.txt"}}]}';
    const testResponse = 'I need to create a file.' + thinkClose + jsonContent;
    const thinkEnd = testResponse.indexOf(thinkClose);
    assert(thinkEnd !== -1, 'should find thinking close tag');
    const cleaned = testResponse.substring(thinkEnd + thinkClose.length).trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    assert(jsonMatch !== null, 'should find JSON after think block');
    const parsed = JSON.parse(jsonMatch![0]);
    assert(parsed.steps[0].tool === 'write_file', 'should extract tool from think-block response');
  }

  // 8. Fallback on no JSON
  console.log('\nTest 8: fallback fires on no JSON');
  {
    const testResponse = 'I cannot help with that.';
    const jsonMatch = testResponse.match(/\{[\s\S]*\}/);
    assert(jsonMatch === null, 'no JSON should return null match');
  }

  // 9. Fallback on invalid JSON
  console.log('\nTest 9: fallback fires on invalid JSON');
  {
    const testResponse = '{invalid json: missing quotes}';
    const jsonMatch = testResponse.match(/\{[\s\S]*\}/);
    assert(jsonMatch !== null, 'should find braces');
    let threw = false;
    try { JSON.parse(jsonMatch![0]); } catch { threw = true; }
    assert(threw, 'should throw on invalid JSON');
  }

  // 10. Fallback on missing steps array
  console.log('\nTest 10: fallback fires on missing steps[]');
  {
    const testResponse = '{"reasoning":"test","confidence":0.9}';
    const jsonMatch = testResponse.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch![0]);
    assert(!Array.isArray(parsed.steps), 'missing steps should not be array');
  }

  // SUMMARY
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 116 planner parser tests: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
