/**
 * NEX AI — Phase 10: browser_extract tool
 *
 * Extract content from the page by selector. Returns text, HTML, or
 * an attribute value.
 *
 * Permission: 'browser'.
 * Security: extracted content is UNTRUSTED — it comes from the web
 * page. We never execute extracted content as agent commands. The
 * content is truncated to a safe size (10KB default) to avoid context
 * window explosion.
 */

import type { Tool, ToolDefinition, ToolResult, ToolContext } from '../../tool-registry';
import { acquireSession, withCrashRecovery } from './helpers';

const MAX_EXTRACT_LENGTH = 10000;

export class BrowserExtractTool implements Tool {
  readonly definition: ToolDefinition = {
    name: 'browser_extract',
    description: 'Extract content from the page by CSS selector. Returns text, HTML, or an attribute value. Content is truncated to 10000 chars.',
    category: 'browser',
    permission: 'browser',
    requiresNetwork: true,
    destructive: false,
    parameters: [
      { name: 'selector', type: 'string', description: 'CSS selector for the element to extract from. Use "body" for the whole page.', required: true },
      { name: 'extract', type: 'string', description: 'What to extract: "text" (default), "html", or "attribute"', required: false, enum: ['text', 'html', 'attribute'], default: 'text' },
      { name: 'attribute', type: 'string', description: 'The attribute name to extract (required when extract="attribute")', required: false },
      { name: 'timeout', type: 'number', description: 'Wait timeout in ms (default: 30000)', required: false, default: 30000 },
    ],
    returns: { type: 'string', description: 'The extracted content (truncated to 10000 chars)' },
    tags: ['browser', 'extraction'],
  };

  async execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult> {
    const selector = params.selector;
    if (!selector) return { success: false, error: 'Missing required parameter: selector' };

    const extractType = params.extract || 'text';
    const attribute = params.attribute;
    if (extractType === 'attribute' && !attribute) {
      return { success: false, error: 'Missing required parameter: attribute (required when extract="attribute")' };
    }

    const acquire = await acquireSession(context);
    if ('error' in acquire) return acquire.error;
    const { session } = acquire;

    const timeout = params.timeout || 30000;

    return withCrashRecovery(session.taskId, async () => {
      try {
        await session.page.waitForSelector(selector, { state: 'attached', timeout });

        let content: string;
        if (extractType === 'text') {
          content = await session.page.textContent(selector, { timeout }) || '';
        } else if (extractType === 'html') {
          content = await session.page.innerHTML(selector, { timeout }) || '';
        } else {
          // attribute
          content = await session.page.getAttribute(selector, attribute, { timeout }) || '';
        }

        const truncated = content.length > MAX_EXTRACT_LENGTH;
        const finalContent = truncated
          ? content.slice(0, MAX_EXTRACT_LENGTH) + '\n...(truncated)'
          : content;

        return {
          success: true,
          output: finalContent,
          data: {
            selector,
            extractType,
            attribute: extractType === 'attribute' ? attribute : undefined,
            length: content.length,
            truncated,
          },
        };
      } catch (err: any) {
        return {
          success: false,
          error: `Extract failed: ${err.message}`,
          data: { selector, extractType },
        };
      }
    });
  }
}
