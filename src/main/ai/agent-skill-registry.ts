/**
 * NEX AI — Agent Skill Registry (Phase 54)
 *
 * Central registry of skills that connect the Expert System to real tools.
 * Each skill maps an expert domain to executable actions.
 *
 * CRITICAL: Skills describe CAPABILITIES — they do NOT execute.
 * Execution goes through NexAgentExecutor which checks PermissionGate.
 */

import type { ExpertDomain } from './nex-expert-system';

export type SkillPermission = 'safe' | 'requires-approval' | 'high-risk';

export interface AgentSkill {
  id: string;
  name: string;
  nameFa: string;
  expertDomain: ExpertDomain;
  requiredPermission: SkillPermission;
  tools: string[];
  description: string;
  descriptionFa: string;
  /** What this skill does (for user-facing explanation). */
  actionDescription: string;
  actionDescriptionFa: string;
}

export const SKILL_REGISTRY: AgentSkill[] = [
  // ── Software Engineering Skills ──
  {
    id: 'code-generation',
    name: 'Code Generation',
    nameFa: 'تولید کد',
    expertDomain: 'software-engineering',
    requiredPermission: 'requires-approval',
    tools: ['write_file', 'edit_file'],
    description: 'Generate code in any programming language',
    descriptionFa: 'تولید کد در هر زبان برنامه‌نویسی',
    actionDescription: 'Write new code to a file',
    actionDescriptionFa: 'نوشتن کد جدید در فایل',
  },
  {
    id: 'code-analysis',
    name: 'Code Analysis',
    nameFa: 'تحلیل کد',
    expertDomain: 'software-engineering',
    requiredPermission: 'safe',
    tools: ['read_file', 'read_multiple_files', 'search_files'],
    description: 'Analyze code structure, find bugs, suggest improvements',
    descriptionFa: 'تحلیل ساختار کد، یافتن باگ، پیشنهاد بهبود',
    actionDescription: 'Read and analyze code files',
    actionDescriptionFa: 'خواندن و تحلیل فایل‌های کد',
  },
  {
    id: 'debugging',
    name: 'Debugging',
    nameFa: 'دیباگ',
    expertDomain: 'software-engineering',
    requiredPermission: 'safe',
    tools: ['read_file', 'run_command', 'search_files'],
    description: 'Debug issues by analyzing code and running tests',
    descriptionFa: 'رفع مشکل با تحلیل کد و اجرای تست',
    actionDescription: 'Analyze code and run diagnostics',
    actionDescriptionFa: 'تحلیل کد و اجرای诊断',
  },
  {
    id: 'project-analysis',
    name: 'Project Analysis',
    nameFa: 'تحلیل پروژه',
    expertDomain: 'software-engineering',
    requiredPermission: 'safe',
    tools: ['list_directory', 'read_file', 'project_structure', 'search_files'],
    description: 'Analyze project structure, dependencies, and architecture',
    descriptionFa: 'تحلیل ساختار پروژه، وابستگی‌ها و معماری',
    actionDescription: 'Scan project files and analyze structure',
    actionDescriptionFa: 'اسکن فایل‌های پروژه و تحلیل ساختار',
  },
  {
    id: 'file-editing',
    name: 'File Editing',
    nameFa: 'ویرایش فایل',
    expertDomain: 'software-engineering',
    requiredPermission: 'requires-approval',
    tools: ['edit_file', 'write_file'],
    description: 'Edit existing files with precision',
    descriptionFa: 'ویرایش دقیق فایل‌های موجود',
    actionDescription: 'Modify file contents',
    actionDescriptionFa: 'تغییر محتوای فایل',
  },

  // ── Electronics Engineering Skills ──
  {
    id: 'circuit-analysis',
    name: 'Circuit Analysis',
    nameFa: 'تحلیل مدار',
    expertDomain: 'electronics-engineering',
    requiredPermission: 'safe',
    tools: ['read_file', 'knowledge_search'],
    description: 'Analyze circuit designs and provide feedback',
    descriptionFa: 'تحلیل طراحی مدار و ارائه بازخورد',
    actionDescription: 'Analyze circuit documentation',
    actionDescriptionFa: 'تحلیل مستندات مدار',
  },
  {
    id: 'pcb-assistance',
    name: 'PCB Design Assistance',
    nameFa: 'کمک طراحی PCB',
    expertDomain: 'electronics-engineering',
    requiredPermission: 'safe',
    tools: ['read_file', 'knowledge_search'],
    description: 'Provide PCB layout recommendations and DRC guidance',
    descriptionFa: 'پیشنهاد چیدمان PCB و راهنمایی DRC',
    actionDescription: 'Review PCB design files',
    actionDescriptionFa: 'بازبینی فایل‌های طراحی PCB',
  },
  {
    id: 'datasheet-analysis',
    name: 'Datasheet Analysis',
    nameFa: 'تحلیل دیتاشیت',
    expertDomain: 'electronics-engineering',
    requiredPermission: 'safe',
    tools: ['read_file', 'knowledge_search', 'fs_service_readfile'],
    description: 'Analyze component datasheets and extract specifications',
    descriptionFa: 'تحلیل دیتاشیت قطعات و استخراج مشخصات',
    actionDescription: 'Read and analyze datasheet documents',
    actionDescriptionFa: 'خواندن و تحلیل اسناد دیتاشیت',
  },
  {
    id: 'component-selection',
    name: 'Component Selection',
    nameFa: 'انتخاب قطعه',
    expertDomain: 'electronics-engineering',
    requiredPermission: 'safe',
    tools: ['knowledge_search'],
    description: 'Recommend components based on requirements',
    descriptionFa: 'پیشنهاد قطعات بر اساس نیاز',
    actionDescription: 'Search knowledge base for component recommendations',
    actionDescriptionFa: 'جستجو در پایگاه دانش برای پیشنهاد قطعه',
  },

  // ── Knowledge Skills ──
  {
    id: 'document-search',
    name: 'Document Search',
    nameFa: 'جستجوی سند',
    expertDomain: 'general',
    requiredPermission: 'safe',
    tools: ['knowledge_search', 'search_files'],
    description: 'Search through indexed documents and knowledge base',
    descriptionFa: 'جستجو در اسناد ایندکس شده و پایگاه دانش',
    actionDescription: 'Search knowledge base for relevant documents',
    actionDescriptionFa: 'جستجو در پایگاه دانش برای اسناد مرتبط',
  },
  {
    id: 'pdf-analysis',
    name: 'PDF Analysis',
    nameFa: 'تحلیل PDF',
    expertDomain: 'general',
    requiredPermission: 'safe',
    tools: ['fs_service_readfile', 'knowledge_search'],
    description: 'Extract and analyze text from PDF documents',
    descriptionFa: 'استخراج و تحلیل متن از اسناد PDF',
    actionDescription: 'Read PDF file and extract content',
    actionDescriptionFa: 'خواندن فایل PDF و استخراج محتوا',
  },
  {
    id: 'offline-knowledge-retrieval',
    name: 'Offline Knowledge Retrieval',
    nameFa: 'بازیابی دانش آفلاین',
    expertDomain: 'general',
    requiredPermission: 'safe',
    tools: ['knowledge_search'],
    description: 'Retrieve relevant information from local knowledge base',
    descriptionFa: 'بازیابی اطلاعات مرتبط از پایگاه دانش محلی',
    actionDescription: 'Query local knowledge base',
    actionDescriptionFa: 'پرس‌وجو از پایگاه دانش محلی',
  },

  // ── System Skills ──
  {
    id: 'file-inspection',
    name: 'File Inspection',
    nameFa: 'بازرسی فایل',
    expertDomain: 'general',
    requiredPermission: 'safe',
    tools: ['read_file', 'list_directory', 'fs_service_readdir'],
    description: 'Inspect file contents and directory structure',
    descriptionFa: 'بازرسی محتوای فایل و ساختار دایرکتوری',
    actionDescription: 'Read files and list directories',
    actionDescriptionFa: 'خواندن فایل‌ها و لیست دایرکتوری',
  },
  {
    id: 'terminal-commands',
    name: 'Terminal Commands',
    nameFa: 'دستورات ترمینال',
    expertDomain: 'software-engineering',
    requiredPermission: 'requires-approval',
    tools: ['run_command'],
    description: 'Execute terminal commands (with user permission)',
    descriptionFa: 'اجرای دستورات ترمینال (با اجازه کاربر)',
    actionDescription: 'Execute a terminal command',
    actionDescriptionFa: 'اجرای یک دستور ترمینال',
  },
  {
    id: 'system-diagnostics',
    name: 'System Diagnostics',
    nameFa: 'عیب‌یابی سیستم',
    expertDomain: 'general',
    requiredPermission: 'safe',
    tools: ['system_info', 'run_tsc_check'],
    description: 'Run system diagnostics and health checks',
    descriptionFa: 'اجرای عیب‌یابی و بررسی سلامت سیستم',
    actionDescription: 'Check system status and run diagnostics',
    actionDescriptionFa: 'بررسی وضعیت سیستم و اجرای عیب‌یابی',
  },

  // ── Creative Skills ──
  {
    id: 'content-writing',
    name: 'Content Writing',
    nameFa: 'نوشتن محتوا',
    expertDomain: 'creative',
    requiredPermission: 'requires-approval',
    tools: ['write_file'],
    description: 'Write articles, documentation, and creative content',
    descriptionFa: 'نوشتن مقاله، مستندات و محتوای خلاقانه',
    actionDescription: 'Write content to a file',
    actionDescriptionFa: 'نوشتن محتوا در فایل',
  },

  // ── Vision Skills ──
  {
    id: 'image-analysis',
    name: 'Image Analysis',
    nameFa: 'تحلیل تصویر',
    expertDomain: 'creative',
    requiredPermission: 'safe',
    tools: ['vision_analyze'],
    description: 'Analyze images using vision models (LLaVA)',
    descriptionFa: 'تحلیل تصاویر با مدل بینایی (LLaVA)',
    actionDescription: 'Analyze an image file',
    actionDescriptionFa: 'تحلیل یک فایل تصویری',
  },
];

export function getSkillRegistry(): AgentSkill[] {
  return SKILL_REGISTRY;
}

export function getSkill(id: string): AgentSkill | null {
  return SKILL_REGISTRY.find((s) => s.id === id) || null;
}

export function getSkillsByDomain(domain: ExpertDomain): AgentSkill[] {
  return SKILL_REGISTRY.filter((s) => s.expertDomain === domain);
}

export function getSkillsByPermission(permission: SkillPermission): AgentSkill[] {
  return SKILL_REGISTRY.filter((s) => s.requiredPermission === permission);
}
