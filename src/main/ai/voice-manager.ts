/**
 * NEX AI — Voice Manager (Activation Layer)
 *
 * The single entry point for voice system lifecycle management. Connects
 * the main-side LocalVoiceEngine (whisper + piper) with the renderer-side
 * Orb animation and provides a full activation lifecycle:
 *
 *   detect → setup → activate → listen → transcribe → respond → speak
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  VoiceManager (this file)                                   │
 *   │    detect() → activate() → setMode() → getStatus()          │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  LocalVoiceEngine (voice/local-voice-engine.ts)              │
 *   │    setSTTProvider + setTTSProvider + startListening + speak  │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  LocalWhisperProvider + LocalPiperProvider                   │
 *   │    findWhisperBinary + findWhisperModels                     │
 *   │    findPiperBinary + findPiperVoices                         │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  NexVoiceConversation (voice/nex-voice-conversation.ts)      │
 *   │    start/stop + feedTranscript + speakResponse + wakeWord    │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ACTIVATION LIFECYCLE
 * ════════════════════════════════════════════════════════════════════════════
 * 1. detect(): scan filesystem for whisper binary, whisper models, piper
 *    binary, piper voices. Returns a VoiceRuntimeStatus. Logs [VOICE_RUNTIME].
 *
 * 2. activate(): if binaries + models are present, auto-attach the first
 *    discovered whisper model + piper voice to the LocalVoiceEngine. If
 *    components are missing, returns missingComponents[] so the UI can
 *    trigger installation.
 *
 * 3. setMode('push-to-talk' | 'wake-word' | 'continuous'):
 *    - push-to-talk: listening is manually triggered (via UI button or hotkey)
 *    - wake-word: continuous listening with wake-word detection ("سلام NEX")
 *    - continuous: always-on listening (no wake word needed)
 *
 * 4. startConversation() / stopConversation(): start/stop the NexVoiceConversation
 *    FSM, which manages the listening → thinking → speaking cycle.
 *
 * 5. Status is surfaced to the UI via getStatus() + the 'voice-manager-status'
 *    IPC event (emitted on every state change).
 * ════════════════════════════════════════════════════════════════════════════
 */

import { getLocalVoiceEngine } from '../voice/local-voice-engine';
import { getNexVoiceConversation } from '../voice/nex-voice-conversation';
import { loadState, updateState } from '../persistence';

// ─── Types ─────────────────────────────────────────────────────────────────

export type VoiceMode = 'push-to-talk' | 'wake-word' | 'continuous';

export interface VoiceComponentStatus {
  whisperBinary: string | null;
  whisperBinaryFound: boolean;
  whisperModel: string | null;
  whisperModelFound: boolean;
  whisperModels: Array<{ name: string; path: string; sizeBytes: number }>;
  piperBinary: string | null;
  piperBinaryFound: boolean;
  piperVoice: string | null;
  piperVoiceFound: boolean;
  piperVoices: Array<{ name: string; path: string; sizeBytes: number }>;
}

export interface VoiceRuntimeStatus extends VoiceComponentStatus {
  sttReady: boolean;        // whisperBinary + whisperModel both present
  ttsReady: boolean;        // piperBinary + piperVoice both present
  activated: boolean;       // providers registered with model paths
  conversationActive: boolean;
  mode: VoiceMode;
  wakeWordEnabled: boolean;
  missingComponents: string[];  // catalog IDs that need installation
}

export interface VoiceActivateResult {
  success: boolean;
  activated: boolean;
  sttReady: boolean;
  ttsReady: boolean;
  missingComponents: string[];
  error?: string;
}

// ─── Voice Manager ─────────────────────────────────────────────────────────

/**
 * The Voice Manager singleton. Handles the full voice lifecycle.
 */
export class VoiceManager {
  private _mode: VoiceMode = 'push-to-talk';
  private _activated: boolean = false;
  private _lastDetection: VoiceRuntimeStatus | null = null;

