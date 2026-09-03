/**
 * NEX AI — AI Storage Manager (Phase 80)
 *
 * Professional external AI data directory system. Allows the user to:
 *   - Choose a custom storage location (e.g. D:\NEX-AI-Data\)
 *   - Manually download AI files and place them in folders
 *   - Auto-discover, classify, and register models on scan
 *
 * Directory structure:
 *
 *   <storagePath>/
 *   ├── models/
 *   │   ├── llm/          (qwen/, llama/, mistral/, other/)
 *   │   ├── coder/        (qwen-coder/, deepseek-coder/)
 *   │   ├── vision/       (qwen-vl/, llava/)
 *   │   ├── embedding/
 *   │   └── reranker/
 *   ├── voice/
 *   │   ├── whisper/      (ggml-small.bin, ggml-medium.bin, etc.)
 *   │   └── piper/        (voices/, configs/)
 *   ├── vision/
 *   ├── documents/
 *   │   ├── pdf/
 *   │   ├── manuals/
 *   │   ├── datasheets/
 *   │   └── knowledge/
 *   ├── embeddings/
 *   ├── cache/
 *   └── registry/
 *       └── models.json   (persistent registry)
 *
 * The user workflow:
 *   1. Download model manually (browser, wget, etc.)
 *   2. Place file into correct folder (e.g. models/llm/qwen/)
 *   3. Open NEX AI
 *   4. Click Scan
 *   5. Model appears in Library
 *   6. Activate model
 *
 * The app NEVER moves or duplicates files unless the user explicitly
 * clicks "Move". It only indexes and uses existing files.
 */
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { loadState, updateState } from '../persistence';

// ─── Types ─────────────────────────────────────────────────────────────────────────

export type AIAssetType = 'llm' | 'coder' | 'vision-llm' | 'embedding' | 'reranker' | 'voice-stt' | 'voice-tts' | 'vision' | 'document';

export interface AIAsset {
  id: string;
  name: string;
  path: string;            // absolute path to the file
  type: AIAssetType;
  subtype?: string;        // e.g. 'qwen', 'llama', 'whisper', 'piper'
  size: number;            // bytes
  format: string;          // 'gguf', 'bin', 'onnx', 'pdf', 'txt', 'md', 'html'
  provider?: string;       // 'qwen', 'llama', 'mistral', 'whisper', 'piper'
  capabilities?: string[]; // ['chat', 'completion', 'coding', 'vision', 'embedding']
  parameterCount?: string; // '0.5B', '7B', '32B'
  quantization?: string;   // 'Q4_K_M', 'Q5_K_M'
  detectedAt: number;      // timestamp of last scan
  fileExists: boolean;
}

export interface StorageScanResult {
  storagePath: string;
  scanned: number;
  registered: number;
  alreadyRegistered: number;
  skipped: number;
  newAssets: AIAsset[];
  errors: string[];
  byType: Record<AIAssetType, number>;
}

