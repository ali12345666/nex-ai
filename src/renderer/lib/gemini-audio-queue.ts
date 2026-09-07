/**
 * NEX AI — Gemini Audio Queue (Phase O / O6.4)
 *
 * Renderer-side PCM playback for Gemini Live audio chunks. This is the
 * parallel playback path to the existing Piper WAV playback in App.tsx
 * (`new Audio(fileUrl)`). The two paths are mutually exclusive per turn
 * and coordinate via the SAME `currentAudioRequestId` stale guard.
 *
 * ARCHITECTURE (per O6 design):
 *   - Gemini Live sends raw 16-bit PCM 16kHz mono chunks (base64-decoded in
 *     main, forwarded as Buffer via `voice-tts-pcm-chunk` IPC).
 *   - This class buffers the chunks, decodes Int16 → Float32, wraps in
 *     AudioBuffer, and schedules via AudioBufferSourceNode.start() at the
 *     next available time (using AudioContext.currentTime + accumulated
 *     buffer duration for gapless playback).
 *   - A 5-second buffer cap drops the oldest unplayed chunks if playback
 *     falls behind (prevents unbounded memory growth — Gemini has no
 *     server-side backpressure).
 *   - `flush(requestId)` cancels all scheduled sources for a requestId
 *     (used on barge-in / stop / supersede — SAME requestId semantics as
 *     the existing Piper path).
 *   - `onQueueDrained(requestId, callback)` fires when the queue for a
 *     given requestId is fully played → main calls
 *     `conversation.notifyTtsPlaybackEnded(requestId)` (SAME flow as Piper's
 *     `voice-tts-ended`).
 *
 * SECURITY: No secrets here — only opaque PCM buffers + requestIds. The
 * chunks come from the main process (already sanitized — no API key, no
 * URL, no headers in the payload).
 *
 * NO FAKE ANIMATION: This class plays real audio. If no chunks arrive, no
 * audio plays. If the queue is empty, `onQueueDrained` fires immediately
 * (with a requestId) so the conversation FSM doesn't hang.
 */

// 5-second buffer cap — drop oldest unplayed chunks if exceeded.
// Prevents unbounded memory growth when playback falls behind.
const MAX_BUFFERED_SECONDS = 5;

export class GeminiAudioQueue {
  private audioContext: AudioContext | null = null;
  private scheduledSources: Array<{ source: AudioBufferSourceNode; requestId: number; endTime: number }> = [];
  private bufferedChunks: Array<{ pcm: Float32Array; requestId: number; sampleCount: number }> = [];
  private nextStartTime = 0;
  private currentRequestId: number | null = null;
  private drainedCallbacks: Map<number, Array<() => void>> = new Map();
  private disposed = false;
  private totalSamplesScheduled = 0;

  constructor() {
    // AudioContext is created lazily on first enqueue (browsers require
    // a user gesture before AudioContext can start — the mic permission
    // grant in voice-service.ts counts as that gesture).
  }