  /**
   * Detect all voice components on the filesystem.
   * Logs the [VOICE_RUNTIME] diagnostic block.
   * Does NOT activate — call activate() to register providers.
   */
  async detect(): Promise<VoiceRuntimeStatus> {
    const { findWhisperBinary, findWhisperModels } = await import('../voice/local-whisper-provider');
    const { findPiperBinary, findPiperVoices } = await import('../voice/local-piper-provider');

    const whisperBin = findWhisperBinary();
    const piperBin = findPiperBinary();
    let whisperModels: any[] = [];
    let piperVoices: any[] = [];
    try { whisperModels = findWhisperModels(); } catch { /* */ }
    try { piperVoices = findPiperVoices(); } catch { /* */ }

    const sttReady = !!whisperBin && whisperModels.length > 0;
    const ttsReady = !!piperBin && piperVoices.length > 0;

    const missingComponents: string[] = [];
    if (!whisperBin) missingComponents.push('whisper-cli-binary');
    if (whisperModels.length === 0) missingComponents.push('whisper-base-en');
    if (!piperBin) missingComponents.push('piper-binary');
    if (piperVoices.length === 0) missingComponents.push('piper-en-us-lessac-medium');

    const status: VoiceRuntimeStatus = {
      whisperBinary: whisperBin,
      whisperBinaryFound: !!whisperBin,
      whisperModel: whisperModels[0]?.path || null,
      whisperModelFound: whisperModels.length > 0,
      whisperModels,
      piperBinary: piperBin,
      piperBinaryFound: !!piperBin,
      piperVoice: piperVoices[0]?.path || null,
      piperVoiceFound: piperVoices.length > 0,
      piperVoices,
      sttReady,
      ttsReady,
      activated: this._activated,
      conversationActive: this.isConversationActive(),
      mode: this._mode,
      wakeWordEnabled: this.isWakeWordEnabled(),
      missingComponents,
    };

    // Log the [VOICE_RUNTIME] diagnostic block
    console.log(`[VOICE_RUNTIME]`);
    console.log(`  whisperBinary=${whisperBin || '(not found)'}`);
    console.log(`  whisperBinaryExists=${!!whisperBin}`);
    console.log(`  whisperModel=${whisperModels[0]?.path || '(not found)'}`);
    console.log(`  whisperModelExists=${whisperModels.length > 0}`);
    console.log(`  whisperModelsFound=${whisperModels.length}`);
    console.log(`  piperBinary=${piperBin || '(not found)'}`);
    console.log(`  piperBinaryExists=${!!piperBin}`);
    console.log(`  piperVoice=${piperVoices[0]?.path || '(not found)'}`);
    console.log(`  piperVoiceExists=${piperVoices.length > 0}`);
    console.log(`  piperVoicesFound=${piperVoices.length}`);
    console.log(`  sttReady=${sttReady}`);
    console.log(`  ttsReady=${ttsReady}`);
    console.log(`  activated=${this._activated}`);
    console.log(`  mode=${this._mode}`);
    console.log(`  missingComponents=[${missingComponents.join(', ')}]`);

    this._lastDetection = status;
    return status;
  }

  /**
   * Log the [VOICE_STATUS] block (simplified readiness summary).
   * Called at startup and after activation.
   */
  logVoiceStatus(status?: VoiceRuntimeStatus): void {
    const s = status || this._lastDetection;
    if (!s) {
      console.log(`[VOICE_STATUS]`);
      console.log(`  STT=not_checked`);
      console.log(`  TTS=not_checked`);
      console.log(`  Language=unknown`);
      return;
    }
    const persisted = this.loadPersistedSettings();
    console.log(`[VOICE_STATUS]`);
    console.log(`  STT=${s.sttReady ? 'ready' : 'not_ready'}`);
    console.log(`  TTS=${s.ttsReady ? 'ready' : 'not_ready'}`);
    console.log(`  Language=${persisted.language || 'auto'}`);
    console.log(`  Activated=${s.activated ? 'yes' : 'no'}`);
    console.log(`  Mode=${s.mode}`);
    if (s.missingComponents.length > 0) {
      console.log(`  Missing=${s.missingComponents.join(', ')}`);
    }
  }