export interface StorageInfo {
  path: string;
  exists: boolean;
  totalSize: number;
  modelCount: number;
  voiceCount: number;
  documentCount: number;
  registryPath: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────────────

const STORAGE_DIR_STRUCTURE = [
  'models/llm/qwen',
  'models/llm/llama',
  'models/llm/mistral',
  'models/llm/other',
  'models/coder/qwen-coder',
  'models/coder/deepseek-coder',
  'models/vision/qwen-vl',
  'models/vision/llava',
  'models/embedding',
  'models/reranker',
  'voice/whisper',
  'voice/piper/voices',
  'voice/piper/configs',
  'vision',
  'documents/pdf',
  'documents/manuals',
  'documents/datasheets',
  'documents/knowledge',
  'embeddings',
  'cache',
  'registry',
];

const FILE_EXTENSIONS = {
  gguf: '.gguf',
  bin: '.bin',
  onnx: '.onnx',
  pdf: '.pdf',
  txt: '.txt',
  md: '.md',
  html: '.html',
};

// ─── Storage Path Management ────────────────────────────────────────────────────────

/**
 * Get the current AI storage path. Falls back to <userData>/ai-data if not configured.
 * The user can change this via setStoragePath().
 */
export function getAIStoragePath(): string {
  const state = loadState();
  const settings = state.settings || {};
  const configured = (settings as any).aiStoragePath;
  if (configured && fs.existsSync(configured)) {
    return configured;
  }
  // Default: <userData>/ai-data
  return path.join(app.getPath('userData'), 'ai-data');
}

/**
 * Set the AI storage path. Creates the directory structure if it doesn't exist.
 */
export function setAIStoragePath(newPath: string): { success: boolean; error?: string } {
  try {
    if (!newPath || newPath.trim().length === 0) {
      return { success: false, error: 'Path is required' };
    }
    const absPath = path.resolve(newPath);

    // Create the directory if it doesn't exist
    if (!fs.existsSync(absPath)) {
      fs.mkdirSync(absPath, { recursive: true });
    }

    // Create the subdirectory structure
    ensureStorageStructure(absPath);

    // Persist the path
    const state = loadState();
    const settings = state.settings || {};
    (settings as any).aiStoragePath = absPath;
    updateState({ settings });

    console.log(`[AI_STORAGE] Storage path set to: ${absPath}`);
    return { success: true };
  } catch (err: any) {
    console.error(`[AI_STORAGE] Error setting storage path:`, err);
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Create the full directory structure under a storage path.
 */
export function ensureStorageStructure(storagePath: string): void {
  for (const subdir of STORAGE_DIR_STRUCTURE) {
    const dir = path.join(storagePath, subdir);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        // Non-fatal — may not have permissions
      }
    }
  }
}

/**
 * Get storage info: path, total size, counts.
 */
export function getStorageInfo(): StorageInfo {
  const storagePath = getAIStoragePath();
  const exists = fs.existsSync(storagePath);

  if (!exists) {
    return {
      path: storagePath,
      exists: false,
      totalSize: 0,
      modelCount: 0,
      voiceCount: 0,
      documentCount: 0,
      registryPath: path.join(storagePath, 'registry', 'models.json'),
    };
  }

  // Calculate sizes and counts
  let totalSize = 0;
  let modelCount = 0;
  let voiceCount = 0;
  let documentCount = 0;

  try {
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.')) {
            walk(fullPath);
          }
        } else if (entry.isFile()) {
          const stat = fs.statSync(fullPath);
          totalSize += stat.size;
          const ext = path.extname(entry.name).toLowerCase();
          if (ext === '.gguf') modelCount++;
          else if (ext === '.bin' || ext === '.onnx') voiceCount++;
          else if (['.pdf', '.txt', '.md', '.html'].includes(ext)) documentCount++;
        }
      }
    };
    walk(storagePath);
  } catch {
    // Non-fatal
  }

  return {
    path: storagePath,
    exists: true,
    totalSize,
    modelCount,
    voiceCount,
    documentCount,
    registryPath: path.join(storagePath, 'registry', 'models.json'),
  };
}

// ─── Registry ───────────────────────────────────────────────────────────────────────

/**
 * Read the persistent registry from <storagePath>/registry/models.json.
 * Returns an empty array if the file doesn't exist.
 */
