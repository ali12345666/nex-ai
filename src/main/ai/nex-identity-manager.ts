/**
 * NEX AI — Identity Manager (Phase 51)
 *
 * NEX's self-awareness: knows who it is, what it can do, what it can't do.
 * Stores identity in nex_identity.json — editable by the user.
 *
 * CRITICAL: This is READ-ONLY self-description. Never takes actions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getUserDataDir } from '../persistence';
import { listModels } from '../ai/model-registry';

export type PersonalityType = 'professional' | 'technical' | 'friendly' | 'patient';

export interface NexIdentity {
  name: string;
  version: string;
  mission: string;
  missionFa: string;
  abilities: string[];
  abilitiesFa: string[];
  limitations: string[];
  limitationsFa: string[];
  rules: string[];
  rulesFa: string[];
  personality: PersonalityType;
  personalityFa: string;
}

export interface NexSelfAwareness {
  identity: NexIdentity;
  installedModels: Array<{ name: string; type: string; category: string }>;
  availableTools: string[];
  capabilities: string[];
  capabilitiesFa: string[];
  cannotDo: string[];
  cannotDoFa: string[];
  activeBrain: string;
  memoryStatus: { ready: boolean; storeCount: number };
  knowledgeStatus: { ready: boolean; documentCount: number };
  voiceStatus: { sttReady: boolean; ttsReady: boolean };
  visionStatus: { ready: boolean; providerName: string | null };
  /** Phase 55: Offline Expert Knowledge Engine — what NEX knows / is missing. */
  expertKnowledgeStatus?: {
    totalPacks: number;
    installedPacks: number;
    missingPacks: number;
    totalDocuments: number;
    installedDocuments: number;
    offline: boolean;
    installedPackNames: string[];
    missingPackNames: string[];
    recommendedForElectronics: number;
  };
  /** Phase 55: Persian self-description of installed vs missing knowledge. */
  expertKnowledgeSummaryFa?: string;
  systemSummary: string;
  systemSummaryFa: string;
}

const DEFAULT_IDENTITY: NexIdentity = {
  name: 'NEX AI',
  version: '1.0.0',
  mission: 'Local intelligent assistant — fully offline, privacy-first',
  missionFa: 'دستیار هوشمند محلی — کاملاً آفلاین، حفظ حریم خصوصی',
  abilities: [
    'Programming & code generation',
    'System analysis & diagnostics',
    'Electronics engineering assistance',
    'Voice recognition (STT)',
    'Text-to-speech (TTS)',
    'Image & vision analysis',
    'Knowledge retrieval (RAG)',
    'Semantic memory',
    'File operations',
    'Terminal execution',
    'Git operations',
    'Project management',
    'Natural voice conversation (Phase 56)',
    'Wake-word detection ("سلام NEX")',
    'Voice permission confirmation',
  ],
  abilitiesFa: [
    'برنامه‌نویسی و تولید کد',
    'تحلیل سیستم و عیب‌یابی',
    'کمک به مهندسی الکترونیک',
    'تشخیص گفتار (STT)',
    'تولید گفتار (TTS)',
    'تحلیل تصویر و بینایی',
    'بازیابی دانش (RAG)',
    'حافظه معنایی',
    'عملیات فایل',
    'اجرای ترمینال',
    'عملیات Git',
    'مدیریت پروژه',
    'گفتگوی طبیعی صوتی (Phase 56)',
    'تشخیص واک‌ورد ("سلام NEX")',
    'تأیید اجازه با صدا',
  ],
  limitations: [
    'Cannot download files without explicit permission',
    'Cannot delete files without explicit permission',
    'Cannot modify system files without permission',
    'Cannot change active model without permission',
    'Cannot access the internet unless explicitly configured',
    'Vision requires a loaded vision model',
    'Voice requires Whisper/Piper binaries installed',
    'Never performs sensitive actions without permission — even by voice',
    'Never uploads audio or uses cloud speech APIs',
  ],
  limitationsFa: [
    'بدون اجازه صریح فایل دانلود نمی‌کند',
    'بدون اجازه صریح فایل حذف نمی‌کند',
    'فایل‌های سیستمی را بدون اجازه تغییر نمی‌دهد',
    'مدل فعال را بدون اجازه تغییر نمی‌دهد',
    'بدون تنظیمات، به اینترنت دسترسی ندارد',
    'بینایی نیازمند مدل vision بارگذاری شده است',
    'صدا نیازمند نصب Whisper/Piper است',
    'هرگز عملیات حساس را بدون اجازه انجام نمی‌دهد — حتی با صدا',
    'هرگز صدا را آپلود نمی‌کند و از API ابری استفاده نمی‌کند',
  ],
  rules: [
    'Never download without permission',
    'Never install without permission',
    'Never delete without permission',
    'Always explain actions before executing',
    'Always use local models first',
    'Always respect user privacy',
    'Always log actions to audit trail',
    'Voice communication is allowed, but never confirm sensitive actions without explicit permission',
    'Voice audio is processed locally only — never uploaded',
  ],
  rulesFa: [
    'هرگز بدون اجازه دانلود نمی‌کند',
    'هرگز بدون اجازه نصب نمی‌کند',
    'هرگز بدون اجازه حذف نمی‌کند',
    'همیشه قبل از اجرا، عملیات را توضیح می‌دهد',
    'همیشه ابتدا از مدل‌های محلی استفاده می‌کند',
    'همیشه به حریم خصوصی کاربر احترام می‌گذارد',
    'همیشه عملیات را در audit log ثبت می‌کند',
    'من می‌توانم با صدا ارتباط برقرار کنم، اما هرگز عملیات حساس را بدون اجازه انجام نمی‌دهم',
    'صدا فقط به‌صورت محلی پردازش می‌شود — هرگز آپلود نمی‌شود',
  ],
  personality: 'professional',
  personalityFa: 'حرفه‌ای',
};

