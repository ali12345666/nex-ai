/**
 * NEX AI — Vision Tool
 *
 * Agent tool for image analysis. Wraps the existing VisionEngine
 * (local LLaVA/Qwen2.5-VL via llama.cpp) and exposes it as a tool
 * the agent can invoke.
 *
 * Capabilities:
 *   - analyze_image: full analysis (description, objects, text)
 *   - describe_image: short description
 *   - extract_text: OCR / text extraction from image
 */

import * as path from 'path';
import * as fs from 'fs';
import { assertPathInside } from '../../security';
import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../tool-registry';

export class AnalyzeImageTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'analyze_image',
    description: 'Analyze an image file. Can describe contents, identify objects, or extract text (OCR). Requires a vision model (LLaVA/Qwen2.5-VL) to be installed.',
    category: 'vision',
    permission: 'read',
    parameters: [
      { name: 'image_path', type: 'string', description: 'Path to the image file (PNG, JPG, WebP). Relative to project root or absolute.', required: true },
      { name: 'prompt', type: 'string', description: 'What to look for or describe in the image (default: "Describe this image in detail")', default: 'Describe this image in detail' },
    ],
    returns: { type: 'string', description: 'Analysis result text' },
    tags: ['vision', 'image', 'ocr'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const imagePath = params.image_path;
    if (!imagePath) return { success: false, error: 'Missing required parameter: image_path' };

    const absPath = path.isAbsolute(imagePath) ? imagePath : path.join(context.projectPath || process.cwd(), imagePath);
    const root = context.projectPath || process.cwd();
    const guard = assertPathInside(absPath, [root]);
    if (!guard.ok) return { success: false, error: `Access denied: ${guard.reason}` };

    if (!fs.existsSync(guard.resolved!)) return { success: false, error: `Image not found: ${guard.resolved}` };

    const stat = fs.statSync(guard.resolved!);
    if (!stat.isFile()) return { success: false, error: `Not a file: ${guard.resolved}` };
    if (stat.size > 10 * 1024 * 1024) return { success: false, error: 'Image too large (10MB max)' };

    // Check file extension
    const ext = path.extname(guard.resolved!).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'].includes(ext)) {
      return { success: false, error: `Unsupported image format: ${ext}. Use PNG, JPG, or WebP.` };
    }

    try {
      // Dynamic import to avoid circular dependency
      const { getVisionEngine } = require('../../vision/vision-engine');
      const engine = getVisionEngine();

      if (!engine.hasProvider) {
        return {
          success: false,
          error: 'No vision model installed. Install a vision model (LLaVA/Qwen2.5-VL) from Library → Extensions.',
          followUp: ['Install a vision model to enable image analysis'],
        };
      }

      const prompt = params.prompt || 'Describe this image in detail';
      const result = await engine.analyzeImage({
        imagePath: guard.resolved,
        prompt,
      });

      if (result.success) {
        return {
          success: true,
          output: result.description || result.text || 'Image analyzed successfully',
          data: { imagePath: guard.resolved, prompt, result },
        };
      } else {
        return { success: false, error: result.error || 'Image analysis failed' };
      }
    } catch (err: any) {
      return { success: false, error: `Vision analysis failed: ${err.message}` };
    }
  }
}
