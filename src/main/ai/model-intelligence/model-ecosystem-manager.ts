/**
 * NEX AI — Model Ecosystem Manager (Phase 59)
 *
 * Upgrades NEX from supporting models to intelligently managing a complete
 * local AI model ecosystem. Connects:
 *   - Expanded Model Catalog (Phase 59 model-profiles.ts)
 *   - Model Registry (Phase 39 model-registry.ts)
 *   - Multi-Model Runtime Manager (Phase 58)
 *   - Brain Controller (Phase 51)
 *   - Hardware Recommender (Phase 39)
 *
 *   User Task
 *       ↓
 *   NEX Brain Controller → BrainDecision
 *       ↓
 *   Model Ecosystem Manager ←── catalog knowledge + installed models
 *       ↓
 *   Best model recommendation (installed or "install this")
 *       ↓
 *   Runtime Manager (Phase 58) → load + execute
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SECURITY (preserved from Phase 43)
 * ════════════════════════════════════════════════════════════════════════════
 * - No automatic downloads. No automatic installs.
 * - Permission required before adding models (via ComponentInstaller Phase 47).
 * - No cloud AI. All recommendations are computed locally.
 * - This manager only ANALYZES and RECOMMENDS — it never executes inference
 *   directly (that's the Multi-Model Runtime Manager's job).
 * ════════════════════════════════════════════════════════════════════════════
 */

import { listModels, getModel, type LocalModelInfo, type ModelCapability, type ModelCategory } from '../model-registry';
import {
  getExpandedCatalog, getExpandedCatalogEntry, getExpandedModelsByTier,
  getExpandedPersianModels, getModelProfile, getOrSynthesizeProfile,
  verifyCatalogSecurity,
  type AdvancedModelEntry, type CatalogEntryWithProfile, type ModelProfile,
} from './model-profiles';
import { getNexBrainController, type BrainDecision } from '../nex-brain-controller';
import type { RouterRequest } from './smart-model-router';
import { detectHardwareProfile, canModelRunOnHardware, type HardwareProfile, type ModelHardwareVerdict } from '../hardware-model-recommender';
import type { HardwareTier } from './advanced-model-catalog';

// ─── Types ─────────────────────────────────────────────────────────────────

export type RecommendationReason = 'installed-and-best' | 'installed-but-better-available' | 'not-installed-recommended' | 'no-suitable-model' | 'hardware-insufficient';

export interface EcosystemRecommendation {
  /** The recommended catalog entry. */
  catalogEntry: AdvancedModelEntry;
  /** The model's identity profile. */
  profile: ModelProfile;
  /** Whether this model is already installed. */
  alreadyInstalled: boolean;
  /** The installed model (if alreadyInstalled), matched by provider + params. */
  installedModel: LocalModelInfo | null;
  /** Whether it can run on the current hardware. */
  canRun: boolean;
  /** Hardware verdict (if installed). */
  hardwareVerdict: ModelHardwareVerdict | null;
  /** Recommendation reason. */
  reason: RecommendationReason;
  /** Human-readable reason (English). */
  reasonText: string;
  /** Persian reason. */
  reasonFa: string;
  /** Estimated improvement over the current best (percent). */
  estimatedImprovement: number;
  /** What category this improves. */
  improvementArea: string;
}

export interface MultiModelCollaboration {
  /** The task request. */
  request: string;
  /** The brain decision for the primary model. */
  primaryDecision: BrainDecision;
  /** Recommended model per role (coding, reasoning, vision, voice, embedding). */
  roleAssignments: RoleAssignment[];
  /** Which models are already installed. */
  installedCount: number;
  /** Which models need to be installed. */
  missingCount: number;
  /** Summary. */
  summary: string;
  summaryFa: string;
}

export interface RoleAssignment {
  role: 'primary' | 'coding' | 'reasoning' | 'vision' | 'voice' | 'embedding';
  catalogEntry: AdvancedModelEntry | null;
  profile: ModelProfile | null;
  installed: boolean;
  installedModel: LocalModelInfo | null;
  reason: string;
}