export function readRegistry(): AIAsset[] {
  const registryPath = path.join(getAIStoragePath(), 'registry', 'models.json');
  try {
    if (!fs.existsSync(registryPath)) {
      return [];
    }
    const data = fs.readFileSync(registryPath, 'utf-8');
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Write the registry to <storagePath>/registry/models.json.
 */
export function writeRegistry(assets: AIAsset[]): void {
  const storagePath = getAIStoragePath();
  const registryDir = path.join(storagePath, 'registry');
  if (!fs.existsSync(registryDir)) {
    fs.mkdirSync(registryDir, { recursive: true });
  }
  const registryPath = path.join(registryDir, 'models.json');
  fs.writeFileSync(registryPath, JSON.stringify(assets, null, 2), 'utf-8');
  console.log(`[AI_STORAGE] Registry written: ${assets.length} assets → ${registryPath}`);
}

// ─── Auto-Classification ────────────────────────────────────────────────────────────

/**
 * Classify a file based on its path, filename, and folder.
 *
 * Classification rules:
 *   - .gguf in models/llm/ → llm
 *   - .gguf in models/coder/ → coder
 *   - .gguf in models/vision/ → vision-llm
 *   - .gguf in models/embedding/ → embedding
 *   - .gguf in models/reranker/ → reranker
 *   - .bin in voice/whisper/ → voice-stt
 *   - .onnx in voice/piper/ → voice-tts
 *   - .pdf/.txt/.md/.html in documents/ → document
 *
 * Provider detection (from filename):
 *   - qwen → Qwen
 *   - llama → Meta
 *   - mistral → Mistral AI
 *   - deepseek → DeepSeek
 *   - codellama → Meta (CodeLlama)
 *   - ggml-*.bin → Whisper (OpenAI)
 *   - *.onnx in piper → Piper
 */
function classifyFile(filePath: string, storagePath: string): { type: AIAssetType; subtype?: string; provider?: string; capabilities?: string[]; parameterCount?: string; quantization?: string } {
  const relPath = path.relative(storagePath, filePath).replace(/\\/g, '/');
  const parts = relPath.split('/');
  const filename = path.basename(filePath).toLowerCase();
  const ext = path.extname(filename);

  // Determine type from folder path
  let type: AIAssetType = 'llm';
  let subtype: string | undefined;

  if (parts.includes('llm')) {
    type = 'llm';
    const llmIdx = parts.indexOf('llm');
    if (llmIdx + 1 < parts.length) {
      subtype = parts[llmIdx + 1];
    }
  } else if (parts.includes('coder')) {
    type = 'coder';
    const coderIdx = parts.indexOf('coder');
    if (coderIdx + 1 < parts.length) {
      subtype = parts[coderIdx + 1];
    }
  } else if (parts.includes('vision') && parts.includes('models')) {
    type = 'vision-llm';
    const visionIdx = parts.indexOf('vision');
    if (visionIdx + 1 < parts.length) {
      subtype = parts[visionIdx + 1];
    }
  } else if (parts.includes('embedding')) {
    type = 'embedding';
  } else if (parts.includes('reranker')) {
    type = 'reranker';
  } else if (parts.includes('whisper') || (parts.includes('voice') && parts.includes('whisper'))) {
    type = 'voice-stt';
    subtype = 'whisper';
  } else if (parts.includes('piper') || (parts.includes('voice') && parts.includes('piper'))) {
    type = 'voice-tts';
    subtype = 'piper';
  } else if (parts.includes('documents')) {
    type = 'document';
  } else if (ext === '.gguf') {
    // Default: if .gguf and no specific folder, classify as llm
    type = 'llm';
  }

  // Provider detection from filename
  let provider: string | undefined;
  let capabilities: string[] = ['chat', 'completion'];
  let parameterCount: string | undefined;
  let quantization: string | undefined;

  if (filename.includes('qwen') || filename.includes('qwen2') || filename.includes('qwen3')) {
    provider = 'Qwen';
    if (filename.includes('coder')) {
      provider = 'Qwen';
      capabilities = ['chat', 'completion', 'coding'];
      type = type === 'llm' ? 'coder' : type;
    }
  } else if (filename.includes('llama')) {
    provider = 'Meta';
    if (filename.includes('code')) {
      capabilities = ['chat', 'completion', 'coding'];
      type = type === 'llm' ? 'coder' : type;
    }
  } else if (filename.includes('mistral') || filename.includes('mixtral')) {
    provider = 'Mistral AI';
  } else if (filename.includes('deepseek')) {
    provider = 'DeepSeek';
    capabilities = ['chat', 'completion', 'coding'];
    if (type === 'llm') type = 'coder';
  } else if (filename.includes('phi')) {
    provider = 'Microsoft';
  } else if (filename.includes('gemma')) {
    provider = 'Google';
  } else if (filename.includes('llava') || filename.includes('vl')) {
    provider = provider || 'Vision';
    capabilities = ['chat', 'vision'];
    if (type === 'llm') type = 'vision-llm';
  } else if (filename.startsWith('ggml-') && ext === '.bin') {
    provider = 'Whisper (OpenAI)';
    capabilities = ['speech-to-text'];
    type = 'voice-stt';
    subtype = 'whisper';
  } else if (ext === '.onnx' && parts.includes('piper')) {
    provider = 'Piper';
    capabilities = ['text-to-speech'];
    type = 'voice-tts';
    subtype = 'piper';
  } else if (filename.includes('bert') || filename.includes('embed')) {
    provider = provider || 'Embedding';
    capabilities = ['embedding'];
    if (type === 'llm') type = 'embedding';
  }

  // Parameter count detection (e.g. "7b", "32b", "0.5b")
  const paramMatch = filename.match(/(\d+(?:\.\d+)?)\s*b/i);
  if (paramMatch) {
    parameterCount = `${paramMatch[1]}B`;
  }

  // Quantization detection (e.g. "q4_k_m", "q5_k_m", "q8_0")
  const quantMatch = filename.match(/q\d+[_-]?\w+/i);
  if (quantMatch) {
    quantization = quantMatch[0].toUpperCase().replace(/-/g, '_');
  }

  return { type, subtype, provider, capabilities, parameterCount, quantization };
}

// ─── Scanner ────────────────────────────────────────────────────────────────────────

/**
 * Recursively find all AI-relevant files in a directory.
 */
function findAIFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findAIFiles(fullPath));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.gguf', '.bin', '.onnx', '.pdf', '.txt', '.md', '.html'].includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // Directory read error — return what we have
  }
  return results;
}

/**
 * Scan the AI storage directory for all AI-relevant files.
 * Auto-classifies and registers any new files found.
 *
 * Workflow:
 *   1. Walk the storage directory recursively
 *   2. Find all .gguf, .bin, .onnx, .pdf, .txt, .md, .html files
 *   3. Classify each file by folder + filename
 *   4. Validate GGUF magic for .gguf files
 *   5. Check if already in registry (by path)
 *   6. If new, add to registry
 *   7. Write updated registry
 *
 * NEVER moves or deletes files. Only indexes.
 */
