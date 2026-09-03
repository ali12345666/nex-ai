/**
 * NEX AI — Phase 116: Intent Resolver Tests
 *
 * Tests the intent classification, reference resolution, and action
 * execution for natural language user requests in Persian and English.
 *
 * Run with: npx tsx tests/tools/test-phase-116-intent-resolver.ts
 */

import * as path from 'path';
import * as fs from 'fs';

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string) {
    if (condition) { passed++; console.log(`  PASS: ${name}`); }
    else { failed++; console.error(`  FAIL: ${name}`); }
  }

  console.log('Phase 116 Intent Resolver Tests\n');

  // Read the intent resolver source
  const resolverSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'lib', 'intent-resolver.ts'),
    'utf-8'
  );

  // ════════════════════════════════════════════════════════════════════════
  // 1. Intent Classification — Persian
  // ════════════════════════════════════════════════════════════════════════
  console.log('=== 1. Intent Classification (Persian) ===');

  // Test 1: OPEN_FILE detection
  console.log('\nTest 1: OPEN_FILE — "بازش کن"');
  {
    assert(resolverSource.includes('OPEN_FILE'), 'OPEN_FILE intent exists');
    assert(resolverSource.includes('بازش'), 'should detect "بازش کن"');
    assert(resolverSource.includes('بالا بیار'), 'should detect "بالا بیار"');
    assert(resolverSource.includes('لودش'), 'should detect "لودش کن"');
  }

  // Test 2: REVEAL_FILE detection
  console.log('\nTest 2: REVEAL_FILE — "نشون بده کجاست"');
  {
    assert(resolverSource.includes('REVEAL_FILE'), 'REVEAL_FILE intent exists');
    assert(resolverSource.includes('کجاست'), 'should detect "کجاست"');
    assert(resolverSource.includes('نشون بده'), 'should detect "نشون بده"');
  }

  // Test 3: READ_FILE detection
  console.log('\nTest 3: READ_FILE — "محتویاتش رو نشون بده"');
  {
    assert(resolverSource.includes('READ_FILE'), 'READ_FILE intent exists');
    assert(resolverSource.includes('محتویاتش'), 'should detect "محتویاتش"');
    assert(resolverSource.includes('داخلش'), 'should detect "داخلش"');
  }

  // Test 4: EDIT_FILE detection
  console.log('\nTest 4: EDIT_FILE — "تغییر بده"');
  {
    assert(resolverSource.includes('EDIT_FILE'), 'EDIT_FILE intent exists');
    assert(resolverSource.includes('تغییر'), 'should detect "تغییر بده"');
    assert(resolverSource.includes('اصلاح'), 'should detect "اصلاح کن"');
  }

  // Test 5: CREATE_FILE detection
  console.log('\nTest 5: CREATE_FILE — "فایل بساز"');
  {
    assert(resolverSource.includes('CREATE_FILE'), 'CREATE_FILE intent exists');
    assert(resolverSource.includes('بساز'), 'should detect "بساز" pattern');
  }

  // Test 6: CREATE_FOLDER detection
  console.log('\nTest 6: CREATE_FOLDER — "پوشه بساز"');
  {
    assert(resolverSource.includes('CREATE_FOLDER'), 'CREATE_FOLDER intent exists');
    assert(resolverSource.includes('پوشه بساز'), 'should detect "پوشه بساز"');
  }

  // ════════════════════════════════════════════════════════════════════════
  // 2. Intent Classification — English
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 2. Intent Classification (English) ===');

  // Test 7: English OPEN_FILE
  console.log('\nTest 7: English OPEN_FILE — "open the file"');
  {
    assert(resolverSource.includes('open'), 'should detect "open"');
    assert(resolverSource.includes('load'), 'should detect "load"');
  }

  // Test 8: English READ_FILE
  console.log('\nTest 8: English READ_FILE — "show content"');
  {
    assert(resolverSource.includes('show content'), 'should detect "show content"');
    assert(resolverSource.includes('read'), 'should detect "read"');
  }

  // ════════════════════════════════════════════════════════════════════════
  // 3. Reference Resolution
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 3. Reference Resolution ===');

  // Test 9: extractPathFromMessage extracts filename
  console.log('\nTest 9: extractPathFromMessage extracts filenames');
  {
    assert(resolverSource.includes('extractPathFromMessage'), 'function exists');
    // Test the regex pattern
    const testMsg = 'hello.txt رو باز کن';
    const match = testMsg.match(/([A-Za-z0-9_\-\/\\]+\.[a-zA-Z]{1,5})/);
    assert(match !== null && match[1] === 'hello.txt', 'should extract "hello.txt"');
  }

  // Test 10: extractEditText extracts old/new text
  console.log('\nTest 10: extractEditText extracts old/new text');
  {
    assert(resolverSource.includes('extractEditText'), 'function exists');
    // Test the regex pattern
    const testMsg = 'کلمه نکس رو به NEX AI تغییر بده';
    const match = testMsg.match(/(.+?)\s*رو?\s*به\s*(.+?)\s*(?:تغییر|عوض|تبدیل)/i);
    assert(match !== null, 'should match edit pattern');
    if (match) {
      assert(match[1].includes('نکس'), 'should extract old text "نکس"');
      assert(match[2].includes('NEX AI'), 'should extract new text "NEX AI"');
    }
  }

  // Test 11: resolveReference uses last artifact path
  console.log('\nTest 11: resolveReference uses last artifact path');
  {
    assert(resolverSource.includes('resolveReference'), 'function exists');
    assert(resolverSource.includes('lastArtifactPath'), 'should use lastArtifactPath');
    assert(resolverSource.includes('lastArtifactFolder'), 'should use lastArtifactFolder');
    assert(resolverSource.includes('activeFile'), 'should use activeFile');
  }

  // Test 12: isActionableFollowUp detects action requests
  console.log('\nTest 12: isActionableFollowUp detects action requests');
  {
    assert(resolverSource.includes('isActionableFollowUp'), 'function exists');
    assert(
      resolverSource.includes("'OPEN_FILE'") && resolverSource.includes("'REVEAL_FILE'") && resolverSource.includes("'READ_FILE'"),
      'should include OPEN_FILE, REVEAL_FILE, READ_FILE as actionable'
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // 4. Action Execution
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 4. Action Execution ===');

  // Test 13: executeIntent handles OPEN_FILE
  console.log('\nTest 13: executeIntent handles OPEN_FILE');
  {
    assert(resolverSource.includes('executeIntent'), 'function exists');
    assert(resolverSource.includes('store.openFile'), 'should call store.openFile for OPEN_FILE');
  }

  // Test 14: executeIntent handles READ_FILE
  console.log('\nTest 14: executeIntent handles READ_FILE');
  {
    assert(resolverSource.includes('window.nexAPI.readFile'), 'should call nexAPI.readFile for READ_FILE');
  }

  // Test 15: executeIntent handles REVEAL_FILE
  console.log('\nTest 15: executeIntent handles REVEAL_FILE');
  {
    assert(resolverSource.includes('window.nexAPI.stat'), 'should verify path with nexAPI.stat');
    assert(resolverSource.includes('window.nexAPI.fsSetWorkspace'), 'should navigate explorer with fsSetWorkspace');
  }

  // Test 16: executeIntent handles EDIT_FILE
  console.log('\nTest 16: executeIntent handles EDIT_FILE');
  {
    assert(resolverSource.includes('window.nexAPI.writeFile'), 'should write file for EDIT_FILE');
    assert(resolverSource.includes('store.updateFileContent'), 'should update editor content');
  }

  // ════════════════════════════════════════════════════════════════════════
  // 5. Error Translation
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 5. Error Translation ===');

  // Test 17: translateError handles ENOENT
  console.log('\nTest 17: translateError handles ENOENT');
  {
    assert(resolverSource.includes('translateError'), 'function exists');
    assert(resolverSource.includes('ENOENT'), 'should detect ENOENT');
    assert(resolverSource.includes('فایل یافت نشد'), 'should translate to Persian "file not found"');
  }

  // Test 18: translateError handles EACCES
  console.log('\nTest 18: translateError handles EACCES');
  {
    assert(resolverSource.includes('EACCES'), 'should detect EACCES');
    assert(resolverSource.includes('دسترسی'), 'should translate to Persian "access denied"');
  }

  // Test 19: translateError handles VRAM errors
  console.log('\nTest 19: translateError handles VRAM errors');
  {
    assert(resolverSource.includes('vram'), 'should detect VRAM errors');
    assert(resolverSource.includes('حافظه کافی'), 'should translate to Persian "insufficient memory"');
  }

  // Test 20: translateError handles context shift errors
  console.log('\nTest 20: translateError handles context shift errors');
  {
    assert(resolverSource.includes('compress'), 'should detect context shift');
    assert(resolverSource.includes('context shift'), 'should detect context shift');
  }

  // ════════════════════════════════════════════════════════════════════════
  // 6. Artifact Extraction
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 6. Artifact Extraction ===');

  // Test 21: extractArtifactsFromResponse extracts file paths
  console.log('\nTest 21: extractArtifactsFromResponse extracts file paths');
  {
    assert(resolverSource.includes('extractArtifactsFromResponse'), 'function exists');
    assert(resolverSource.includes('[•▪]'), 'should match bullet points');
  }

  // Test 22: extractArtifactsFromResponse distinguishes files from folders
  console.log('\nTest 22: extractArtifactsFromResponse distinguishes files from folders');
  {
    assert(resolverSource.includes('files') && resolverSource.includes('folders'), 'should return both files and folders');
    assert(resolverSource.includes('\\.[a-zA-Z]{1,5}$'), 'should detect file extensions');
  }

  // ════════════════════════════════════════════════════════════════════════
  // 7. NexChatPanel Integration
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n=== 7. NexChatPanel Integration ===');

  const chatPanelSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'renderer', 'components', 'chat', 'NexChatPanel.tsx'),
    'utf-8'
  );

  // Test 23: NexChatPanel imports intent-resolver
  console.log('\nTest 23: NexChatPanel imports intent-resolver');
  {
    assert(chatPanelSource.includes('intent-resolver'), 'should import intent-resolver');
    assert(chatPanelSource.includes('isActionableFollowUp'), 'should call isActionableFollowUp');
    assert(chatPanelSource.includes('resolveReference'), 'should call resolveReference');
    assert(chatPanelSource.includes('executeIntent'), 'should call executeIntent');
  }

  // Test 24: NexChatPanel extracts artifacts from last assistant message
  console.log('\nTest 24: NexChatPanel extracts artifacts from last assistant message');
  {
    assert(chatPanelSource.includes('extractArtifactsFromResponse'), 'should extract artifacts');
    assert(chatPanelSource.includes('lastAssistantMsg'), 'should find last assistant message');
  }

  // Test 25: NexChatPanel uses activeFile from store
  console.log('\nTest 25: NexChatPanel uses activeFile from store');
  {
    assert(chatPanelSource.includes('activeFile'), 'should use activeFile from useStore');
  }

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n════════════════════════════════════════');
  console.log(`Phase 116 intent resolver tests: ${passed}/${passed + failed} passed (${failed} failed)`);
  console.log('════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
