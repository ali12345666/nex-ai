/**
 * NEX AI — Phase 11: screenshot_desktop tool
 *
 * Capture a screenshot of the entire desktop. Returns the screenshot as
 * a base64-encoded PNG in ToolResult.data.screenshot.
 *
 * MEMORY-ONLY: screenshots are NOT written to disk by default. They live
 * only in the ToolResult, which is held in task.toolCalls for the task's
 * duration.
 *
 * Permission: 'computer'.
 * Security: screenshots may contain sensitive page content (e.g. a logged-
 * in dashboard, password fields). We do NOT log the base64 data (AgentLogger
 * redacts it). The screenshot is treated as untrusted content — never executed.
 *
 * Reuses existing desktopCapturer (Electron) + VisionEngine/LLaVA when
 * available for analysis. No parallel screenshot system.
 */

import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../../tool-registry';
import { acquireSession, withCrashRecovery, recordScreenshot } from './helpers';

export class ScreenshotDesktopTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'screenshot_desktop',
    description: 'Capture a screenshot of the entire desktop. Returns base64 PNG (memory-only — NOT written to disk). Use for visual verification of desktop state.',
    category: 'computer',
    permission: 'computer',
    requiresNetwork: false,
    destructive: false,
    parameters: [
      { name: 'analyze', type: 'boolean', description: 'If true, also run vision analysis (LLaVA) on the screenshot and return the description. Default: false (returns raw base64 only).', required: false, default: false },
      { name: 'prompt', type: 'string', description: 'Prompt for vision analysis (only used if analyze=true). Default: "Describe this screenshot."', required: false },
    ],
    returns: { type: 'object', description: 'Screenshot as base64 PNG (memory-only) + optional vision analysis' },
    tags: ['computer', 'screenshot'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const acquire = await acquireSession(context);
    if ('error' in acquire) return acquire.error;
    const { session } = acquire;

    const analyze = params.analyze === true;
    const prompt = params.prompt || 'Describe this screenshot. Describe the UI, any text visible, and the overall layout.';

    return withCrashRecovery(session.taskId, async () => {
      try {
        // Use Electron's desktopCapturer (reuses existing screenshot infrastructure)
        const { desktopCapturer } = require('electron');
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1920, height: 1080 },
        });
        if (sources.length === 0) {
          return {
            success: false,
            error: 'No screen source found',
          };
        }
        const source = sources[0];
        const pngBuffer = source.thumbnail.toPNG();
        const base64 = pngBuffer.toString('base64');
        const sizeBytes = Buffer.byteLength(base64, 'base64');

        recordScreenshot(session.taskId);

        // Optional: run vision analysis (reuses existing VisionEngine + LLaVA)
        let analysis: string | undefined;
        if (analyze) {
          try {
            // Write to temp file for vision engine (cleaned up immediately after)
            const os = require('os');
            const path = require('path');
            const fs = require('fs');
            const tmpPath = path.join(os.tmpdir(), `nex-screenshot-${Date.now()}.png`);
            fs.writeFileSync(tmpPath, pngBuffer);
            // Import vision engine (lazy — may not be available)
            try {
              const { getVisionEngine } = require('../../../vision/vision-engine');
              const engine = getVisionEngine();
              if (engine && engine.hasProvider) {
                const result = await engine.analyzeImage({
                  imagePath: tmpPath,
                  prompt,
                });
                if (result.success) {
                  analysis = result.output;
                }
              }
            } catch { /* vision engine not available — skip analysis */ }
            // Clean up temp file
            try { fs.unlinkSync(tmpPath); } catch { /* best-effort */ }
          } catch { /* vision analysis failed — continue without */ }
        }

        return {
          success: true,
          output: analyze && analysis
            ? `Screenshot captured (${sizeBytes} bytes). Analysis: ${analysis.slice(0, 500)}`
            : `Screenshot captured (${sizeBytes} bytes base64 PNG)`,
          data: {
            screenshot: base64,  // memory-only — never written to disk by this tool
            format: 'png',
            sizeBytes,
            analyzed: analyze,
            analysis,
            // NOTE: redacted by AgentLogger when emitted as event data
          },
        };
      } catch (err: any) {
        return {
          success: false,
          error: `Screenshot failed: ${err.message}`,
        };
      }
    });
  }
}
