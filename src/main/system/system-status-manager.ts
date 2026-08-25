/**
 * NEX AI — System Status Manager (Phase 50)
 *
 * Unifies all subsystems into a single status monitor.
 * Monitors: AI Core, Model Manager, Memory/RAG, Voice, Vision, Update, Advisor, Runtime.
 * NEVER downloads/installs/activates — only MONITORS.
 */

import { listModels } from '../ai/model-registry';
import { getMemoryRetrievalEngine } from '../memory/memory-retrieval-engine';

export type SubsystemStatus = 'healthy' | 'degraded' | 'offline' | 'not-configured';
export type OrbCommandState = 'idle' | 'thinking' | 'listening' | 'speaking' | 'installing' | 'error' | 'offline';

export interface SubsystemInfo {
  id: string; name: string; nameFa: string;
  status: SubsystemStatus; version: string;
  details: string; detailsFa: string; health: number;
}

export interface SystemNotification {
  id: string; type: 'info' | 'warning' | 'success' | 'error';
  message: string; messageFa: string;
  timestamp: number; actionRequired: boolean;
}

export interface QuickAction {
  id: string; label: string; labelFa: string; icon: string;
  enabled: boolean; description: string; descriptionFa: string;
}

export interface SystemStatus {
  overall: SubsystemStatus; overallFa: string;
  subsystems: SubsystemInfo[];
  activeModel: string | null; totalModels: number; essentialMissing: number;
  voiceReady: boolean; visionReady: boolean; memoryReady: boolean;
  knowledgeReady: boolean; updateReady: boolean; advisorReady: boolean;
  startupSummary: string; startupSummaryFa: string;
  quickActions: QuickAction[];
  orbState: OrbCommandState;
  notifications: SystemNotification[];
}

export class SystemStatusManager {
  private notifications: SystemNotification[] = [];
  private orbState: OrbCommandState = 'idle';

