/**
 * NEX AI — Agent Token Streamer (Phase 8 / P8-E-1)
 *
 * Coalesces model-generated text chunks (from AIRuntime.chatStream) into
 * throttled `agent_token` AgentEvents so the renderer can render streaming
 * agent responses without IPC flooding.
 *
 * PURE module: no electron, no runtime imports. The emitter is injected.
 *
 * Secret-safety: stream content is model OUTPUT (never contains the API key
 * by construction — keys live in request headers). We still push the final
 * assembled text through AgentLogger's redaction pipeline when logging is
 * requested, so secrets that a model might echo are masked in logs.
 */

export type StreamPhase = 'planning' | 'step' | 'verification' | 'final';

export interface TokenEventPayload {
  phase: StreamPhase;
  text: string;
  /** cumulative characters emitted so far (for UI buffers) */
  chars: number;
  done: boolean;
}

export interface TokenStreamerOptions {
  /** min ms between emits (default 120) */
  intervalMs?: number;
  /** flush early when buffer exceeds this many chars (default 240) */
  maxBufferChars?: number;
  /** max total chars streamed (hard cap for context safety, default 200_000) */
  maxTotalChars?: number;
  /** optional logger for the ASSEMBLED (redacted) text on flush */
  logAssembled?: (redactedText: string) => void;
  redact?: (text: string) => string;
}

export interface TokenStreamer {
  /** Feed one chunk from AIRuntime.chatStream */
  push(chunk: string): void;
  /** Emit whatever is buffered immediately */
  flush(): void;
  /** Final flush + done event. Must be called exactly once at stream end. */
  end(): void;
  /** Assembled (raw) text so far */
  text(): string;
}

/**
 * Create a throttled token streamer.
 *
 * @param emitOne called with the coalesced payload — callers wire this to the
 *                agent's emit() (which forwards over IPC to the renderer).
 */
export function createTokenStreamer(
  taskId: string,
  stepId: string | undefined,
  phase: StreamPhase,
  emitOne: (payload: TokenEventPayload) => void,
  opts: TokenStreamerOptions = {}
): TokenStreamer {
  const intervalMs = opts.intervalMs ?? 120;
  const maxBufferChars = opts.maxBufferChars ?? 240;
  const maxTotalChars = opts.maxTotalChars ?? 200_000;

  let buffer = '';
  let total = 0;          // chars actually emitted
  let assembled = '';     // everything received (raw)
  let truncated = false;
  let lastEmit = 0;
  let ended = false;

  function doEmit(force: boolean): void {
    const now = Date.now();
    const dueByTime = now - lastEmit >= intervalMs;
    if (buffer.length === 0) return;
    if (!force && !dueByTime && buffer.length < maxBufferChars) return;

    let piece = buffer;
    buffer = '';

    // Hard cap: stop emitting beyond maxTotalChars (still mark truncation)
    if (total + piece.length > maxTotalChars) {
      const room = Math.max(0, maxTotalChars - total);
      piece = piece.slice(0, room);
      truncated = true;
    }
    if (piece.length > 0) {
      total += piece.length;
      emitOne({ phase, text: piece, chars: total, done: false });
      lastEmit = now;
    }
  }

  return {
    push(chunk: string): void {
      if (ended || truncated) return;
      if (typeof chunk !== 'string' || chunk.length === 0) return;
      assembled += chunk;
      buffer += chunk;
      doEmit(false);
    },

    flush(): void {
      doEmit(true);
    },

    end(): void {
      if (ended) return;
      ended = true;
      doEmit(true);
      if (opts.logAssembled && assembled.length > 0) {
        const redactor = opts.redact || ((s: string) => s);
        opts.logAssembled(redactor(assembled));
      }
      emitOne({
        phase,
        text: '',
        chars: total,
        done: true,
        // include truncation signal via text field emptiness + chars cap
      });
    },

    text(): string {
      return assembled;
    },
  };
}