  /**
   * Auto-install missing voice components using the UnifiedComponentInstaller.
   * Downloads whisper binary, whisper model, piper binary, and piper voice
   * from the unified component catalog (HuggingFace + GitHub releases).
   *
   * This is non-blocking — returns immediately and installs in the background.
   * The caller can poll getStatus() to check progress.
   */
  async autoInstallComponents(missingComponentIds: string[]): Promise<{ started: boolean; error?: string }> {
    if (missingComponentIds.length === 0) return { started: false };

    try {
      const { getUnifiedComponentInstaller } = await import('../runtime/unified-component-installer');
      const installer = getUnifiedComponentInstaller();

      console.log(`[VOICE_MANAGER] Auto-installing voice components: ${missingComponentIds.join(', ')}`);

      // Install each missing component sequentially (to avoid bandwidth contention)
      for (const componentId of missingComponentIds) {
        try {
          console.log(`[VOICE_MANAGER] Installing ${componentId}...`);
          await installer.installComponent(componentId);
          console.log(`[VOICE_MANAGER] Installed ${componentId}`);
        } catch (err: any) {
          console.warn(`[VOICE_MANAGER] Failed to install ${componentId}: ${err?.message}`);
          // Continue with next component — partial installation is OK
        }
      }

      // Re-detect after installation
      await this.detect();
      console.log(`[VOICE_MANAGER] Auto-install complete — re-detecting components`);
      return { started: true };
    } catch (err: any) {
      console.warn(`[VOICE_MANAGER] Auto-install failed: ${err?.message}`);
      return { started: false, error: err?.message };
    }
  }

  /**
   * Full startup sequence: detect → log status → auto-install if missing →
   * activate → log final status. Called once on app boot.
   */
  async startupSequence(): Promise<void> {
    try {
      // 1. Detect components
      const status = await this.detect();

      // 2. Log [VOICE_STATUS]
      this.logVoiceStatus(status);

      // 3. Load persisted settings
      const persisted = this.loadPersistedSettings();
      this.setMode(persisted.mode);

      // 4. If components are missing, try auto-install (non-blocking)
      if (status.missingComponents.length > 0) {
        console.log(`[VOICE_MANAGER] Missing components detected — attempting auto-install`);
        // Don't await — let it install in the background
        this.autoInstallComponents(status.missingComponents).then(() => {
          // After install completes, try to activate
          this.activate().then((result) => {
            if (result.activated) {
              console.log(`[VOICE_MANAGER] Auto-activated after install`);
              this.logVoiceStatus();
              if (persisted.activated) {
                this.startConversation().catch(() => {});
              }
            }
          }).catch(() => {});
        }).catch(() => {});
      } else {
        // 5. Components ready — activate immediately
        const result = await this.activate();
        if (result.activated && persisted.activated) {
          await this.startConversation();
        }
        this.logVoiceStatus();
      }
    } catch (err: any) {
      console.warn(`[VOICE_MANAGER] Startup sequence failed: ${err?.message}`);
      this.logVoiceStatus();
    }
  }