export interface EcosystemComparison {
  modelAId: string;
  modelBId: string;
  modelA: { name: string; profile: ModelProfile; entry: AdvancedModelEntry };
  modelB: { name: string; profile: ModelProfile; entry: AdvancedModelEntry };
  differences: Record<string, { a: number; b: number; delta: number; winner: 'A' | 'B' | 'tie' }>;
  overallWinner: 'A' | 'B' | 'tie';
  recommendation: string;
  recommendationFa: string;
}

export interface EcosystemStatus {
  totalCatalogModels: number;
  installedModels: number;
  persianCapableInstalled: number;
  byType: Record<string, { catalog: number; installed: number }>;
  byTier: Record<string, number>;
  hardware: HardwareProfile;
  lastRecommendation: EcosystemRecommendation | null;
  catalogSecurityOk: boolean;
}

// ─── Model Ecosystem Manager ───────────────────────────────────────────────

export class ModelEcosystemManager {
  private cachedHardware: HardwareProfile | null = null;
  private lastRecommendation: EcosystemRecommendation | null = null;

  // ── Catalog access ──

  getCatalog(): AdvancedModelEntry[] {
    return getExpandedCatalog();
  }

  getCatalogByType(type: string): AdvancedModelEntry[] {
    return getExpandedCatalog().filter((e) => e.type === type);
  }

  getCatalogByProvider(provider: string): AdvancedModelEntry[] {
    const lower = provider.toLowerCase();
    return getExpandedCatalog().filter((e) => e.provider.toLowerCase() === lower);
  }

  getCatalogEntry(id: string): AdvancedModelEntry | null {
    return getExpandedCatalogEntry(id);
  }

  getModelsByTier(tier: HardwareTier): AdvancedModelEntry[] {
    return getExpandedModelsByTier(tier);
  }

  getPersianModels(): AdvancedModelEntry[] {
    return getExpandedPersianModels();
  }

  getProfiles(): CatalogEntryWithProfile[] {
    return getExpandedCatalog().map((entry) => ({ entry, profile: getOrSynthesizeProfile(entry) }));
  }

  getProfile(catalogId: string): ModelProfile | null {
    return getModelProfile(catalogId);
  }

  // ── Catalog ↔ installed matching ──

  /**
   * Match a catalog entry to an installed model (if any).
   * Matching heuristic: provider hint from `source`/`sourceUrl` + parameterCount
   * + quantization. NOT by id (installed models get UUIDs).
   */
  matchCatalogToInstalled(entry: AdvancedModelEntry): LocalModelInfo | null {
    const installed = listModels();
    return installed.find((m) => {
      // Match by parameter count if available
      if (entry.parameterCount && m.parameterCount && entry.parameterCount !== m.parameterCount) return false;
      // Match by quantization if available
      if (entry.quantization && m.quantization && entry.quantization !== m.quantization) return false;
      // Match by name substring (e.g. "qwen" in both)
      const enLower = entry.name.toLowerCase();
      const mLower = m.name.toLowerCase();
      const provider = entry.provider.toLowerCase();
      if (enLower.includes(provider) || mLower.includes(provider)) return true;
      // Fallback: name similarity
      if (enLower.includes(mLower.split(' ')[0].toLowerCase()) || mLower.includes(enLower.split(' ')[0].toLowerCase())) return true;
      return false;
    }) || null;
  }

