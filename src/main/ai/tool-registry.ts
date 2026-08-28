/**
 * NEX AI — Tool System
 *
 * Defines the unified Tool interface that ALL tools implement.
 *
 * Agent Core depends ONLY on this interface, never on specific tool
 * implementations. New tools can be added without touching Agent Core.
 *
 * Architecture:
 *
 *   Agent Core
 *      ↓ (depends on)
 *   ToolRegistry
 *      ↓ (looks up by name)
 *   Tool (interface)  ←── FileSystemTool
 *                   ←── TerminalTool
 *                   ←── GitTool
 *                   ←── GitHubTool     (Phase 13)
 *                   ←── CloudflareTool (Phase 14)
 *                   ←── WebTool        (Phase 15)
 *                   ←── KnowledgeTool  (Phase 19)
 *                   ←── CalculationTool
 *                   ←── VisionTool     (Phase 22+)
 *                   ←── [custom tools via Plugin System]  (Phase 34)
 *
 * Tool execution flow:
 *   Agent → ToolRegistry.execute(name, params, context)
 *      → PermissionManager.check(tool, params, context)  ← BLOCKS if denied
 *      → Tool.execute(params, context)
 *      → ToolResult (success/error + structured output)
 */

import type { AIRuntime } from './runtime';
import type { PermissionContext } from '../permissions';

// ─── Core Tool Types ────────────────────────────────────────────────────────

export type ToolCategory =
  | 'filesystem'    // read, write, search, list files
  | 'terminal'      // run shell commands
  | 'powershell'    // Windows-specific PowerShell
  | 'git'           // git operations
  | 'github'        // GitHub API
  | 'cloudflare'    // Cloudflare API
  | 'web'           // web search, fetch
  | 'browser'       // browser automation
  | 'knowledge'     // RAG / knowledge base
  | 'calculation'   // math, engineering calculations
  | 'vision'        // image analysis
  | 'image'         // image generation/editing
  | 'audio'         // speech-to-text, text-to-speech
  | 'video'         // video analysis
  | 'memory'        // memory store operations
  | 'system'        // system info, processes
  | 'agent'         // meta-tools (spawn sub-agents, etc.)
  | 'plugin';       // user-defined tools

/**
 * Required permission level for a tool to execute.
 * Maps directly to PermissionManager permission types.
 */
export type ToolPermission =
  | 'read'        // read files / non-mutating queries
  | 'write'       // create / modify files (non-destructive)
  | 'execute'     // run shell commands (non-destructive)
  | 'delete'      // delete files / destructive ops
  | 'network'     // outbound network calls
  | 'system'      // system info / process inspection
  | 'git'         // git operations (read or write, scoped per-tool)
  | 'cloud'       // cloud provider operations (Cloudflare, GitHub, etc.)
  | 'admin';      // registry, drivers, firewall, install software

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  default?: any;
  enum?: string[];
  items?: ToolParameter;  // for array type
  properties?: Record<string, ToolParameter>;  // for object type
}

export interface ToolDefinition {
  /** Unique tool name, e.g. 'read_file' */
  name: string;
  /** Human-readable description (shown to AI in system prompt) */
  description: string;
  /** Category for grouping in UI */
  category: ToolCategory;
  /** Required permission level */
  permission: ToolPermission;
  /** Whether this tool modifies state (used for diff/apply review) */
  destructive?: boolean;
  /** Whether this tool requires online connectivity */
  requiresNetwork?: boolean;
  /** Parameter schema (JSON Schema-like, simplified) */
  parameters: ToolParameter[];
  /** Return type description */
  returns?: { type: string; description: string };
  /** Tags for filtering (e.g. ['windows', 'filesystem']) */
  tags?: string[];
}

export interface ToolContext {
  /** The project root path (for relative path resolution) */
  projectPath?: string;
  /** The active file path */
  activeFile?: string;
  /** The AI runtime (for tools that need to call back to AI) */
  runtime?: AIRuntime;
  /** The permission context (user, session, project) */
  permission?: PermissionContext;
  /** Arbitrary metadata */
  metadata?: Record<string, any>;
}

