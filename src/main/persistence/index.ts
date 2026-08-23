/**
 * NEX AI Persistence Layer
 *
 * Two storage paths:
 *  - Plain JSON config:    <userData>/config.json     (non-sensitive data)
 *  - Encrypted secrets:   <userData>/secrets.json   (API keys, OS-encrypted via safeStorage)
 *
 * Portable vs Installed:
 *  - Installed: userData = app.getPath('userData')    (e.g. %APPDATA%/nex-ai on Windows)
 *  - Portable:  userData = <exeDir>/data              (next to the .exe)
 *
 * Survives:
 *  - Close / Restart / Crash
 *  - Move portable folder to different location
 *
 * Security:
 *  - API keys are encrypted with DPAPI on Windows, Keychain on macOS, libsecret on Linux
 *  - secrets.json contains base64-encoded ciphertext only — not plaintext
 *  - If safeStorage is unavailable (rare), we fail loudly rather than store plaintext
 */

import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface PersistedSettings {
  theme?: 'dark' | 'darker';
  fontSize?: number;
  fontFamily?: string;
  tabSize?: number;
  language?: string;
  voiceEnabled?: boolean;
  aiMode?: 'local' | 'online' | 'auto';
  aiEndpoint?: string;
  // NOTE: aiApiKey is NOT here — it's in secrets.json
  // NOTE: glmApiKey is also NOT here — secrets.json (key: glmApiKey)
  // Phase 8 / P8-A: GLM 5.3 online provider selection
  onlineProvider?: 'glm' | 'openai' | 'claude';
  glmModel?: string;
  glmEndpoint?: string;
  // Phase 10 / P10-E: LOCAL embedding model selection (Knowledge/RAG).
  // INDEPENDENT from chat model (activeLocalModelId). null = built-in
  // offline HashEmbedder.
  embeddingModelId?: string | null;
  // Phase 4: local engine settings
  localThreads?: number;
  localContextSize?: number;
  localTemperature?: number;
  localMaxTokens?: number;
  activeLocalModelId?: string | null;
}

export interface PersistedState {
  windowState?: {
    width: number;
    height: number;
    x?: number;
    y?: number;
    maximized: boolean;
  };
  recentProjects?: string[];
  settings?: PersistedSettings;
  localModels?: Array<{
    id: string;
    name: string;
    path: string;
    sizeBytes: number;
    contextSize: number;
    gpuLayers: number;
    category: string;  // ModelCategory (kept loose for forward-compat)
    addedAt: number;
    lastUsedAt?: number;
    // Optional metadata (Phase 7)
    minRamBytes?: number;
    minVramBytes?: number;
    recommendedThreads?: number;
    quantization?: string;
    architecture?: string;
    parameterCount?: string;
    capabilities?: string[];  // ModelCapability[]
    license?: string;
    source?: string;
    sourceUrl?: string;
  }>;
}

const CONFIG_FILE = 'config.json';
const SECRETS_FILE = 'secrets.json';
const CONVERSATIONS_DIR = 'conversations';
const MEMORY_DIR = 'memory';

let userDataDir: string = '';

export function initPersistence(userDataPath: string): void {
  userDataDir = userDataPath;
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }
  // Create subdirectories
  for (const sub of [CONVERSATIONS_DIR, MEMORY_DIR]) {
    const p = path.join(userDataDir, sub);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }
}

/**
 * Effective data dir. If initPersistence() has not run (unit tests, embedded
 * contexts), fall back to a PER-PROCESS temp dir — NEVER the process CWD,
 * which would silently leak config/secrets into whatever directory the
 * process happened to start in (found by Phase 9 hermeticity audit).
 */
function effectiveDataDir(): string {
  if (userDataDir) return userDataDir;
  const fb = path.join(os.tmpdir(), `nex-ai-ud-fallback-${process.pid}`);
  try { fs.mkdirSync(fb, { recursive: true }); } catch { /* best effort */ }
  return fb;
}

function configPath(): string {
  return path.join(effectiveDataDir(), CONFIG_FILE);
}

function secretsPath(): string {
  return path.join(effectiveDataDir(), SECRETS_FILE);
}

// ─── Plain JSON state (non-sensitive) ────────────────────────────────────────

export function loadState(): PersistedState {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    return JSON.parse(raw) as PersistedState;
  } catch {
    return {};
  }
}