  /**
   * Activate the voice system: register STT + TTS providers with model paths.
   * If components are missing, returns missingComponents[] without activating.
   *
   * This is the key method that transitions from "passive" (binary registered
   * but no model path → hasLocalSTT=false) to "active" (binary + model →
   * hasLocalSTT=true).
   */
  async activate(): Promise<VoiceActivateResult> {
    const status = await this.detect();

    if (!status.sttReady && !status.ttsReady) {
      return {
        success: false,
        activated: false,
        sttReady: false,
        ttsReady: false,
        missingComponents: status.missingComponents,
        error: 'Voice components not installed. Install whisper + piper first.',
      };
    }

    const engine = getLocalVoiceEngine();

    // Activate STT (whisper)
    if (status.sttReady && status.whisperBinary && status.whisperModel) {
      try {
        const { LocalWhisperProvider } = await import('../voice/local-whisper-provider');
        engine.setSTTProvider(new LocalWhisperProvider({
          binaryPath: status.whisperBinary,
          modelPath: status.whisperModel,
        }));
        console.log(`[VOICE_MANAGER] STT activated: ${status.whisperModel}`);
      } catch (err: any) {
        console.warn(`[VOICE_MANAGER] STT activation failed: ${err?.message}`);
      }
    }

    // Activate TTS (piper)
    if (status.ttsReady && status.piperBinary && status.piperVoice) {
      try {
        const { LocalPiperProvider } = await import('../voice/local-piper-provider');
        engine.setTTSProvider(new LocalPiperProvider({
          binaryPath: status.piperBinary,
          voiceModelPath: status.piperVoice,
        }));
        console.log(`[VOICE_MANAGER] TTS activated: ${status.piperVoice}`);
      } catch (err: any) {
        console.warn(`[VOICE_MANAGER] TTS activation failed: ${err?.message}`);
      }
    }

    this._activated = true;

    // Persist activation
    this.persistVoiceSettings({
      voiceActivated: true,
      whisperModelPath: status.whisperModel || undefined,
      piperVoicePath: status.piperVoice || undefined,
    });

    console.log(`[VOICE_MANAGER] Voice system activated (STT: ${engine.hasLocalSTT}, TTS: ${engine.hasLocalTTS})`);

    return {
      success: true,
      activated: true,
      sttReady: engine.hasLocalSTT,
      ttsReady: engine.hasLocalTTS,
      missingComponents: [],
    };
  }

  /**
   * Deactivate the voice system: stop conversation + stop providers.
   */
  async deactivate(): Promise<void> {
    try {
      const conv = getNexVoiceConversation();
      if (conv.isActive) await conv.stop();
    } catch { /* */ }
    this._activated = false;
    this.persistVoiceSettings({ voiceActivated: false });
    console.log('[VOICE_MANAGER] Voice system deactivated');
  }

  /**
   * Set the voice mode: push-to-talk, wake-word, or continuous.
   */
  setMode(mode: VoiceMode): void {
    this._mode = mode;
    this.persistVoiceSettings({ voiceMode: mode });
    console.log(`[VOICE_MANAGER] Mode set: ${mode}`);

    // Apply wake-word setting to the conversation system
    try {
      const conv = getNexVoiceConversation();
      if (mode === 'wake-word') {
        conv.enableWakeWord();
      } else {
        conv.disableWakeWord();
      }
    } catch { /* */ }
  }

  /**
   * Start the voice conversation FSM.
   * Requires the system to be activated first.
   */
  async startConversation(): Promise<{ success: boolean; error?: string }> {
    if (!this._activated) {
      const result = await this.activate();
      if (!result.activated) {
        return { success: false, error: `Cannot start conversation: ${result.error || 'activation failed'}` };
      }
    }
    try {
      const conv = getNexVoiceConversation();
      await conv.start();
      // Apply current mode
      if (this._mode === 'wake-word') conv.enableWakeWord();
      console.log('[VOICE_MANAGER] Conversation started');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to start conversation' };
    }
  }

  /**
   * Stop the voice conversation FSM.
   */
  async stopConversation(): Promise<void> {
    try {
      const conv = getNexVoiceConversation();
      await conv.stop();
      console.log('[VOICE_MANAGER] Conversation stopped');
    } catch { /* */ }
  }

  /**
   * Toggle the conversation on/off.
   */
  async toggleConversation(): Promise<{ success: boolean; active: boolean; error?: string }> {
    const conv = getNexVoiceConversation();
    if (conv.isActive) {
      await this.stopConversation();
      return { success: true, active: false };
    }
    const result = await this.startConversation();
    return { success: result.success, active: result.success, error: result.error };
  }

