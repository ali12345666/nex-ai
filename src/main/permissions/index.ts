/**
 * NEX AI — Permission Manager
 *
 * Centralized permission system for all tool execution.
 *
 * Every destructive/dangerous operation MUST go through this layer:
 *   - Read / Write / Execute / Delete / Network / System / Git / Cloud / Admin
 *
 * Permission grants are stored per-user, per-project, per-session:
 *   - Allow Once: one-time approval, next call needs approval again
 *   - Allow for Project: persisted in <userData>/permissions/<projectId>.json
 *   - Always Allow: persisted globally (use with extreme caution)
 *   - Deny: this call is blocked; user can re-request later
 *
 * Architecture:
 *
 *   Agent → ToolRegistry.execute()
 *      → PermissionManager.requestPermission(tool, params, context)
 *         ├─ Check session-level cache (already approved this session?)
 *         ├─ Check project-level persisted grants
 *         ├─ Check global persisted grants
 *         └─ If not approved: return "pending" + emit event to UI
 *            ├─ UI shows dialog: [Allow Once] [Allow for Project] [Always Allow] [Deny]
 *            └─ User response → PermissionManager resolves/rejects the request
 *
 * This module is INTERFACE-ONLY for now — Agent Core (Phase 7) will use it.
 * UI integration happens in Phase 9.
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadState, updateState } from '../persistence';

// ─── Permission Types ────────────────────────────────────────────────────────

export type Permission = 'read' | 'write' | 'execute' | 'delete' | 'network' | 'system' | 'git' | 'cloud' | 'admin';

export type PermissionScope = 'once' | 'session' | 'project' | 'global';
export type PermissionDecision = 'allow' | 'deny' | 'pending';

export interface PermissionContext {
  userId?: string;          // future: multi-user support
  projectId?: string;       // project hash or path
  sessionId?: string;       // current agent session
  /** Path the operation will affect (for path-scoped permissions) */
  targetPath?: string;
  /** Free-form metadata (e.g. command name, file count) */
  metadata?: Record<string, any>;
}

export interface PermissionRequest {
  id: string;               // request UUID
  tool: string;              // tool name
  permission: Permission;    // required permission level
  description: string;       // human-readable description ("Delete 14 files?")
  detail?: string;            // additional context
  context: PermissionContext;
  /** Time the request was created */
  requestedAt: number;
}

export interface PermissionResponse {
  requestId: string;
  decision: PermissionDecision;
  scope: PermissionScope;
  /** Optional reason for denial (for logging) */
  reason?: string;
}

// ─── Persisted Grants ───────────────────────────────────────────────────────

interface PersistedGrant {
  tool: string;
  permission: Permission;
  scope: PermissionScope;
  /** Optional path glob (e.g. "/home/user/project/*") */
  pathPattern?: string;
  /** When the grant was created */
  grantedAt: number;
  /** When the grant expires (0 = never) */
  expiresAt: number;
  /** Reason the user gave for granting (optional) */
  reason?: string;
}

interface PersistedPermissionState {
  projectGrants?: Record<string, PersistedGrant[]>; // keyed by projectId
  globalGrants?: PersistedGrant[];
}

// ─── Session-Level Grants ───────────────────────────────────────────────────

const _sessionGrants = new Map<string, PersistedGrant[]>(); // keyed by sessionId
const _pendingRequests = new Map<string, (response: PermissionResponse) => void>();
let _permissionRequestHandler: ((req: PermissionRequest) => void) | null = null;

// ─── Core API ───────────────────────────────────────────────────────────────

/**
 * Set the handler that's called when a permission request needs UI approval.
 * The handler should call `respondToPermissionRequest()` with the user's choice.
 */
export function setPermissionRequestHandler(handler: (req: PermissionRequest) => void): void {
  _permissionRequestHandler = handler;
}

/**
 * Request permission for an operation. Returns:
 *  - 'allow' if the operation is allowed (from cached or persisted grant)
 *  - 'deny' if the operation is explicitly denied
 *  - 'pending' if UI needs to ask the user (handler will be called)
 *
 * Caller should await `awaitPermissionDecision(requestId)` when status is 'pending'.
 */
