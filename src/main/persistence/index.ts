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
    category: 'general' | 'coding' | 'reasoning' | 'fast';
    addedAt: number;
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

function configPath(): string {
  return path.join(userDataDir, CONFIG_FILE);
}

function secretsPath(): string {
  return path.join(userDataDir, SECRETS_FILE);
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

// ─── Conversations persistence (for Phase 19) ────────────────────────────────

export function getConversationsDir(): string {
  return path.join(userDataDir, CONVERSATIONS_DIR);
}

export function saveConversation(id: string, messages: any[]): void {
  const filePath = path.join(getConversationsDir(), `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ id, savedAt: Date.now(), messages }, null, 2));
}

export function loadConversation(id: string): any[] {
  try {
    const filePath = path.join(getConversationsDir(), `${id}.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return data.messages || [];
  } catch {
    return [];
  }
}

export function listConversations(): Array<{ id: string; savedAt: number; messageCount: number }> {
  try {
    const files = fs.readdirSync(getConversationsDir()).filter((f) => f.endsWith('.json'));
    return files.map((f) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(getConversationsDir(), f), 'utf-8'));
        return {
          id: data.id || f.replace('.json', ''),
          savedAt: data.savedAt || 0,
          messageCount: (data.messages || []).length,
        };
      } catch {
        return { id: f.replace('.json', ''), savedAt: 0, messageCount: 0 };
      }
    }).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

// ─── Path info (for debugging / Settings > About) ────────────────────────────

export function getUserDataDir(): string {
  return userDataDir;
}

export function isPortable(): boolean {
  return !app.isPackaged
    ? false
    : !!process.env.PORTABLE_EXECUTABLE_DIR ||
       path.dirname(process.execPath).includes('data') ||
       fs.existsSync(path.join(path.dirname(process.execPath), 'portable.txt'));
}