  /**
   * Get the current voice runtime status (re-detects if needed).
   */
  async getStatus(): Promise<VoiceRuntimeStatus> {
    if (!this._lastDetection) {
      return await this.detect();
    }
    return {
      ...this._lastDetection,
      activated: this._activated,
      conversationActive: this.isConversationActive(),
      mode: this._mode,
      wakeWordEnabled: this.isWakeWordEnabled(),
    };
  }

  /**
   * Select a specific whisper model by path.
   */
  async setSTTModel(modelPath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const engine = getLocalVoiceEngine();
      const { findWhisperBinary } = await import('../voice/local-whisper-provider');
      const whisperBin = findWhisperBinary();
      if (!whisperBin) return { success: false, error: 'whisper binary not found' };
      const { LocalWhisperProvider } = await import('../voice/local-whisper-provider');
      engine.setSTTProvider(new LocalWhisperProvider({ binaryPath: whisperBin, modelPath }));
      this.persistVoiceSettings({ whisperModelPath: modelPath });
      console.log(`[VOICE_MANAGER] STT model set: ${modelPath}`);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message };
    }
  }

  /**
   * Select a specific piper voice by path.
   */
  async setTTSVoice(voicePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      const engine = getLocalVoiceEngine();
      const { findPiperBinary } = await import('../voice/local-piper-provider');
      const piperBin = findPiperBinary();
      if (!piperBin) return { success: false, error: 'piper binary not found' };
      const { LocalPiperProvider } = await import('../voice/local-piper-provider');
      engine.setTTSProvider(new LocalPiperProvider({ binaryPath: piperBin, voiceModelPath: voicePath }));
      this.persistVoiceSettings({ piperVoicePath: voicePath });
      console.log(`[VOICE_MANAGER] TTS voice set: ${voicePath}`);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message };
    }
  }

  /**
   * Set the STT language (BCP-47: 'en', 'fa', 'auto').
   */
  async setLanguage(language: string): Promise<{ success: boolean; error?: string }> {
    try {
      this.persistVoiceSettings({ voiceLanguage: language });
      console.log(`[VOICE_MANAGER] Language set: ${language}`);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message };
    }
  }

  // ── Internals ──

  isConversationActive(): boolean {
    try {
      return getNexVoiceConversation().isActive;
    } catch {
      return false;
    }
  }

  isWakeWordEnabled(): boolean {
    try {
      return getNexVoiceConversation().wakeWordEnabled;
    } catch {
      return false;
    }
  }

  /**
   * Persist voice settings to config.json (non-sensitive).
   */
  private persistVoiceSettings(patch: Record<string, any>): void {
    try {
      const state = loadState();
      const settings = (state as any).settings || {};
      const voiceSettings = (settings as any).voice || {};
      (settings as any).voice = { ...voiceSettings, ...patch };
      updateState({ settings } as any);
    } catch (err: any) {
      console.warn(`[VOICE_MANAGER] Failed to persist voice settings: ${err?.message}`);
    }
  }

  /**
   * Load persisted voice settings on startup.
   */
  loadPersistedSettings(): { mode: VoiceMode; activated: boolean; whisperModelPath?: string; piperVoicePath?: string; language?: string } {
    try {
      const state = loadState();
      const settings = (state as any).settings || {};
      const voice = (settings as any).voice || {};
      return {
        mode: (voice.voiceMode as VoiceMode) || 'push-to-talk',
        activated: voice.voiceActivated === true,
        whisperModelPath: voice.whisperModelPath,
        piperVoicePath: voice.piperVoicePath,
        language: voice.voiceLanguage,
      };
    } catch {
      return { mode: 'push-to-talk', activated: false };
    }
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _voiceManager: VoiceManager | null = null;

export function getVoiceManager(): VoiceManager {
  if (!_voiceManager) {
    _voiceManager = new VoiceManager();
  }
  return _voiceManager;
}

export function _resetVoiceManager(): void {
  _voiceManager = null;
}