export interface ToolResult {
  success: boolean;
  /** Primary output as text (what the AI sees) */
  output?: string;
  /** Structured output (optional, for programmatic use) */
  data?: any;
  /** Error message if success=false */
  error?: string;
  /** Suggested follow-up actions (optional) */
  followUp?: string[];
  /** Files that were modified (for diff/apply review) */
  modifiedFiles?: Array<{ path: string; before?: string; after: string }>;
  /** Duration in milliseconds */
  durationMs?: number;
}

/**
 * The unified Tool interface. Every tool implements this.
 */
export interface Tool {
  /** Tool definition (schema, metadata) */
  readonly definition: ToolDefinition;
  /** Execute the tool with the given parameters */
  execute(params: Record<string, any>, context: ToolContext): Promise<ToolResult>;
}

// ─── Tool Registry ───────────────────────────────────────────────────────────

const _tools = new Map<string, Tool>();

/**
 * Register a tool. Throws if a tool with the same name is already registered.
 */
export function registerTool(tool: Tool): void {
  const name = tool.definition.name;
  if (_tools.has(name)) {
    throw new Error(`Tool "${name}" is already registered`);
  }
  _tools.set(name, tool);
  console.log(`[NEX AI Tools] Registered: ${name} (${tool.definition.category})`);
}

/**
 * Unregister a tool. Returns true if the tool was registered.
 */
export function unregisterTool(name: string): boolean {
  return _tools.delete(name);
}

/**
 * Get a tool by name.
 */
export function getTool(name: string): Tool | undefined {
  return _tools.get(name);
}

/**
 * List all registered tools.
 */
export function listTools(): Tool[] {
  return Array.from(_tools.values());
}

/**
 * List tool definitions (for AI system prompt / UI display).
 */
export function listToolDefinitions(): ToolDefinition[] {
  return Array.from(_tools.values()).map((t) => t.definition);
}

/**
 * Get tool definitions as a JSON schema for LLM tool-calling.
 * (Future: when LLMs support function calling, this is the schema we send.)
 */
export function getToolSchemasForLLM(): any[] {
  return listToolDefinitions().map((def) => ({
    name: def.name,
    description: def.description,
    parameters: {
      type: 'object',
      properties: def.parameters.reduce((acc, p) => {
        acc[p.name] = {
          type: p.type,
          description: p.description,
          ...(p.enum ? { enum: p.enum } : {}),
          ...(p.default !== undefined ? { default: p.default } : {}),
        };
        return acc;
      }, {} as Record<string, any>),
      required: def.parameters.filter((p) => p.required).map((p) => p.name),
    },
  }));
}

/**
 * Execute a tool by name (without permission check — for internal use only).
 * Most callers should use executeToolWithPermission() instead.
 */