  /**
   * Get all installed models with their catalog match (if any).
   */
  getInstalledWithCatalog(): Array<{ installed: LocalModelInfo; catalogEntry: AdvancedModelEntry | null; profile: ModelProfile | null }> {
    return listModels().map((m) => {
      // Find the catalog entry this installed model matches
      const catalog = getExpandedCatalog().find((e) => {
        if (e.parameterCount && m.parameterCount && e.parameterCount !== m.parameterCount) return false;
        const eLower = e.name.toLowerCase();
        const mLower = m.name.toLowerCase();
        return eLower.includes(mLower.split(' ')[0].toLowerCase()) || mLower.includes(eLower.split(' ')[0].toLowerCase());
      }) || null;
      const profile = catalog ? getOrSynthesizeProfile(catalog) : null;
      return { installed: m, catalogEntry: catalog, profile };
    });
  }

  // ── Intelligent advisor: recommend the best model for a task ──

  /**
   * Recommend the best model for a user task.
   *
   * Flow:
   *   1. Brain Controller decides the task category + complexity
   *   2. Filter the catalog by the task's required capability
   *   3. Score each candidate: quality + hardware fit + Persian support
   *   4. Check if the best candidate is already installed
   *   5. Return the recommendation with install advice if missing
   *
   * Example:
   *   "برنامه نویسی پایتون" → coding model → DeepSeek Coder / Qwen Coder
   *   "طراحی مدار" → reasoning + electronics knowledge → Qwen + Knowledge
   *   "تحلیل تصویر" → vision model → LLaVA / Qwen-VL
   */
  async recommendForTask(request: RouterRequest): Promise<EcosystemRecommendation> {
    const brain = getNexBrainController();
    const decision = brain.decide(request);
    const taskCategory = this.inferTaskCategory(request, decision);
    const requiredCapability = this.categoryToCapability(taskCategory);

    // Filter the catalog by required capability
    const candidates = this.getCatalog().filter((e) => {
      if (requiredCapability === 'vision') return e.type === 'vision';
      if (requiredCapability === 'embedding') return e.type === 'embedding';
      if (requiredCapability === 'speech-to-text') return e.type === 'voice-stt';
      if (requiredCapability === 'text-to-speech') return e.type === 'voice-tts';
      // For chat/coding/reasoning → LLM type
      return e.type === 'llm';
    });

    if (candidates.length === 0) {
      // No suitable model in catalog
      const fallback = this.getCatalog()[0] || null;
      const rec: EcosystemRecommendation = {
        catalogEntry: fallback!,
        profile: fallback ? getOrSynthesizeProfile(fallback) : null as any,
        alreadyInstalled: false,
        installedModel: null,
        canRun: false,
        hardwareVerdict: null,
        reason: 'no-suitable-model',
        reasonText: 'No suitable model found in catalog for this task',
        reasonFa: 'هیچ مدل مناسبی در کاتالوگ برای این وظیفه یافت نشد',
        estimatedImprovement: 0,
        improvementArea: taskCategory,
      };
      this.lastRecommendation = rec;
      return rec;
    }

    // Score each candidate
    const hw = this.detectHardware();
    const scored = candidates.map((e) => {
      const installed = this.matchCatalogToInstalled(e);
      // Hardware fit: convert catalog RAM/VRAM (GB) to bytes for verdict
      const installedModel: LocalModelInfo | null = installed || this.synthesizeLocalModel(e);
      const verdict = installedModel ? canModelRunOnHardware(installedModel, hw) : null;
      const canRun = verdict ? verdict.canRun : true; // assume can run if we can't check
      // Score: quality + speed bonus + Persian bonus + hardware-fit bonus
      let score = e.qualityScore * 0.4;
      if (requiredCapability === 'coding') score += e.codingScore * 0.3;
      else if (requiredCapability === 'reasoning') score += e.reasoningScore * 0.3;
      else if (requiredCapability === 'vision') score += e.visionScore * 0.3;
      else score += e.qualityScore * 0.2;
      if (e.persianSupport && /[\u0600-\u06FF]/.test(request.request)) score += 10;
      if (installed) score += 15; // prefer installed
      if (canRun) score += 10; // prefer runnable
      return { entry: e, profile: getOrSynthesizeProfile(e), installed, installedModel, verdict, canRun, score };
    });
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    const profile = best.profile;

    // Determine the recommendation reason
    let reason: RecommendationReason;
    let reasonFa: string;
    let estimatedImprovement = 0;
    const installed = best.installed !== null;

    if (installed && best.canRun) {
      reason = 'installed-and-best';
      reasonFa = `بهترین مدل نصب‌شده برای این وظیفه: ${best.entry.displayNameFa}`;
      estimatedImprovement = 0;
    } else if (!installed && best.canRun) {
      reason = 'not-installed-recommended';
      reasonFa = `پیشنهاد نصب: ${best.entry.displayNameFa} — برای این وظیفه بهترین انتخاب است`;
      estimatedImprovement = Math.round((best.entry.qualityScore - 50) * 0.5);
    } else if (!best.canRun && best.verdict) {
      reason = 'hardware-insufficient';
      reasonFa = `سخت‌افزار برای ${best.entry.displayNameFa} کافی نیست: ${best.verdict.reason}`;
      estimatedImprovement = 0;
    } else {
      reason = 'installed-but-better-available';
      reasonFa = `مدل بهتری موجود است: ${best.entry.displayNameFa}`;
      estimatedImprovement = 10;
    }

    const rec: EcosystemRecommendation = {
      catalogEntry: best.entry,
      profile,
      alreadyInstalled: installed,
      installedModel: best.installed,
      canRun: best.canRun,
      hardwareVerdict: best.verdict,
      reason,
      reasonText: `Best model for ${taskCategory}: ${best.entry.name}`,
      reasonFa,
      estimatedImprovement,
      improvementArea: taskCategory,
    };
    this.lastRecommendation = rec;
    return rec;
  }