export function scanStorage(): StorageScanResult {
  const storagePath = getAIStoragePath();
  const result: StorageScanResult = {
    storagePath,
    scanned: 0,
    registered: 0,
    alreadyRegistered: 0,
    skipped: 0,
    newAssets: [],
    errors: [],
    byType: {
      'llm': 0, 'coder': 0, 'vision-llm': 0, 'embedding': 0, 'reranker': 0,
      'voice-stt': 0, 'voice-tts': 0, 'vision': 0, 'document': 0,
    },
  };

  console.log(`[AI_STORAGE] Scanning: ${storagePath}`);

  // Ensure structure exists
  ensureStorageStructure(storagePath);

  // Find all AI files
  const files = findAIFiles(storagePath);
  result.scanned = files.length;
  console.log(`[AI_STORAGE] Found ${files.length} AI files`);

  // Read existing registry
  const existing = readRegistry();
  const existingPaths = new Set(existing.map(a => path.resolve(a.path)));

  // Process each file
  for (const filePath of files) {
    const absPath = path.resolve(filePath);

    // Skip if already registered
    if (existingPaths.has(absPath)) {
      result.alreadyRegistered++;
      // Still count by type
      const existingAsset = existing.find(a => path.resolve(a.path) === absPath);
      if (existingAsset) {
        result.byType[existingAsset.type]++;
      }
      continue;
    }

    try {
      const stat = fs.statSync(absPath);
      const filename = path.basename(filePath);
      const ext = path.extname(filename).toLowerCase().slice(1);

      // Validate GGUF magic for .gguf files
      if (ext === 'gguf') {
        const fd = fs.openSync(absPath, 'r');
        const buf = Buffer.alloc(4);
        fs.readSync(fd, buf, 0, 4, 0);
        fs.closeSync(fd);
        const magic = buf.toString('ascii');
        if (magic !== 'GGUF') {
          console.log(`[AI_STORAGE] Skipping (invalid GGUF magic): ${absPath}`);
          result.skipped++;
          result.errors.push(`Invalid GGUF magic: ${filename}`);
          continue;
        }
      }

      // Classify the file
      const classification = classifyFile(filePath, storagePath);

      // Derive name from filename (without extension)
      const name = filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

      const asset: AIAsset = {
        id: `${ext}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        path: absPath,
        type: classification.type,
        subtype: classification.subtype,
        size: stat.size,
        format: ext,
        provider: classification.provider,
        capabilities: classification.capabilities,
        parameterCount: classification.parameterCount,
        quantization: classification.quantization,
        detectedAt: Date.now(),
        fileExists: true,
      };

      existing.push(asset);
      result.registered++;
      result.newAssets.push(asset);
      result.byType[asset.type]++;

      console.log(`[AI_STORAGE] Registered: ${name} — ${classification.type} — ${stat.size} bytes`);
    } catch (err: any) {
      console.log(`[AI_STORAGE] Error registering ${absPath}: ${err?.message}`);
      result.skipped++;
      result.errors.push(`Error: ${path.basename(absPath)} — ${err?.message || err}`);
    }
  }

  // Update fileExists flags for existing assets
  for (const asset of existing) {
    asset.fileExists = fs.existsSync(asset.path);
  }

  // Write updated registry
  writeRegistry(existing);

  console.log(`[AI_STORAGE] Scan complete — scanned: ${result.scanned}, registered: ${result.registered}, already: ${result.alreadyRegistered}, skipped: ${result.skipped}`);
  return result;
}

/**
 * Repair the registry: re-validate all entries, remove missing files.
 */
export function repairRegistry(): { success: boolean; removed: number; total: number; errors: string[] } {
  const assets = readRegistry();
  const errors: string[] = [];
  let removed = 0;

  const valid: AIAsset[] = [];
  for (const asset of assets) {
    if (fs.existsSync(asset.path)) {
      asset.fileExists = true;
      valid.push(asset);
    } else {
      removed++;
      console.log(`[AI_STORAGE] Removing missing file from registry: ${asset.path}`);
    }
  }

  writeRegistry(valid);
  console.log(`[AI_STORAGE] Registry repaired — ${valid.length} valid, ${removed} removed`);
  return { success: true, removed, total: valid.length, errors };
}

/**
 * Open the storage folder in the OS file explorer.
 */
export function openStorageFolder(): void {
  const storagePath = getAIStoragePath();
  const { shell } = require('electron');
  shell.openPath(storagePath);
}
