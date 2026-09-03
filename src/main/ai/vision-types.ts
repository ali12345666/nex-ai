/**
 * NEX AI — Vision / Image Types (Interface-only, Phase 22+)
 *
 * Defines interfaces for image understanding, OCR, image generation,
 * image editing, and image enhancement.
 *
 * Vision models will be loaded on-demand (not bundled). The user adds them
 * via Model Manager (category='vision' or 'image').
 *
 * Planned modules (Phase 22+):
 *   vision/image-analyzer.ts    — describe image, OCR, scene analysis
 *   vision/circuit-analyzer.ts — analyze schematic / PCB images
 *   vision/blueprint-analyzer.ts — analyze architecture drawings
 *   vision/image-generator.ts  — text-to-image via local SD/diffusion
 *   vision/image-editor.ts     — inpainting, instruction-based editing
 *   vision/image-enhancer.ts   — upscale, denoise, restore
 */

export type VisionCapability =
  | 'image-understanding'    // describe image, answer questions about it
  | 'ocr'                    // extract text from images
  | 'screenshot-analysis'   // analyze UI screenshots
  | 'circuit-analysis'      // analyze schematics, PCBs
  | 'architecture-drawing-analysis'
  | 'image-generation'      // text-to-image
  | 'image-editing'          // instruction-based editing
  | 'image-enhancement'      // upscale, denoise
  | 'image-classification'
  | 'object-detection';

export interface VisionModelInfo {
  id: string;
  name: string;
  path: string;
  capabilities: VisionCapability[];
  inputFormat: 'image' | 'image+text';
  outputFormat: 'text' | 'image' | 'bounding-boxes';
  maxImageSize?: number;
}

export interface VisionInput {
  /** Path to a local image file */
  imagePath?: string;
  /** Base64-encoded image data */
  imageBase64?: string;
  /** Image URL (will be downloaded) */
  imageUrl?: string;
  /** Optional text prompt */
  prompt?: string;
  /** Optional question (for image Q&A) */
  question?: string;
}

export interface VisionResult {
  success: boolean;
  /** Text description or extracted text */
  text?: string;
  /** Structured data (bounding boxes, classifications, etc.) */
  data?: any;
  /** Output image (for generation/editing/enhancement) */
  outputImagePath?: string;
  error?: string;
  durationMs?: number;
}

export interface ImageGeneratorOptions {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  sampler?: string;
}

export interface ImageEditorOptions {
  inputImagePath: string;
  /** Instruction prompt (e.g. "remove the background") */
  prompt: string;
  /** Optional mask image (white = edit, black = keep) */
  maskPath?: string;
}

export interface ImageEnhancerOptions {
  inputImagePath: string;
  operation: 'upscale' | 'denoise' | 'restore' | 'colorize';
  scale?: number; // for upscale (2, 4, 8)
}

// ─── Vision Tool Interface ──────────────────────────────────────────────────

export interface VisionTool {
  readonly capability: VisionCapability;
  /** Process an image input and return a result */
  process(input: VisionInput, opts?: any): Promise<VisionResult>;
}

// ─── OCR-specific ───────────────────────────────────────────────────────────

export interface OCRResult {
  success: boolean;
  text: string;
  /** Detected text with bounding boxes */
  words?: Array<{ text: string; bbox: { x: number; y: number; w: number; h: number }; confidence: number }>;
  /** Detected text with line-level grouping */
  lines?: Array<{ text: string; bbox: { x: number; y: number; w: number; h: number }; confidence: number }>;
  /** Detected language(s) */
  languages?: string[];
  error?: string;
}

// ─── Circuit / Schematic-specific ───────────────────────────────────────────

export interface CircuitAnalysisResult {
  success: boolean;
  /** Detected components on the schematic/PCB */
  components?: Array<{
    type: string;             // 'resistor', 'capacitor', 'IC', etc.
    designator?: string;       // 'R1', 'C2', 'U3'
    value?: string;             // '10kΩ', '100nF'
    bbox?: { x: number; y: number; w: number; h: number };
    confidence: number;
  }>;
  /** Detected nets/connections */
  nets?: Array<{ name?: string; components: string[] }>;
  /** Detected text labels */
  labels?: Array<{ text: string; bbox: any }>;
  error?: string;
}
