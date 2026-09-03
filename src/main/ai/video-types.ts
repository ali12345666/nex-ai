/**
 * NEX AI — Video Types (Interface-only, Phase 22+)
 *
 * Per project scope: ONLY video analysis. NO video generation.
 *
 * Planned modules (Phase 22+):
 *   video/video-analyzer.ts   — frame extraction, object/event detection
 *   video/audio-analyzer.ts   — extract audio, transcribe speech
 *   video/summarizer.ts        — generate video summary
 */

export interface VideoAnalysisOptions {
  /** Path to local video file */
  videoPath: string;
  /** Sample frames at this rate (frames per second). Default: 1.0 */
  frameRate?: number;
  /** Maximum frames to extract */
  maxFrames?: number;
  /** Enable audio extraction */
  extractAudio?: boolean;
  /** Enable speech transcription */
  transcribeSpeech?: boolean;
  /** Enable object detection */
  detectObjects?: boolean;
  /** Enable event detection */
  detectEvents?: boolean;
}

export interface VideoAnalysisResult {
  success: boolean;
  duration: number;        // video duration in seconds
  frameCount: number;
  /** Extracted frame paths (saved as temp files) */
  frames?: Array<{ path: string; timestamp: number; }>;
  /** Audio extraction */
  audio?: {
    path?: string;
    duration: number;
    sampleRate: number;
  };
  /** Speech transcription */
  transcript?: Array<{
    text: string;
    start: number;
    end: number;
    speaker?: string;
  }>;
  /** Detected objects across frames */
  objects?: Array<{
    frameIndex: number;
    timestamp: number;
    label: string;
    confidence: number;
    bbox?: { x: number; y: number; w: number; h: number };
  }>;
  /** Detected events (e.g. "person enters frame", "scene change") */
  events?: Array<{
    type: string;
    timestamp: number;
    description: string;
    confidence: number;
  }>;
  /** Summary text */
  summary?: string;
  error?: string;
}

export interface VideoAnalyzer {
  /** Analyze a video file */
  analyze(opts: VideoAnalysisOptions): Promise<VideoAnalysisResult>;
  /** Extract audio from video file */
  extractAudio(videoPath: string, outputPath?: string): Promise<{ audioPath: string; duration: number }>;
  /** Extract frames from video */
  extractFrames(videoPath: string, frameRate: number, maxFrames?: number): Promise<Array<{ path: string; timestamp: number }>>;
  /** Generate a summary of the video */
  summarize(analysis: VideoAnalysisResult): Promise<string>;
}
