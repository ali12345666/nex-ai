/**
 * NEX AI — Content Resolver (Phase P1)
 *
 * Resolves file references in ChatMessages BEFORE the transport sees them.
 * Runs in the MAIN PROCESS as a service (NOT an IPC handler). Called by the
 * main-process chat path (routeChat → callProvider → ContentResolver.resolve → transport).
 *
 * Binding (v2.2 §6, v2.3 §6):
 *   - The ContentResolver uses assertPathInside + Permission System + fs.promises.readFile
 *     directly. It does NOT use the 'fs-read-file' IPC (that IPC is for the
 *     renderer→main boundary; the ContentResolver is already in main).
 *   - The Transport receives ResolvedChatMessage[], NOT ChatMessage[].
 *   - ResolvedContentPart.file = TransportFileContent = { type: 'file'; base64; mimeType? }.
 *     NO `path` field — the transport never sees the filesystem path.
 *   - ResolvedFileReference (with path) is internal to the resolver; the
 *     transport NEVER sees it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { assertPathInside } from '../security';

import type {
  ChatMessage,
  ResolvedChatMessage,
  ContentPart,
  ResolvedContentPart,
  ResolvedFileReference,
} from './capabilities';

// ─── ContentResolver interface ─────────────────────────────────────────────

export interface ContentResolverContext {
  projectPath?: string;
  taskId?: string;
}

export interface ContentResolver {
  resolve(messages: ChatMessage[], context: ContentResolverContext): Promise<ResolvedChatMessage[]>;
}

// ─── Implementation ─────────────────────────────────────────────────────────

export class ContentResolverImpl implements ContentResolver {
  async resolve(messages: ChatMessage[], context: ContentResolverContext): Promise<ResolvedChatMessage[]> {
    const resolved: ResolvedChatMessage[] = [];
    for (const msg of messages) {
      resolved.push(await this.resolveMessage(msg, context));
    }
    return resolved;
  }

  private async resolveMessage(msg: ChatMessage, context: ContentResolverContext): Promise<ResolvedChatMessage> {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }
    // content is ContentPart[] — resolve each part
    const resolvedParts: ResolvedContentPart[] = [];
    for (const part of msg.content) {
      resolvedParts.push(await this.resolvePart(part, context));
    }
    return { role: msg.role, content: resolvedParts };
  }

  private async resolvePart(part: ContentPart, context: ContentResolverContext): Promise<ResolvedContentPart> {
    switch (part.type) {
      case 'text':
        return { type: 'text', text: part.text };
      case 'image':
        return { type: 'image', url: part.url, base64: part.base64, mimeType: part.mimeType };
      case 'audio':
        return { type: 'audio', base64: part.base64, url: part.url, mimeType: part.mimeType, sampleRate: part.sampleRate };
      case 'tool_call':
        return { type: 'tool_call', id: part.id, name: part.name, args: part.args };
      case 'tool_result':
        // Recursively resolve nested content
        if (typeof part.content === 'string') {
          return { type: 'tool_result', toolCallId: part.toolCallId, content: part.content };
        }
        const nestedResolved: ResolvedContentPart[] = [];
        for (const np of part.content) {
          nestedResolved.push(await this.resolvePart(np, context));
        }
        return { type: 'tool_result', toolCallId: part.toolCallId, content: nestedResolved };
      case 'file':
        // Resolve the file reference → TransportFileContent (base64, NO path).
        // This is the security boundary — the transport never sees the path.
        return await this.resolveFile(part, context);
      default:
        // Unknown part type — pass through as text (best-effort)
        return { type: 'text', text: '' };
    }
  }

  /**
   * Resolve a file reference to TransportFileContent (base64, NO path).
   * Uses assertPathInside + fs.promises.readFile. The transport never sees the path.
   */
  private async resolveFile(
    part: { type: 'file'; path: string; mimeType?: string },
    context: ContentResolverContext,
  ): Promise<ResolvedContentPart> {
    const filePath = part.path;
    const allowedRoots: string[] = [];
    if (context.projectPath) allowedRoots.push(context.projectPath);

    // Security: assertPathInside — reject paths outside the allowed roots.
    if (allowedRoots.length > 0) {
      try {
        assertPathInside(filePath, allowedRoots);
      } catch (err: any) {
        // Sanitized error — no path leak in the error to the transport.
        throw new Error(`ContentResolver: file path rejected by security boundary`);
      }
    } else {
      // No project path — block all file reads (defense-in-depth).
      throw new Error(`ContentResolver: no project path configured — file reads blocked`);
    }

    // Read the file via fs.promises.readFile (NOT the fs-read-file IPC —
    // that IPC is for the renderer→main boundary; we're already in main).
    let buf: Buffer;
    try {
      buf = await fs.promises.readFile(filePath);
    } catch (err: any) {
      // Sanitized — no path in the error.
      throw new Error(`ContentResolver: file read failed`);
    }

    // Resolve MIME type (default to octet-stream if not provided).
    const mimeType = part.mimeType || this.inferMimeType(filePath);

    // Convert to base64. The transport sees ONLY this — no path.
    const base64 = buf.toString('base64');

    // The returned type is TransportFileContent: { type: 'file'; base64; mimeType? }
    // NO path field — binding (v2.2 §6 P0-2).
    return { type: 'file', base64, mimeType };
  }

  private inferMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const map: Record<string, string> = {
      '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
      '.csv': 'text/csv', '.yaml': 'text/yaml', '.yml': 'text/yaml',
      '.js': 'text/javascript', '.ts': 'text/typescript', '.tsx': 'text/typescript',
      '.css': 'text/css', '.html': 'text/html', '.xml': 'application/xml',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf', '.zip': 'application/zip',
    };
    return map[ext] || 'application/octet-stream';
  }
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _resolver: ContentResolverImpl | null = null;

export function getContentResolver(): ContentResolver {
  if (!_resolver) _resolver = new ContentResolverImpl();
  return _resolver;
}