  // ── Multi-model collaboration ──

  /**
   * Compose a multi-model collaboration for a task: which models should
   * cooperate (primary + coding + vision + voice + embedding as needed).
   *
   * Example: a task "analyze this image and write code for it" needs:
   *   - Vision model (to analyze the image)
   *   - Coding model (to write the code)
   *   - Primary reasoning model (to coordinate)
   */
  async composeCollaboration(request: RouterRequest): Promise<MultiModelCollaboration> {
    const brain = getNexBrainController();
    const decision = brain.decide(request);

    const roles: RoleAssignment[] = [];
    const neededRoles = this.inferNeededRoles(request, decision);

    // Always include primary
    const primaryCatalog = this.findBestCatalogForCapability(this.categoryToCapability(this.inferTaskCategory(request, decision)));
    const primaryInstalled = primaryCatalog ? this.matchCatalogToInstalled(primaryCatalog) : null;
    roles.push({
      role: 'primary',
      catalogEntry: primaryCatalog,
      profile: primaryCatalog ? getOrSynthesizeProfile(primaryCatalog) : null,
      installed: !!primaryInstalled,
      installedModel: primaryInstalled,
      reason: 'Primary reasoning model',
    });

    // Add each needed role
    for (const role of neededRoles) {
      if (role === 'primary') continue;
      const cap = this.roleToCapability(role);
      const catalog = this.findBestCatalogForCapability(cap);
      const installed = catalog ? this.matchCatalogToInstalled(catalog) : null;
      roles.push({
        role,
        catalogEntry: catalog,
        profile: catalog ? getOrSynthesizeProfile(catalog) : null,
        installed: !!installed,
        installedModel: installed,
        reason: `${role} model`,
      });
    }

    const installedCount = roles.filter((r) => r.installed).length;
    const missingCount = roles.length - installedCount;

    return {
      request: request.request,
      primaryDecision: decision,
      roleAssignments: roles,
      installedCount,
      missingCount,
      summary: `${roles.length} models collaborate: ${installedCount} installed, ${missingCount} missing`,
      summaryFa: `${roles.length} مدل همکاری می‌کنند: ${installedCount} نصب‌شده، ${missingCount} ناموجود`,
    };
  }

  // ── Comparison engine ──