export async function executeTool(
  name: string,
  params: Record<string, any>,
  context: ToolContext
): Promise<ToolResult> {
  const tool = _tools.get(name);
  if (!tool) {
    return {
      success: false,
      error: `Tool "${name}" is not registered`,
    };
  }

  const start = Date.now();
  try {
    const result = await tool.execute(params, context);
    return {
      ...result,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Tool "${name}" threw: ${err.message}`,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Execute a tool with permission check.
 *
 * Flow:
 *  1. Look up tool by name
 *  2. Check if tool requires network — if yes and we're offline, fail
 *  3. Request permission from PermissionManager
 *  4. If denied → return ToolResult with error
 *  5. If allowed → call executeTool()
 *
 * This is the entry point Agent Core uses.
 */
export async function executeToolWithPermission(
  name: string,
  params: Record<string, any>,
  context: ToolContext
): Promise<ToolResult> {
  const tool = _tools.get(name);
  if (!tool) {
    return {
      success: false,
      error: `Tool "${name}" is not registered`,
    };
  }
  const def = tool.definition;
  // Permission check
  const permContext = context.permission || {
    projectId: context.projectPath,
    sessionId: context.metadata?.sessionId,
    targetPath: params.path || params.file || params.cwd,
    metadata: params,
  };
  const { requestPermissionAndWait } = await import('../permissions');
  const description = `Tool "${name}" wants to perform "${def.permission}" operation`;
  const detail = def.destructive
    ? `DESTRUCTIVE operation: ${def.description}`
    : def.description;
  const { decision, reason } = await requestPermissionAndWait(
    name,
    def.permission,
    description,
    permContext,
    detail,
  );
  if (decision !== 'allow') {
    return {
      success: false,
      error: `Permission denied for tool "${name}" (${def.permission})${reason ? `: ${reason}` : ''}`,
    };
  }
  return executeTool(name, params, context);
}

// ─── Built-in tools (registered lazily to avoid circular imports) ────────────

let _builtinRegistered = false;

export async function ensureBuiltinToolsRegistered(): Promise<void> {
  if (_builtinRegistered) return;
  _builtinRegistered = true;
  // Register built-in tools. Each tool file exports a singleton instance.
  const { FileSystemTool: FS } = await import('./tools/filesystem-tool');
  const { SearchFilesTool } = await import('./tools/search-files-tool');
  const { ListDirectoryTool } = await import('./tools/list-directory-tool');
  const { GitStatusTool, GitLogTool, GitDiffTool } = await import('./tools/git-tools');
  const { RunCommandTool } = await import('./tools/run-command-tool');
  const { NpmBuildTool, NpmTestTool } = await import('./tools/npm-tools');
  const { CalculationTool } = await import('./tools/calculation-tool');
  const { SystemInfoTool } = await import('./tools/system-info-tool');
  const { LongRunningTestTool } = await import('./tools/long-running-test-tool');
  // Phase 8 / P8-C: advanced coding-agent tools
  const { ReadMultipleFilesTool } = await import('./tools/read-multiple-files-tool');
  const { ProjectStructureTool } = await import('./tools/project-structure-tool');
  const { MultiFileEditTool } = await import('./tools/multi-file-edit-tool');
  // Phase 9 / P9-S4: local knowledge search (offline RAG)
  const { KnowledgeSearchTool } = await import('./tools/knowledge-search-tool');

  registerTool(new FS());
  registerTool(new SearchFilesTool());
  registerTool(new ListDirectoryTool());
  registerTool(new GitStatusTool());
  registerTool(new GitLogTool());
  registerTool(new GitDiffTool());
  registerTool(new RunCommandTool());
  registerTool(new NpmBuildTool());
  registerTool(new NpmTestTool());
  registerTool(new CalculationTool());
  registerTool(new SystemInfoTool());
  registerTool(new LongRunningTestTool());
  registerTool(new ReadMultipleFilesTool());
  registerTool(new ProjectStructureTool());
  registerTool(new MultiFileEditTool());
  registerTool(new KnowledgeSearchTool());

  // Phase 105: New agent tools
  const { WebFetchTool, WebSearchTool } = await import('./tools/web-tool');
  const { AnalyzeImageTool } = await import('./tools/vision-tool');
  const { RememberTool, SearchMemoryTool, ForgetTool } = await import('./tools/memory-tool');
  const { FindSymbolTool, FindReferencesTool } = await import('./tools/code-intelligence-tool');

  registerTool(new WebSearchTool());
  registerTool(new WebFetchTool());
  registerTool(new AnalyzeImageTool());
  registerTool(new RememberTool());
  registerTool(new SearchMemoryTool());
  registerTool(new ForgetTool());
  registerTool(new FindSymbolTool());
  registerTool(new FindReferencesTool());

  // Phase 112: write_file — direct single-file write (no diff approval)
  const { WriteFileTool } = await import('./tools/write-file-tool');
  registerTool(new WriteFileTool());

  // Phase 113: git_commit — complete the git workflow
  const { GitCommitTool } = await import('./tools/git-tools');
  registerTool(new GitCommitTool());
}