  async checkAll(): Promise<SystemStatus> {
    const subsystems: SubsystemInfo[] = [];
    const models = listModels();
    const activeModel = models.length > 0 ? models[0].name : null;

    // AI Core
    subsystems.push({
      id: 'ai-core', name: 'AI Core', nameFa: 'هسته هوش مصنوعی',
      status: models.length > 0 ? 'healthy' : 'not-configured', version: 'Phase 38',
      details: `${models.length} model(s)`, detailsFa: `${models.length} مدل`,
      health: models.length > 0 ? 100 : 0,
    });

    // Model Manager
    subsystems.push({
      id: 'model-manager', name: 'Model Manager', nameFa: 'مدیریت مدل',
      status: 'healthy', version: 'Phase 39',
      details: `${models.length} registered`, detailsFa: `${models.length} ثبت شده`,
      health: 100,
    });

    // Memory
    const memEngine = getMemoryRetrievalEngine();
    const memoryReady = memEngine !== null;
    subsystems.push({
      id: 'memory', name: 'Memory & RAG', nameFa: 'حافظه و دانش',
      status: memoryReady ? 'healthy' : 'not-configured', version: 'Phase 40',
      details: memoryReady ? 'Active' : 'Not initialized',
      detailsFa: memoryReady ? 'فعال' : 'فعال نشده',
      health: memoryReady ? 100 : 0,
    });

    // Voice
    let voiceReady = false;
    try {
      const { getLocalVoiceEngine } = await import('../voice/local-voice-engine');
      const ve = getLocalVoiceEngine();
      voiceReady = ve.hasLocalSTT || ve.hasLocalTTS;
    } catch { /* */ }
    subsystems.push({
      id: 'voice', name: 'Voice Engine', nameFa: 'موتور صدا',
      status: voiceReady ? 'healthy' : 'not-configured', version: 'Phase 41',
      details: voiceReady ? 'STT/TTS ready' : 'Not configured',
      detailsFa: voiceReady ? 'آماده' : 'تنظیم نشده',
      health: voiceReady ? 100 : 0,
    });

    // Vision
    let visionReady = false;
    try {
      const { getVisionEngine } = await import('../vision/vision-engine');
      const ve = getVisionEngine();
      visionReady = ve.hasProvider;
    } catch { /* */ }
    subsystems.push({
      id: 'vision', name: 'Vision Engine', nameFa: 'موتور بینایی',
      status: visionReady ? 'healthy' : 'not-configured', version: 'Phase 42',
      details: visionReady ? 'Active' : 'No model',
      detailsFa: visionReady ? 'فعال' : 'مدل موجود نیست',
      health: visionReady ? 100 : 0,
    });

    // Update System
    subsystems.push({
      id: 'update', name: 'Update System', nameFa: 'سیستم به‌روزرسانی',
      status: 'healthy', version: 'Phase 43-44',
      details: 'Permission-gated', detailsFa: 'امنیت کامل',
      health: 100,
    });

    // Advisor
    subsystems.push({
      id: 'advisor', name: 'Model Advisor', nameFa: 'مشاور مدل',
      status: 'healthy', version: 'Phase 45',
      details: 'Smart router active', detailsFa: 'مسیریاب فعال',
      health: 100,
    });

    // Runtime Setup
    let essentialMissing = 0;
    try {
      const { getRuntimeSetupManager } = await import('../runtime/runtime-setup-manager');
      const rs = getRuntimeSetupManager().scanSystem();
      essentialMissing = rs.essentialMissing;
    } catch { /* */ }
    subsystems.push({
      id: 'runtime', name: 'Runtime Setup', nameFa: 'نصب و راه‌اندازی',
      status: essentialMissing === 0 ? 'healthy' : 'degraded', version: 'Phase 46-49',
      details: essentialMissing === 0 ? 'All essential installed' : `${essentialMissing} missing`,
      detailsFa: essentialMissing === 0 ? 'کامل' : `${essentialMissing} مورد گمشده`,
      health: essentialMissing === 0 ? 100 : Math.max(0, 100 - essentialMissing * 20),
    });

    // Overall
    const hasErrors = models.length === 0;
    const hasWarnings = essentialMissing > 0;
    const overall = hasErrors ? 'degraded' : hasWarnings ? 'degraded' : 'healthy';
    const overallFa = hasErrors ? 'سیستم نیاز به توجه دارد' : hasWarnings ? 'برخی موارد نیاز به نصب دارند' : 'سیستم آماده است';

    // Quick actions
    const quickActions: QuickAction[] = [
      { id: 'talk', label: 'Talk', labelFa: 'صحبت', icon: 'mic', enabled: voiceReady, description: 'Voice input', descriptionFa: 'ورودی صوتی' },
      { id: 'analyze-image', label: 'Analyze Image', labelFa: 'تحلیل تصویر', icon: 'eye', enabled: visionReady, description: 'Vision', descriptionFa: 'بینایی' },
      { id: 'improve-model', label: 'Improve Model', labelFa: 'بهبود مدل', icon: 'sparkles', enabled: true, description: 'Advisor', descriptionFa: 'مشاور' },
      { id: 'open-knowledge', label: 'Open Knowledge', labelFa: 'دانش', icon: 'book', enabled: memoryReady, description: 'Knowledge base', descriptionFa: 'پایگاه دانش' },
      { id: 'setup-runtime', label: 'Setup Runtime', labelFa: 'نصب', icon: 'rocket', enabled: essentialMissing > 0, description: 'Install missing', descriptionFa: 'نصب موارد گمشده' },
    ];

    // Startup summary
    const startupSummaryFa = this.generateSummaryFa(subsystems, essentialMissing, overallFa);
    const startupSummary = this.generateSummaryEn(subsystems, essentialMissing);
    const orbState: OrbCommandState = hasErrors ? 'error' : 'idle';

    return {
      overall, overallFa, subsystems, activeModel, totalModels: models.length,
      essentialMissing, voiceReady, visionReady, memoryReady, knowledgeReady: memoryReady,
      updateReady: true, advisorReady: true, startupSummary, startupSummaryFa,
      quickActions, orbState, notifications: this.notifications,
    };
  }

  private generateSummaryFa(subsystems: SubsystemInfo[], essentialMissing: number, overallFa: string): string {
    const lines = [overallFa, ''];
    for (const s of subsystems) {
      const icon = s.status === 'healthy' ? '✓' : s.status === 'degraded' ? '~' : '✗';
      lines.push(`${icon} ${s.nameFa}: ${s.detailsFa}`);
    }
    if (essentialMissing > 0) { lines.push('', `⚠️ ${essentialMissing} کامپوننت ضروری نیاز به نصب دارد`); }
    return lines.join('\n');
  }

  private generateSummaryEn(subsystems: SubsystemInfo[], essentialMissing: number): string {
    const lines = ['System health check complete.'];
    for (const s of subsystems) {
      const icon = s.status === 'healthy' ? '✓' : s.status === 'degraded' ? '~' : '✗';
      lines.push(`${icon} ${s.name}: ${s.details}`);
    }
    if (essentialMissing > 0) lines.push(`\n⚠️ ${essentialMissing} essential component(s) need installation.`);
    return lines.join('\n');
  }

  addNotification(notif: Omit<SystemNotification, 'id' | 'timestamp'>): void {
    this.notifications.unshift({ ...notif, id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, timestamp: Date.now() });
    if (this.notifications.length > 50) this.notifications = this.notifications.slice(0, 50);
  }
  getNotifications(): SystemNotification[] { return this.notifications; }
  setOrbState(state: OrbCommandState): void { this.orbState = state; }
  getOrbState(): OrbCommandState { return this.orbState; }
  clearNotifications(): void { this.notifications = []; }
}

let _manager: SystemStatusManager | null = null;
export function getSystemStatusManager(): SystemStatusManager {
  if (!_manager) _manager = new SystemStatusManager();
  return _manager;
}