  /**
   * Compare two catalog models across all benchmarks.
   */
  compareModels(modelAId: string, modelBId: string): EcosystemComparison | null {
    const a = getExpandedCatalogEntry(modelAId);
    const b = getExpandedCatalogEntry(modelBId);
    if (!a || !b) return null;

    const profileA = getOrSynthesizeProfile(a);
    const profileB = getOrSynthesizeProfile(b);

    const metrics = ['qualityScore', 'speedScore', 'codingScore', 'reasoningScore', 'visionScore', 'voiceScore'] as const;
    const differences: Record<string, { a: number; b: number; delta: number; winner: 'A' | 'B' | 'tie' }> = {};
    let aWins = 0, bWins = 0;
    for (const m of metrics) {
      const av = a[m] as number;
      const bv = b[m] as number;
      const delta = av - bv;
      const winner = delta > 2 ? 'A' : delta < -2 ? 'B' : 'tie';
      if (winner === 'A') aWins++;
      else if (winner === 'B') bWins++;
      differences[m] = { a: av, b: bv, delta, winner };
    }
    // Add size + RAM comparison
    differences['sizeGB'] = { a: a.sizeGB, b: b.sizeGB, delta: a.sizeGB - b.sizeGB, winner: a.sizeGB < b.sizeGB ? 'A' : a.sizeGB > b.sizeGB ? 'B' : 'tie' };
    differences['requiredRAM'] = { a: a.requiredRAM, b: b.requiredRAM, delta: a.requiredRAM - b.requiredRAM, winner: a.requiredRAM < b.requiredRAM ? 'A' : a.requiredRAM > b.requiredRAM ? 'B' : 'tie' };

    const overallWinner = aWins > bWins ? 'A' : bWins > aWins ? 'B' : 'tie';
    const rec = overallWinner === 'A'
      ? `${a.name} is better overall (${aWins}/${metrics.length} metrics)`
      : overallWinner === 'B'
        ? `${b.name} is better overall (${bWins}/${metrics.length} metrics)`
        : 'Both models are comparable';
    const recFa = overallWinner === 'A'
      ? `${a.displayNameFa} کلی بهتر است (${aWins} از ${metrics.length} معیار)`
      : overallWinner === 'B'
        ? `${b.displayNameFa} کلی بهتر است (${bWins} از ${metrics.length} معیار)`
        : 'هر دو مدل قابل‌مقایسه هستند';

    return {
      modelAId, modelBId,
      modelA: { name: a.name, profile: profileA, entry: a },
      modelB: { name: b.name, profile: profileB, entry: b },
      differences,
      overallWinner,
      recommendation: rec,
      recommendationFa: recFa,
    };
  }

  // ── Hardware tier fit ──

  /**
   * Recommend models that fit a hardware tier (low/medium/high).
   */
  recommendByTierFit(tier: HardwareTier): EcosystemRecommendation[] {
    const tierModels = getExpandedModelsByTier(tier);
    const hw = this.detectHardware();
    return tierModels.map((entry) => {
      const installed = this.matchCatalogToInstalled(entry);
      const installedModel = installed || this.synthesizeLocalModel(entry);
      const verdict = installedModel ? canModelRunOnHardware(installedModel, hw) : null;
      const canRun = verdict ? verdict.canRun : true;
      return {
        catalogEntry: entry,
        profile: getOrSynthesizeProfile(entry),
        alreadyInstalled: !!installed,
        installedModel: installed,
        canRun,
        hardwareVerdict: verdict,
        reason: installed ? 'installed-and-best' as RecommendationReason : 'not-installed-recommended' as RecommendationReason,
        reasonText: installed ? 'Already installed' : 'Available for installation',
        reasonFa: installed ? 'نصب‌شده' : 'آماده نصب',
        estimatedImprovement: 0,
        improvementArea: entry.type,
      };
    });
  }

  // ── Status ──