export class NexIdentityManager {
  private identity: NexIdentity;
  private identityPath: string;

  constructor() {
    this.identityPath = path.join(getUserDataDir(), 'nex_identity.json');
    this.identity = this.load();
  }

  private load(): NexIdentity {
    try {
      if (fs.existsSync(this.identityPath)) {
        const data = JSON.parse(fs.readFileSync(this.identityPath, 'utf-8'));
        return { ...DEFAULT_IDENTITY, ...data };
      }
    } catch { /* */ }
    // Save default on first run
    this.save(DEFAULT_IDENTITY);
    return { ...DEFAULT_IDENTITY };
  }

  private save(identity: NexIdentity): void {
    try {
      const tmp = this.identityPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(identity, null, 2), 'utf-8');
      fs.renameSync(tmp, this.identityPath);
    } catch { /* */ }
  }

  getIdentity(): NexIdentity {
    return { ...this.identity };
  }

  updateIdentity(patch: Partial<NexIdentity>): NexIdentity {
    this.identity = { ...this.identity, ...patch };
    this.save(this.identity);
    return { ...this.identity };
  }

  setPersonality(personality: PersonalityType): void {
    const labels: Record<PersonalityType, string> = {
      professional: 'حرفه‌ای',
      technical: 'فنی',
      friendly: 'دوستانه',
      patient: 'صبور',
    };
    this.identity.personality = personality;
    this.identity.personalityFa = labels[personality];
    this.save(this.identity);
  }

  /**
   * Generate self-awareness report.
   * NEX knows what it can and cannot do RIGHT NOW.
   */
  async getSelfAwareness(): Promise<NexSelfAwareness> {
    const models = listModels().filter((m) => m.fileExists);
    const installedModels = models.map((m) => ({
      name: m.name,
      type: m.category || 'general',
      category: m.category || 'general',
    }));

    // Detect capabilities
    const capabilities: string[] = ['chat', 'text-generation'];
    const capabilitiesFa: string[] = ['گفتگو', 'تولید متن'];
    const cannotDo: string[] = [];
    const cannotDoFa: string[] = [];

    if (models.some((m) => (m.capabilities || []).includes('coding'))) {
      capabilities.push('coding');
      capabilitiesFa.push('برنامه‌نویسی');
    } else {
      cannotDo.push('No coding model installed');
      cannotDoFa.push('مدل برنامه‌نویسی نصب نیست');
    }

    if (models.some((m) => (m.capabilities || []).includes('reasoning'))) {
      capabilities.push('reasoning');
      capabilitiesFa.push('استدلال');
    }

    if (models.some((m) => m.category === 'vision')) {
      capabilities.push('vision');
      capabilitiesFa.push('بینایی');
    } else {
      cannotDo.push('No vision model installed');
      cannotDoFa.push('مدل بینایی نصب نیست');
    }

    // Voice
    let sttReady = false;
    let ttsReady = false;
    try {
      const { getLocalVoiceEngine } = await import('../voice/local-voice-engine');
      const ve = getLocalVoiceEngine();
      sttReady = ve.hasLocalSTT;
      ttsReady = ve.hasLocalTTS;
    } catch { /* */ }
    if (sttReady) { capabilities.push('voice-stt'); capabilitiesFa.push('تشخیص گفتار'); }
    else { cannotDo.push('Voice STT not configured'); cannotDoFa.push('تشخیص گفتار تنظیم نشده'); }
    if (ttsReady) { capabilities.push('voice-tts'); capabilitiesFa.push('تولید گفتار'); }
    else { cannotDo.push('Voice TTS not configured'); cannotDoFa.push('تولید گفتار تنظیم نشده'); }

    // Memory
    let memoryReady = false;
    let memoryStoreCount = 0;
    try {
      const { getMemoryRetrievalEngine } = await import('../memory/memory-retrieval-engine');
      const me = getMemoryRetrievalEngine();
      memoryReady = me !== null;
    } catch { /* */ }
    if (memoryReady) { capabilities.push('semantic-memory'); capabilitiesFa.push('حافظه معنایی'); }

    // Knowledge
    let knowledgeReady = false;
    try {
      const { getMemoryRetrievalEngine } = await import('../memory/memory-retrieval-engine');
      knowledgeReady = getMemoryRetrievalEngine() !== null;
    } catch { /* */ }

    // Active brain
    const activeBrain = models.length > 0 ? models[0].name : 'none';

    // Available tools
    let availableTools: string[] = [];
    try {
      const { listToolDefinitions } = await import('../ai/tool-registry');
      availableTools = listToolDefinitions().map((t) => t.name);
    } catch { /* */ }

    // ── Phase 55: Offline Expert Knowledge Engine ──
    // NEX knows which expert knowledge packs are installed, which are missing,
    // and which are recommended. This makes the assistant self-aware of its
    // own offline expertise gaps (e.g. "در زمینه PCB دانش نصب شده دارم.
    // برای RF design نیاز به بسته تخصصی دارم.").
    let expertKnowledgeStatus: NexSelfAwareness['expertKnowledgeStatus'];
    let expertKnowledgeSummaryFa: string | undefined;
    try {
      const { getExpertKnowledgeEngine, DOMAIN_LABELS_FA, knowledgeDomainToExpertDomain } = await import('../knowledge/expert-knowledge-engine');
      const engine = getExpertKnowledgeEngine();
      const status = engine.getKnowledgeStatus();
      const installedPacks = engine.getInstalledPacks();
      const missingPacks = engine.getMissingPacks();
      // Recommended for electronics (the headline example in the Phase 55 spec)
      const electronicsDomain = 'electronics-engineering' as const;
      const recommendedForElectronics = engine.getRecommendedPacks(electronicsDomain).length;

      expertKnowledgeStatus = {
        totalPacks: status.totalPacks,
        installedPacks: status.installedPacks,
        missingPacks: status.missingPacks,
        totalDocuments: status.totalDocuments,
        installedDocuments: status.installedDocuments,
        offline: status.offline,
        installedPackNames: installedPacks.map((p) => p.nameFa),
        missingPackNames: missingPacks.map((p) => p.nameFa),
        recommendedForElectronics,
      };

      // Persian self-description per domain — mirrors the spec example.
      const lines: string[] = [];
      const domains: Array<keyof typeof DOMAIN_LABELS_FA> = [
        'software-engineering', 'electronics-engineering', 'ai-engineering',
        'system-architecture', 'science',
      ];
      for (const dom of domains) {
        const installed = engine.getPacksByDomain(dom).filter((p) => p.installed);
        const missing = engine.getPacksByDomain(dom).filter((p) => !p.installed);
        const labelFa = DOMAIN_LABELS_FA[dom];
        if (installed.length > 0 && missing.length > 0) {
          lines.push(`در زمینه ${labelFa} دانش نصب شده دارم (${installed.map((p) => p.nameFa).join('، ')}). برای ${missing.map((p) => p.nameFa).join('، ')} نیاز به بسته تخصصی دارم.`);
        } else if (installed.length > 0) {
          lines.push(`در زمینه ${labelFa} دانش کامل نصب شده است.`);
        } else if (missing.length > 0) {
          lines.push(`در زمینه ${labelFa} دانش نصب شده ندارم. برای پاسخ تخصصی نیاز به نصب بسته‌های مرتبط دارم.`);
        }
        void knowledgeDomainToExpertDomain;
      }
      expertKnowledgeSummaryFa = lines.join(' ');

      // Promote expert knowledge as a capability
      if (installedPacks.length > 0) {
        capabilities.push('expert-knowledge');
        capabilitiesFa.push('دانش تخصصی آفلاین');
      }
    } catch { /* expert knowledge engine optional — degrade gracefully */ }

    // Summary
    const expertPart = expertKnowledgeStatus ? `, ${expertKnowledgeStatus.installedPacks}/${expertKnowledgeStatus.totalPacks} knowledge packs` : '';
    const expertPartFa = expertKnowledgeStatus ? `، ${expertKnowledgeStatus.installedPacks} از ${expertKnowledgeStatus.totalPacks} بسته دانش` : '';
    const systemSummary = `NEX AI v${this.identity.version}. ${models.length} models, ${availableTools.length} tools, ${capabilities.length} capabilities${expertPart}.`;
    const systemSummaryFa = `NEX AI نسخه ${this.identity.version}. ${models.length} مدل، ${availableTools.length} ابزار، ${capabilities.length} قابلیت فعال${expertPartFa}.`;

    return {
      identity: this.getIdentity(),
      installedModels,
      availableTools,
      capabilities,
      capabilitiesFa,
      cannotDo,
      cannotDoFa,
      activeBrain,
      memoryStatus: { ready: memoryReady, storeCount: memoryStoreCount },
      knowledgeStatus: { ready: knowledgeReady, documentCount: 0 },
      voiceStatus: { sttReady, ttsReady },
      visionStatus: { ready: models.some((m) => m.category === 'vision'), providerName: null },
      expertKnowledgeStatus,
      expertKnowledgeSummaryFa,
      systemSummary,
      systemSummaryFa,
    };
  }

  get identityFilePath(): string {
    return this.identityPath;
  }
}

let _manager: NexIdentityManager | null = null;

export function getNexIdentityManager(): NexIdentityManager {
  if (!_manager) {
    _manager = new NexIdentityManager();
  }
  return _manager;
}