export function saveState(state: PersistedState): void {
  try {
    fs.writeFileSync(configPath(), JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[NEX AI] Failed to save state:', err);
  }
}

export function updateState(patch: Partial<PersistedState>): PersistedState {
  const current = loadState();
  const next = { ...current, ...patch };
  saveState(next);
  return next;
}

export function updateSettings(patch: Partial<PersistedSettings>): PersistedSettings {
  const state = loadState();
  const currentSettings = state.settings || {};
  const nextSettings = { ...currentSettings, ...patch };
  updateState({ settings: nextSettings });
  return nextSettings;
}

// ─── Encrypted secrets (API keys) ────────────────────────────────────────────

function loadSecrets(): Record<string, string> {
  try {
    const raw = fs.readFileSync(secretsPath(), 'utf-8');
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function saveSecrets(secrets: Record<string, string>): void {
  try {
    fs.writeFileSync(secretsPath(), JSON.stringify(secrets, null, 2));
  } catch (err) {
    console.error('[NEX AI] Failed to save secrets:', err);
  }
}

/**
 * Encrypt and store a secret (API key, token).
 * Uses Electron's safeStorage which on:
 *  - Windows: DPAPI (user-scoped, can only be decrypted by same user)
 *  - macOS:   Keychain
 *  - Linux:   libsecret (GNOME) or fallback to plain base64 if unavailable
 *
 * Returns true on success, false if safeStorage is unavailable.
 */
export function setSecret(key: string, value: string): boolean {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[NEX AI] safeStorage not available — secret NOT stored');
    return false;
  }
  if (!value) {
    // Empty value = delete
    const secrets = loadSecrets();
    delete secrets[key];
    saveSecrets(secrets);
    return true;
  }
  const encrypted = safeStorage.encryptString(value);
  const secrets = loadSecrets();
  secrets[key] = encrypted.toString('base64');
  saveSecrets(secrets);
  return true;
}

/**
 * Decrypt and return a secret. Returns empty string if not found or
 * decryption fails (e.g. different user account).
 */
export function getSecret(key: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    return '';
  }
  try {
    const secrets = loadSecrets();
    const encrypted = secrets[key];
    if (!encrypted) return '';
    const buf = Buffer.from(encrypted, 'base64');
    return safeStorage.decryptString(buf);
  } catch (err) {
    console.error(`[NEX AI] Failed to decrypt secret "${key}":`, err);
    return '';
  }
}

export function deleteSecret(key: string): void {
  const secrets = loadSecrets();
  delete secrets[key];
  saveSecrets(secrets);
}

// Conversations persistence upgraded below (Phase 32)

// ─── Path info (for debugging / Settings > About) ────────────────────────────

export function getUserDataDir(): string {
  // Phase 21 / P21-G FIX: previously returned the raw (possibly empty)
  // field — before initPersistence() every consumer (e.g. the memory
  // stores) wrote to CWD-relative paths. Same policy as config/secrets
  // (P9-S5): fall back to a per-process temp dir, never the CWD.
  return effectiveDataDir();
}

export function isPortable(): boolean {
  return !app.isPackaged
    ? false
    : !!process.env.PORTABLE_EXECUTABLE_DIR ||
       path.dirname(process.execPath).includes('data') ||
       fs.existsSync(path.join(path.dirname(process.execPath), 'portable.txt'));
}

// ─── Conversations (Phase 32) ─────────────────────────────────────────────────

export interface ConversationMetadata {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  workspace?: string;
  provider?: string;
  model?: string;
  mode?: string;
}

export interface ConversationData extends ConversationMetadata {
  messages: any[];
}

function conversationsDir(): string {
  const dir = path.join(effectiveDataDir(), CONVERSATIONS_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function conversationPath(id: string): string {
  // Sanitize ID to prevent path traversal
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(conversationsDir(), `${safe}.json`);
}

export function saveConversation(data: ConversationData): boolean {
  try {
    const atomic = conversationPath(data.id) + '.tmp';
    fs.writeFileSync(atomic, JSON.stringify({ ...data, updatedAt: Date.now() }, null, 2));
    fs.renameSync(atomic, conversationPath(data.id));
    return true;
  } catch { return false; }
}

export function loadConversation(id: string): ConversationData | null {
  try {
    const raw = fs.readFileSync(conversationPath(id), 'utf-8');
    return JSON.parse(raw) as ConversationData;
  } catch { return null; }
}

export function listConversations(): ConversationMetadata[] {
  const dir = conversationsDir();
  const results: ConversationMetadata[] = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
        const data = JSON.parse(raw) as ConversationData;
        results.push({
          id: data.id, title: data.title || 'Untitled',
          createdAt: data.createdAt || 0, updatedAt: data.updatedAt || 0,
          messageCount: data.messages?.length || 0,
          workspace: data.workspace, provider: data.provider,
          model: data.model, mode: data.mode,
        });
      } catch { /* skip malformed */ }
    }
  } catch { /* dir empty */ }
  return results.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteConversation(id: string): boolean {
  try { fs.unlinkSync(conversationPath(id)); return true; } catch { return false; }
}

export function renameConversation(id: string, newTitle: string): boolean {
  const conv = loadConversation(id);
  if (!conv) return false;
  conv.title = newTitle;
  return saveConversation(conv);
}

export function searchConversations(query: string): ConversationMetadata[] {
  const lower = query.toLowerCase();
  const all = listConversations();
  if (!lower) return all;
  return all.filter((conv) => {
    if (conv.title.toLowerCase().includes(lower)) return true;
    const full = loadConversation(conv.id);
    if (!full) return false;
    return full.messages.some((m: any) =>
      typeof m?.content === 'string' && m.content.toLowerCase().includes(lower)
    );
  });
}