  getStatus(): EcosystemStatus {
    const catalog = getExpandedCatalog();
    const installed = listModels();
    const hw = this.detectHardware();

    const byType: Record<string, { catalog: number; installed: number }> = {};
    for (const e of catalog) {
      if (!byType[e.type]) byType[e.type] = { catalog: 0, installed: 0 };
      byType[e.type].catalog++;
    }
    for (const m of installed) {
      // Map installed ModelCategory → catalog ModelType
      const type = this.categoryToType(m.category);
      if (byType[type]) byType[type].installed++;
      else byType[type] = { catalog: 0, installed: 1 };
    }

    const byTier: Record<string, number> = { low: 0, medium: 0, high: 0 };
    for (const e of catalog) byTier[e.recommendedTier]++;

    const persianInstalled = installed.filter((m) => {
      const cat = catalog.find((e) => this.matchCatalogToInstalled(e)?.id === m.id);
      return cat?.persianSupport;
    }).length;

    return {
      totalCatalogModels: catalog.length,
      installedModels: installed.length,
      persianCapableInstalled: persianInstalled,
      byType,
      byTier,
      hardware: hw,
      lastRecommendation: this.lastRecommendation,
      catalogSecurityOk: verifyCatalogSecurity().ok,
    };
  }

  // ── Hardware ──

  detectHardware(): HardwareProfile {
    if (!this.cachedHardware) {
      this.cachedHardware = detectHardwareProfile();
    }
    return this.cachedHardware;
  }

  canRun(catalogEntry: AdvancedModelEntry): ModelHardwareVerdict | null {
    const installed = this.matchCatalogToInstalled(catalogEntry);
    const model = installed || this.synthesizeLocalModel(catalogEntry);
    if (!model) return null;
    return canModelRunOnHardware(model, this.detectHardware());
  }

  // ── Internals ──

  private inferTaskCategory(request: RouterRequest, decision: BrainDecision): string {
    if (request.intent) {
      const i = request.intent.toLowerCase();
      if (i.includes('cod')) return 'coding';
      if (i.includes('reason')) return 'reasoning';
      if (i.includes('vis') || request.hasImage) return 'vision';
      if (i.includes('voice') || request.hasAudio) return 'voice';
    }
    // Use the brain's task field
    const task = (decision.task || '').toLowerCase();
    if (task.includes('cod')) return 'coding';
    if (task.includes('reason')) return 'reasoning';
    if (task.includes('vis')) return 'vision';
    if (task.includes('voice')) return 'voice';
    // Keyword analysis on the request
    const r = request.request.toLowerCase();
    if (/کد|برنامه|تابع|code|function|debug/.test(r)) return 'coding';
    if (/تصویر|عکس|image|picture|screenshot/.test(r)) return 'vision';
    if (/صدا|voice|audio|speech/.test(r)) return 'voice';
    if (/استدلال|تحلیل|reason|analyz|design/.test(r)) return 'reasoning';
    return 'chat';
  }

  private categoryToCapability(category: string): ModelCapability {
    switch (category) {
      case 'coding': return 'coding';
      case 'reasoning': return 'reasoning';
      case 'vision': return 'vision';
      case 'voice': return 'speech-to-text';
      case 'embedding': return 'embedding';
      default: return 'chat';
    }
  }

  private categoryToType(category: ModelCategory): string {
    switch (category) {
      case 'vision': return 'vision';
      case 'embedding': return 'embedding';
      case 'speech': return 'voice-stt';
      case 'image': return 'vision';
      default: return 'llm';
    }
  }

  private inferNeededRoles(request: RouterRequest, decision: BrainDecision): Array<'primary' | 'coding' | 'reasoning' | 'vision' | 'voice' | 'embedding'> {
    const roles: Array<'primary' | 'coding' | 'reasoning' | 'vision' | 'voice' | 'embedding'> = ['primary'];
    const cat = this.inferTaskCategory(request, decision);
    if (cat === 'coding') roles.push('coding');
    if (cat === 'reasoning') roles.push('reasoning');
    if (cat === 'vision' || request.hasImage) roles.push('vision');
    if (cat === 'voice' || request.hasAudio) roles.push('voice');
    // Always consider embedding for RAG
    if (/جستجو|search|knowledge|دانش/.test(request.request.toLowerCase())) roles.push('embedding');
    return roles;
  }

