/**
 * NEX AI — User Profile Manager (Phase 52)
 *
 * Stores user preferences in user_profile.json:
 *   - preferred language
 *   - preferred explanation level
 *   - coding style preference
 *   - project preferences
 *   - frequently used tools
 *
 * CRITICAL: Never stores sensitive data without permission.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getUserDataDir } from '../persistence';

export type ExplanationLevel = 'beginner' | 'intermediate' | 'expert';
export type CodingStyle = 'functional' | 'object-oriented' | 'procedural' | 'no-preference';
export type PreferredLanguage = 'fa' | 'en' | 'auto';

export interface UserProfile {
  preferredLanguage: PreferredLanguage;
  preferredLanguageFa: string;
  explanationLevel: ExplanationLevel;
  explanationLevelFa: string;
  codingStyle: CodingStyle;
  codingStyleFa: string;
  projectPreferences: ProjectPreferences;
  frequentlyUsedTools: string[];
  workingStyle: string;
  workingStyleFa: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectPreferences {
  preferredFramework: string;
  preferredPackageManager: string;
  preferredEditor: string;
  autoFormat: boolean;
  showLineNumbers: boolean;
}

const DEFAULT_PROFILE: UserProfile = {
  preferredLanguage: 'auto',
  preferredLanguageFa: 'خودکار',
  explanationLevel: 'intermediate',
  explanationLevelFa: 'متوسط',
  codingStyle: 'no-preference',
  codingStyleFa: 'بدون ترجیح',
  projectPreferences: {
    preferredFramework: '',
    preferredPackageManager: 'npm',
    preferredEditor: 'nex',
    autoFormat: true,
    showLineNumbers: true,
  },
  frequentlyUsedTools: [],
  workingStyle: 'balanced',
  workingStyleFa: 'متعادل',
  createdAt: 0,
  updatedAt: 0,
};

export class UserProfileManager {
  private profile: UserProfile;
  private profilePath: string;

  constructor() {
    this.profilePath = path.join(getUserDataDir(), 'user_profile.json');
    this.profile = this.load();
  }

  private load(): UserProfile {
    try {
      if (fs.existsSync(this.profilePath)) {
        const data = JSON.parse(fs.readFileSync(this.profilePath, 'utf-8'));
        return { ...DEFAULT_PROFILE, ...data, projectPreferences: { ...DEFAULT_PROFILE.projectPreferences, ...data.projectPreferences } };
      }
    } catch { /* */ }
    const fresh = { ...DEFAULT_PROFILE, createdAt: Date.now(), updatedAt: Date.now() };
    this.save(fresh);
    return fresh;
  }

  private save(profile: UserProfile): void {
    try {
      const tmp = this.profilePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(profile, null, 2), 'utf-8');
      fs.renameSync(tmp, this.profilePath);
    } catch { /* */ }
  }

  getProfile(): UserProfile {
    return { ...this.profile };
  }

  updateProfile(patch: Partial<UserProfile>): UserProfile {
    this.profile = { ...this.profile, ...patch, updatedAt: Date.now() };
    this.save(this.profile);
    return { ...this.profile };
  }

  setPreferredLanguage(lang: PreferredLanguage): void {
    const labels: Record<PreferredLanguage, string> = { fa: 'فارسی', en: 'انگلیسی', auto: 'خودکار' };
    this.profile.preferredLanguage = lang;
    this.profile.preferredLanguageFa = labels[lang];
    this.profile.updatedAt = Date.now();
    this.save(this.profile);
  }

  setExplanationLevel(level: ExplanationLevel): void {
    const labels: Record<ExplanationLevel, string> = { beginner: 'مبتدی', intermediate: 'متوسط', expert: 'خبره' };
    this.profile.explanationLevel = level;
    this.profile.explanationLevelFa = labels[level];
    this.profile.updatedAt = Date.now();
    this.save(this.profile);
  }

  setCodingStyle(style: CodingStyle): void {
    const labels: Record<CodingStyle, string> = {
      functional: 'تابعی', 'object-oriented': 'شیءگرا', procedural: 'روندی', 'no-preference': 'بدون ترجیح',
    };
    this.profile.codingStyle = style;
    this.profile.codingStyleFa = labels[style];
    this.profile.updatedAt = Date.now();
    this.save(this.profile);
  }

  addFrequentlyUsedTool(tool: string): void {
    if (!this.profile.frequentlyUsedTools.includes(tool)) {
      this.profile.frequentlyUsedTools.push(tool);
      if (this.profile.frequentlyUsedTools.length > 20) {
        this.profile.frequentlyUsedTools = this.profile.frequentlyUsedTools.slice(-20);
      }
      this.profile.updatedAt = Date.now();
      this.save(this.profile);
    }
  }

  updateProjectPreferences(patch: Partial<ProjectPreferences>): void {
    this.profile.projectPreferences = { ...this.profile.projectPreferences, ...patch };
    this.profile.updatedAt = Date.now();
    this.save(this.profile);
  }

  get profileFilePath(): string {
    return this.profilePath;
  }
}

let _manager: UserProfileManager | null = null;

export function getUserProfileManager(): UserProfileManager {
  if (!_manager) {
    _manager = new UserProfileManager();
  }
  return _manager;
}