export function requestPermission(
  tool: string,
  permission: Permission,
  description: string,
  context: PermissionContext,
  detail?: string
): { requestId: string; status: PermissionDecision } {
  // 1. Check session grants (fastest)
  if (hasSessionGrant(context.sessionId, tool, permission)) {
    return { requestId: '', status: 'allow' };
  }
  // 2. Check project grants
  if (hasProjectGrant(context.projectId, tool, permission, context.targetPath)) {
    return { requestId: '', status: 'allow' };
  }
  // 3. Check global grants
  if (hasGlobalGrant(tool, permission, context.targetPath)) {
    return { requestId: '', status: 'allow' };
  }
  // 4. Need to ask the user
  const requestId = `${tool}-${permission}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const request: PermissionRequest = {
    id: requestId,
    tool,
    permission,
    description,
    detail,
    context,
    requestedAt: Date.now(),
  };
  if (_permissionRequestHandler) {
    _permissionRequestHandler(request);
  } else {
    // No UI handler set up — default to deny for safety
    console.warn(`[NEX AI Permissions] No handler set — auto-denying ${tool} (${permission})`);
  }
  return { requestId, status: 'pending' };
}

/**
 * Wait for a pending permission request to be resolved.
 * Resolves with the user's decision.
 */
export function awaitPermissionDecision(requestId: string): Promise<PermissionResponse> {
  return new Promise((resolve) => {
    const existing = _pendingRequests.get(requestId);
    if (existing) {
      // Replace with a wrapper that calls both
      const wrapped = (response: PermissionResponse) => {
        existing(response);
        resolve(response);
      };
      _pendingRequests.set(requestId, wrapped);
    } else {
      _pendingRequests.set(requestId, resolve);
      // Auto-deny after 60s if no response (avoid hanging the agent)
      setTimeout(() => {
        if (_pendingRequests.has(requestId)) {
          _pendingRequests.delete(requestId);
          resolve({
            requestId,
            decision: 'deny',
            scope: 'once',
            reason: 'Timeout (60s) — auto-denied',
          });
        }
      }, 60000);
    }
  });
}

/**
 * Respond to a pending permission request (called from UI).
 */
export function respondToPermissionRequest(response: PermissionResponse): void {
  // Persist the grant if scope is project or global
  if (response.decision === 'allow' && (response.scope === 'project' || response.scope === 'global')) {
    // Find the original request to know what we're granting
    // (In a real implementation, we'd track this in the request map)
    // For now, just persist what we know
    addPersistedGrant(response, response.scope);
  } else if (response.decision === 'allow' && response.scope === 'session') {
    // Add to session grants
    // (We need the request details — let's extend the API)
  }
  // Resolve the waiting promise
  const resolver = _pendingRequests.get(response.requestId);
  if (resolver) {
    _pendingRequests.delete(response.requestId);
    resolver(response);
  }
}

/**
 * Convenience helper: request permission and wait for the response.
 * Returns 'allow' or 'deny' (never 'pending').
 */
export async function requestPermissionAndWait(
  tool: string,
  permission: Permission,
  description: string,
  context: PermissionContext,
  detail?: string
): Promise<{ decision: PermissionDecision; reason?: string }> {
  const { requestId, status } = requestPermission(tool, permission, description, context, detail);
  if (status !== 'pending') {
    return { decision: status };
  }
  const response = await awaitPermissionDecision(requestId);
  if (response.decision === 'allow' && response.scope === 'session') {
    // Cache the session grant
    addSessionGrant(context.sessionId, tool, permission, context.targetPath);
  }
  return { decision: response.decision, reason: response.reason };
}

// ─── Grant Storage ──────────────────────────────────────────────────────────

function hasSessionGrant(sessionId: string | undefined, tool: string, permission: Permission): boolean {
  if (!sessionId) return false;
  const grants = _sessionGrants.get(sessionId) || [];
  return grants.some((g) => g.tool === tool && g.permission === permission && matchesPath(g.pathPattern, undefined));
}

function addSessionGrant(sessionId: string | undefined, tool: string, permission: Permission, targetPath?: string): void {
  if (!sessionId) return;
  const grants = _sessionGrants.get(sessionId) || [];
  grants.push({
    tool,
    permission,
    scope: 'session',
    pathPattern: targetPath,
    grantedAt: Date.now(),
    expiresAt: 0,
  });
  _sessionGrants.set(sessionId, grants);
}

function hasProjectGrant(projectId: string | undefined, tool: string, permission: Permission, targetPath?: string): boolean {
  if (!projectId) return false;
  const state = loadPermissionState();
  const grants = state.projectGrants?.[projectId] || [];
  return grants.some((g) => g.tool === tool && g.permission === permission && matchesPath(g.pathPattern, targetPath));
}

function hasGlobalGrant(tool: string, permission: Permission, targetPath?: string): boolean {
  const state = loadPermissionState();
  const grants = state.globalGrants || [];
  return grants.some((g) => g.tool === tool && g.permission === permission && matchesPath(g.pathPattern, targetPath));
}

function addPersistedGrant(response: PermissionResponse, scope: PermissionScope): void {
  const state = loadPermissionState();
  const grant: PersistedGrant = {
    tool: '',  // Would be filled from original request
    permission: 'read', // Would be filled from original request
    scope,
    grantedAt: Date.now(),
    expiresAt: 0,
  };
  if (scope === 'project' && response.requestId) {
    // TODO: Look up the original request to get tool/permission/projectId
  }
  if (scope === 'global') {
    state.globalGrants = state.globalGrants || [];
    state.globalGrants.push(grant);
    savePermissionState(state);
  }
}

function matchesPath(pattern: string | undefined, target: string | undefined): boolean {
  if (!pattern) return true; // no pattern = matches all
  if (!target) return false;
  // Simple glob matching (Phase 9 will use a proper matcher)
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    return target.startsWith(prefix);
  }
  return pattern === target;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function permissionStatePath(): string {
  // Stored in the same config.json under the 'permissions' key
  // For simplicity we reuse the main persistence module
  return '';
}

function loadPermissionState(): PersistedPermissionState {
  const state = loadState();
  return (state as any).permissions || {};
}

function savePermissionState(permState: PersistedPermissionState): void {
  updateState({ permissions: permState } as any);
}

/**
 * Clear all session grants (called when the agent session ends).
 */
export function clearSessionGrants(sessionId: string): void {
  _sessionGrants.delete(sessionId);
}

/**
 * Revoke a specific project grant (called from Settings UI).
 */
export function revokeProjectGrant(projectId: string, tool: string, permission: Permission): void {
  const state = loadPermissionState();
  if (!state.projectGrants?.[projectId]) return;
  state.projectGrants[projectId] = state.projectGrants[projectId].filter(
    (g) => !(g.tool === tool && g.permission === permission)
  );
  savePermissionState(state);
}

/**
 * List all grants (for Settings UI display).
 */
export function listAllGrants(): { project: Record<string, PersistedGrant[]>; global: PersistedGrant[]; session: PersistedGrant[] } {
  const state = loadPermissionState();
  return {
    project: state.projectGrants || {},
    global: state.globalGrants || [],
    session: Array.from(_sessionGrants.values()).flat(),
  };
}