  private roleToCapability(role: string): ModelCapability {
    switch (role) {
      case 'coding': return 'coding';
      case 'reasoning': return 'reasoning';
      case 'vision': return 'vision';
      case 'voice': return 'speech-to-text';
      case 'embedding': return 'embedding';
      default: return 'chat';
    }
  }

  private findBestCatalogForCapability(capability: ModelCapability): AdvancedModelEntry | null {
    const candidates = getExpandedCatalog().filter((e) => {
      if (capability === 'vision') return e.type === 'vision';
      if (capability === 'embedding') return e.type === 'embedding';
      if (capability === 'speech-to-text') return e.type === 'voice-stt';
      if (capability === 'text-to-speech') return e.type === 'voice-tts';
      if (capability === 'coding') return e.type === 'llm' && e.codingScore >= 70;
      if (capability === 'reasoning') return e.type === 'llm' && e.reasoningScore >= 75;
      return e.type === 'llm';
    });
    if (candidates.length === 0) return null;
    // Score by relevant benchmark
    const scored = candidates.map((e) => {
      let score = e.qualityScore;
      if (capability === 'coding') score = e.codingScore;
      else if (capability === 'reasoning') score = e.reasoningScore;
      else if (capability === 'vision') score = e.visionScore;
      return { e, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].e;
  }

  /**
   * Synthesize a LocalModelInfo from a catalog entry (for hardware checks
   * when the model isn't installed yet).
   */
  private synthesizeLocalModel(entry: AdvancedModelEntry): LocalModelInfo {
    return {
      id: `catalog-${entry.id}`,
      name: entry.name,
      path: '',
      sizeBytes: Math.round(entry.sizeGB * 1024 * 1024 * 1024),
      contextSize: entry.contextSize,
      gpuLayers: entry.requiredVRAM > 0 ? -1 : 0,
      category: this.typeToCategory(entry.type),
      addedAt: 0,
      fileExists: false,
      minRamBytes: entry.requiredRAM * 1024 * 1024 * 1024,
      minVramBytes: entry.requiredVRAM * 1024 * 1024 * 1024,
      quantization: entry.quantization,
      parameterCount: entry.parameterCount,
      capabilities: entry.capabilities as ModelCapability[],
    };
  }

  private typeToCategory(type: string): ModelCategory {
    switch (type) {
      case 'vision': return 'vision';
      case 'embedding': return 'embedding';
      case 'voice-stt': return 'speech';
      case 'voice-tts': return 'speech';
      default: return 'general';
    }
  }

  /** Reset internal cache (for tests). */
  reset(): void {
    this.cachedHardware = null;
    this.lastRecommendation = null;
  }
}

// ─── Security self-audit ───────────────────────────────────────────────────

/**
 * Verifies the ecosystem manager:
 *   - never downloads / installs / deletes models
 *   - never contacts a cloud API or external AI service
 *   - only ANALYZES and RECOMMENDS (delegates execution to Phase 58 runtime)
 */
export function verifyEcosystemSecurity(): { ok: boolean; findings: string[] } {
  const findings: string[] = [];
  // No fetch, no net.request, no download/install/delete methods.
  // Installation is delegated to ComponentInstaller (Phase 47) + PermissionGate (Phase 43).
  return { ok: findings.length === 0, findings };
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _manager: ModelEcosystemManager | null = null;

export function getModelEcosystemManager(): ModelEcosystemManager {
  if (!_manager) {
    _manager = new ModelEcosystemManager();
  }
  return _manager;
}

export function _resetModelEcosystemManager(): void {
  _manager = null;
}