  private ensureContext(): AudioContext | null {
    if (this.disposed) return null;
    if (this.audioContext) {
      // Resume if suspended (Electron may start it suspended).
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => { /* best-effort */ });
      }
      return this.audioContext;
    }
    try {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      this.audioContext = new Ctor();
      this.nextStartTime = this.audioContext.currentTime;
      console.log('[GEMINI_AUDIO_QUEUE] AudioContext created (sampleRate=%s)', this.audioContext.sampleRate);
      return this.audioContext;
    } catch (err: any) {
      console.warn('[GEMINI_AUDIO_QUEUE] AudioContext creation failed:', err?.message);
      return null;
    }
  }

  /**
   * Enqueue a raw 16-bit PCM 16kHz mono chunk for playback.
   *
   * @param pcm16Buffer Raw Int16 PCM Buffer from the main process.
   * @param requestId The current TTS requestId (matches the engine's counter).
   */
  enqueue(pcm16Buffer: ArrayBuffer | Uint8Array, requestId: number): void {
    if (this.disposed) return;

    // Stale guard: if a newer requestId is already playing/scheduled, drop
    // this chunk (SAME semantics as App.tsx Piper path).
    if (this.currentRequestId !== null && requestId < this.currentRequestId) {
      console.log('[GEMINI_AUDIO_QUEUE] dropping stale chunk (req=%s, current=%s)', requestId, this.currentRequestId);
      return;
    }

    // If a newer requestId arrives, flush the old queue first (supersede).
    if (this.currentRequestId !== null && requestId > this.currentRequestId) {
      console.log('[GEMINI_AUDIO_QUEUE] newer requestId — flushing old queue (old=%s, new=%s)', this.currentRequestId, requestId);
      this.flush(this.currentRequestId);
    }
    this.currentRequestId = requestId;

    const ctx = this.ensureContext();
    if (!ctx) {
      console.warn('[GEMINI_AUDIO_QUEUE] no AudioContext — dropping chunk');
      return;
    }

    // Decode Int16 PCM → Float32 (normalized -1.0..1.0).
    const view = new DataView(pcm16Buffer instanceof Uint8Array ? pcm16Buffer.buffer : pcm16Buffer);
    const sampleCount = Math.floor(view.byteLength / 2); // 2 bytes per Int16 sample
    if (sampleCount === 0) return;
    const float32 = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      const int16 = view.getInt16(i * 2, true); // little-endian
      float32[i] = int16 / 32768; // normalize to -1..1
    }

    // Resample if the AudioContext's sample rate != 16kHz.
    // AudioContext.sampleRate is typically 44100 or 48000. We need to
    // upsample 16000 → ctx.sampleRate. Simple linear interpolation is
    // acceptable for voice (not music).
    const targetRate = ctx.sampleRate;
    let finalFloat32: Float32Array;
    if (targetRate === 16000) {
      finalFloat32 = float32;
    } else {
      const ratio = targetRate / 16000;
      const upsampledLength = Math.floor(sampleCount * ratio);
      finalFloat32 = new Float32Array(upsampledLength);
      for (let i = 0; i < upsampledLength; i++) {
        const srcIdx = i / ratio;
        const idx0 = Math.floor(srcIdx);
        const idx1 = Math.min(idx0 + 1, sampleCount - 1);
        const frac = srcIdx - idx0;
        finalFloat32[i] = float32[idx0] * (1 - frac) + float32[idx1] * frac;
      }
    }

    // Buffer cap: if the scheduled audio exceeds MAX_BUFFERED_SECONDS, drop
    // the oldest unplayed chunks for this requestId.
    const bufferedSeconds = (this.nextStartTime - ctx.currentTime);
    if (bufferedSeconds > MAX_BUFFERED_SECONDS) {
      console.warn('[GEMINI_AUDIO_QUEUE] buffer overflow (%.2fs > %ss) — dropping oldest', bufferedSeconds, MAX_BUFFERED_SECONDS);
      // Drop the oldest scheduled source that hasn't started yet.
      const dropIdx = this.scheduledSources.findIndex((s) => s.endTime > ctx.currentTime);
      if (dropIdx >= 0) {
        const dropped = this.scheduledSources.splice(dropIdx, 1)[0];
        try { dropped.source.stop(); } catch { /* */ }
      }
    }

    // Wrap in AudioBuffer + schedule via AudioBufferSourceNode.
    try {
      const audioBuffer = ctx.createBuffer(1, finalFloat32.length, targetRate);
      // Copy samples manually (copyToChannel has a TS typing issue with
      // Float32Array<ArrayBufferLike> vs Float32Array<ArrayBuffer> in TS 5.x).
      const channelData = audioBuffer.getChannelData(0);
      channelData.set(finalFloat32);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      // Schedule at nextStartTime (gapless). Update nextStartTime.
      const startTime = Math.max(this.nextStartTime, ctx.currentTime);
      source.start(startTime);
      const duration = finalFloat32.length / targetRate;
      const endTime = startTime + duration;
      this.nextStartTime = endTime;
      this.scheduledSources.push({ source, requestId, endTime });
      this.totalSamplesScheduled += finalFloat32.length;

      // When this source ends, check if the queue for this requestId is drained.
      source.onended = () => {
        // Remove from scheduledSources.
        const idx = this.scheduledSources.findIndex((s) => s.source === source);
        if (idx >= 0) this.scheduledSources.splice(idx, 1);
        // If this was the last source for this requestId, fire drained callbacks.
        const remaining = this.scheduledSources.some((s) => s.requestId === requestId);
        if (!remaining) {
          this.fireDrainedCallbacks(requestId);
        }
      };
    } catch (err: any) {
      console.warn('[GEMINI_AUDIO_QUEUE] enqueue error:', err?.message);
    }
  }

  /**
   * Flush all scheduled sources for a requestId (barge-in / stop / supersede).
   * Mirrors the Piper path's `currentAudioRef.pause()` on stop.
   */
  flush(requestId: number): void {
    const toCancel = this.scheduledSources.filter((s) => s.requestId === requestId);
    for (const entry of toCancel) {
      try { entry.source.stop(); } catch { /* */ }
      try { entry.source.disconnect(); } catch { /* */ }
    }
    this.scheduledSources = this.scheduledSources.filter((s) => s.requestId !== requestId);
    // Reset nextStartTime if we canceled the most-recently-scheduled.
    if (this.scheduledSources.length === 0) {
      if (this.audioContext) this.nextStartTime = this.audioContext.currentTime;
    } else {
      this.nextStartTime = Math.max(...this.scheduledSources.map((s) => s.endTime));
    }
    console.log('[GEMINI_AUDIO_QUEUE] flushed req=%s (canceled %d sources)', requestId, toCancel.length);
  }

  /**
   * Register a callback to fire when the queue for a given requestId is
   * fully played (or flushed). Returns an unsubscribe function.
   */
  onQueueDrained(requestId: number, callback: () => void): () => void {
    if (!this.drainedCallbacks.has(requestId)) {
      this.drainedCallbacks.set(requestId, []);
    }
    this.drainedCallbacks.get(requestId)!.push(callback);
    // If the queue is already empty for this requestId, fire immediately.
    if (!this.scheduledSources.some((s) => s.requestId === requestId)) {
      this.fireDrainedCallbacks(requestId);
    }
    return () => {
      const cbs = this.drainedCallbacks.get(requestId);
      if (cbs) {
        const idx = cbs.indexOf(callback);
        if (idx >= 0) cbs.splice(idx, 1);
        if (cbs.length === 0) this.drainedCallbacks.delete(requestId);
      }
    };
  }

  private fireDrainedCallbacks(requestId: number): void {
    const cbs = this.drainedCallbacks.get(requestId);
    if (cbs) {
      this.drainedCallbacks.delete(requestId);
      for (const cb of cbs) {
        try { cb(); } catch { /* */ }
      }
    }
  }

  /**
   * Check if any sources are currently scheduled/playing for a requestId.
   */
  isPlaying(requestId: number): boolean {
    return this.scheduledSources.some((s) => s.requestId === requestId);
  }

  /**
   * Get diagnostics (for the Activity panel — real data, no fake).
   */
  getDiagnostics(): { scheduledSources: number; bufferedSeconds: number; totalSamplesScheduled: number } {
    const ctx = this.audioContext;
    const bufferedSeconds = ctx ? Math.max(0, this.nextStartTime - ctx.currentTime) : 0;
    return {
      scheduledSources: this.scheduledSources.length,
      bufferedSeconds,
      totalSamplesScheduled: this.totalSamplesScheduled,
    };
  }

  /**
   * Dispose permanently (app shutdown). Cancels all sources, closes AudioContext.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.scheduledSources) {
      try { entry.source.stop(); } catch { /* */ }
      try { entry.source.disconnect(); } catch { /* */ }
    }
    this.scheduledSources = [];
    this.drainedCallbacks.clear();
    if (this.audioContext) {
      try { this.audioContext.close(); } catch { /* */ }
      this.audioContext = null;
    }
    console.log('[GEMINI_AUDIO_QUEUE] disposed');
  }
}

// Singleton — one queue per app lifetime.
let _queue: GeminiAudioQueue | null = null;
export function getGeminiAudioQueue(): GeminiAudioQueue {
  if (!_queue) _queue = new GeminiAudioQueue();
  return _queue;
}
export function _resetGeminiAudioQueue(): void {
  if (_queue) {
    _queue.dispose();
    _queue = null;
  }
}
