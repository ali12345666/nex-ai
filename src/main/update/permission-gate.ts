/**
 * NEX AI — Secure Update Permission System (Phase 43)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CRITICAL SECURITY REQUIREMENT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * NEX AI MUST NEVER autonomously:
 *   - update itself
 *   - download files
 *   - install packages
 *   - remove files
 *   - modify system files
 *   - change configurations
 *
 * EVERY sensitive action requires explicit user approval through:
 *   1. Chat confirmation (typed "confirm" / "تایید می‌کنم")
 *   2. Voice confirmation (Phase 41 local voice pipeline)
 *
 * NO SILENT EXECUTION. EVER.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ─── Permission Levels ─────────────────────────────────────────────────────

export type PermissionLevel = 'SAFE' | 'REQUIRES_APPROVAL' | 'HIGH_RISK';

export interface ActionDescriptor {
  type: 'check-update' | 'show-changelog' | 'show-size' | 'download' | 'install' |
        'delete-file' | 'modify-system' | 'execute-script' | 'modify-config' |
        'install-model' | 'install-dependency';
  description: string;
  targetPath?: string;
  sizeBytes?: number;
  affectedItems?: string[];
  reason?: string;
}

export function classifyAction(action: ActionDescriptor): PermissionLevel {
  switch (action.type) {
    case 'check-update': case 'show-changelog': case 'show-size': return 'SAFE';
    case 'download': case 'install': case 'install-model': case 'install-dependency': case 'modify-config': return 'REQUIRES_APPROVAL';
    case 'delete-file': case 'modify-system': case 'execute-script': return 'HIGH_RISK';
    default: return 'HIGH_RISK';
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ─── Permission Gate ───────────────────────────────────────────────────────

export interface PermissionGateResult {
  approved: boolean;
  confirmationMethod?: 'chat' | 'voice' | 'denied';
  confirmationPhrase?: string;
  denialReason?: string;
  timestamp: number;
}

export interface PermissionGateCallbacks {
  onRequestPermission?: (request: {
    level: PermissionLevel;
    action: ActionDescriptor;
    explanation: string;
    requiredPhrase: string;
  }) => void;
  onCaptureVoiceInput?: () => Promise<string>;
}

export class PermissionGate {
  private callbacks: PermissionGateCallbacks = {};
  private _pendingResolve: ((result: PermissionGateResult) => void) | null = null;
  private _pendingAction: ActionDescriptor | null = null;
  private _pendingLevel: PermissionLevel | null = null;
  private _pendingPhrase: string = '';

  setCallbacks(callbacks: PermissionGateCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  async requestPermission(action: ActionDescriptor): Promise<PermissionGateResult> {
    const level = classifyAction(action);
    const timestamp = Date.now();
    if (level === 'SAFE') {
      return { approved: true, confirmationMethod: 'chat', confirmationPhrase: '(safe action — auto-approved)', timestamp };
    }
    const explanation = this.generateExplanation(action, level);
    const requiredPhrase = this.generateRequiredPhrase(action, level);
    this.callbacks.onRequestPermission?.({ level, action, explanation, requiredPhrase });
    return new Promise<PermissionGateResult>((resolve) => {
      this._pendingResolve = resolve;
      this._pendingAction = action;
      this._pendingLevel = level;
      this._pendingPhrase = requiredPhrase;
    });
  }

  respondToPermissionRequest(userResponse: string): void {
    if (!this._pendingResolve || !this._pendingAction || !this._pendingLevel) return;
    const normalized = userResponse.trim().toLowerCase();
    const accepted = this.isAcceptableConfirmation(normalized, this._pendingLevel, this._pendingAction);
    const result: PermissionGateResult = {
      approved: accepted,
      confirmationMethod: accepted ? 'chat' : 'denied',
      confirmationPhrase: userResponse,
      denialReason: accepted ? undefined : 'Confirmation phrase did not match',
      timestamp: Date.now(),
    };
    this._pendingResolve(result);
    this._pendingResolve = null;
    this._pendingAction = null;
    this._pendingLevel = null;
    this._pendingPhrase = '';
  }

  async respondViaVoice(): Promise<void> {
    if (!this.callbacks.onCaptureVoiceInput) return;
    const transcript = await this.callbacks.onCaptureVoiceInput();
    if (transcript) this.respondToPermissionRequest(transcript);
  }

  private generateExplanation(action: ActionDescriptor, level: PermissionLevel): string {
    const lines: string[] = [];
    lines.push(`⚠️ Action Requested: ${action.description}`);
    if (action.reason) lines.push(`Reason: ${action.reason}`);
    if (action.targetPath) lines.push(`Target: ${action.targetPath}`);
    if (action.sizeBytes) lines.push(`Size: ${formatBytes(action.sizeBytes)}`);
    if (action.affectedItems && action.affectedItems.length > 0) {
      lines.push(`Affected items:`);
      for (const item of action.affectedItems.slice(0, 5)) lines.push(`  - ${item}`);
    }
    lines.push('');
    lines.push(`Permission level: ${level}`);
    if (level === 'REQUIRES_APPROVAL') lines.push('This action modifies your system. Explicit confirmation required.');
    else if (level === 'HIGH_RISK') {
      lines.push('⚠️ HIGH RISK: This action is destructive or modifies system files.');
      lines.push('Strong confirmation required — type the exact phrase below.');
    }
    return lines.join('\n');
  }

  private generateRequiredPhrase(action: ActionDescriptor, level: PermissionLevel): string {
    if (level === 'REQUIRES_APPROVAL') return 'تایید می‌کنم';
    switch (action.type) {
      case 'delete-file': return 'تایید حذف فایل';
      case 'modify-system': return 'تایید تغییر سیستم';
      case 'execute-script': return 'تایید اجرای اسکریپت';
      case 'install': return 'اجازه نصب آپدیت';
      default: return 'تایید عملیات خطرناک';
    }
  }

  private isAcceptableConfirmation(response: string, level: PermissionLevel, action: ActionDescriptor): boolean {
    const standardPhrases = ['تایید می‌کنم', 'بله تایید می‌کنم', 'اجازه می‌دهم', 'انجام بده', 'confirm', 'i confirm', 'yes', 'allow', 'proceed', 'ok'];
    if (level === 'REQUIRES_APPROVAL') return standardPhrases.some((p) => response.includes(p.toLowerCase()));
    const required = this.generateRequiredPhrase(action, level).toLowerCase();
    const variants = [required, required.replace('تایید', 'بله تایید'), 'i confirm ' + action.type.replace('-', ' ')];
    return variants.some((p) => response.includes(p.toLowerCase()));
  }
}

// ─── Voice Permission Verifier ─────────────────────────────────────────────

export class VoicePermissionVerifier {
  private captureFn: (() => Promise<string>) | null = null;
  setCaptureFunction(fn: () => Promise<string>): void { this.captureFn = fn; }
  async captureConfirmation(): Promise<string | null> {
    if (!this.captureFn) return null;
    try { const transcript = await this.captureFn(); return transcript.trim() || null; }
    catch { return null; }
  }
}
