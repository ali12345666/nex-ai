/**
 * NEX AI — Universal Expert System (Phase 53)
 *
 * Transforms NEX from a general AI assistant into a multi-domain expert system.
 * One central brain controller routes requests to domain-specific experts.
 *
 * Architecture:
 *
 *   User Request
 *       ↓
 *   NEX Brain Controller
 *       ↓
 *   Expert Router
 *       ↓
 *   ┌──────────────┬──────────────┬──────────────┬──────────────┐
 *   │ Programming  │ Engineering  │ Science      │ Business     │
 *   │ Expert       │ Expert       │ Expert       │ Expert       │
 *   └──────────────┴──────────────┴──────────────┴──────────────┘
 *
 * CRITICAL: Expert system only SELECTS — never downloads/installs/executes.
 */

export type ExpertDomain =
  | 'software-engineering'
  | 'electronics-engineering'
  | 'science'
  | 'business'
  | 'creative'
  | 'general';

export interface ExpertProfile {
  id: string;
  domain: ExpertDomain;
  name: string;
  nameFa: string;
  description: string;
  descriptionFa: string;
  subDomains: string[];
  subDomainsFa: string[];
  abilities: string[];
  abilitiesFa: string[];
  preferredModels: string[];
  tools: string[];
  knowledgeAreas: string[];
  knowledgeAreasFa: string[];
  limitations: string[];
  limitationsFa: string[];
  keywords: string[];
  keywordsFa: string[];
}

export const EXPERT_PROFILES: ExpertProfile[] = [
  // ── Software Engineering ──
  {
    id: 'software-engineering',
    domain: 'software-engineering',
    name: 'Software Engineering Expert',
    nameFa: 'متخصص مهندسی نرم‌افزار',
    description: 'Full-stack software development expert',
    descriptionFa: 'متخصص توسعه نرم‌افزار full-stack',
    subDomains: ['frontend', 'backend', 'desktop-apps', 'ai-development', 'cybersecurity', 'databases', 'devops'],
    subDomainsFa: ['فرانت‌اند', 'بک‌اند', 'اپلیکیشن دسکتاپ', 'توسعه هوش مصنوعی', 'امنیت سایبری', 'پایگاه داده', 'دواپس'],
    abilities: [
      'Write and debug code in 20+ languages',
      'Architecture design (microservices, monolith, serverless)',
      'Code review and refactoring',
      'Security vulnerability analysis',
      'Database schema design',
      'CI/CD pipeline setup',
      'API design (REST, GraphQL, gRPC)',
      'Testing strategies (unit, integration, e2e)',
    ],
    abilitiesFa: [
      'نوشتن و دیباگ کد در ۲۰+ زبان',
      'طراحی معماری (میکروسرویس، مونولیت، سرورلس)',
      'بازبینی و بازسازی کد',
      'تحلیل آسیب‌پذیری امنیتی',
      'طراحی اسکمای پایگاه داده',
      'تنظیم CI/CD',
      'طراحی API (REST، GraphQL، gRPC)',
      'استراتژی تست (واحد، یکپارچه، e2e)',
    ],
    preferredModels: ['qwen2.5-coder-7b-q5', 'qwen2.5-coder-14b-q5', 'deepseek-coder-6.7b-q4'],
    tools: ['read_file', 'write_file', 'edit_file', 'run_command', 'npm_build', 'npm_test', 'git_status'],
    knowledgeAreas: ['programming', 'software-architecture', 'design-patterns', 'security', 'databases'],
    knowledgeAreasFa: ['برنامه‌نویسی', 'معماری نرم‌افزار', 'الگوهای طراحی', 'امنیت', 'پایگاه داده'],
    limitations: ['Cannot deploy to production without permission', 'Cannot modify system files without permission'],
    limitationsFa: ['بدون اجازه به پروDUCTION دیپلوی نمی‌کند', 'فایل‌های سیستمی را بدون اجازه تغییر نمی‌دهد'],
    keywords: ['code', 'function', 'bug', 'react', 'python', 'api', 'database', 'sql', 'debug', 'compile', 'test', 'deploy', 'docker', 'kubernetes', 'frontend', 'backend', 'fullstack', 'algorithm', 'refactor'],
    keywordsFa: ['کد', 'تابع', 'باگ', 'خطا', 'برنامه', 'دیباگ', 'تست', 'دیتابیس', 'سرور', 'کلاینت', 'الگوریتم'],
  },

  // ── Electronics Engineering ──
  {
    id: 'electronics-engineering',
    domain: 'electronics-engineering',
    name: 'Electronics Engineering Expert',
    nameFa: 'متخصص مهندسی الکترونیک',
    description: 'Electronics, embedded systems, PCB, circuits expert',
    descriptionFa: 'متخصص الکترونیک، سیستم‌های نهفته، PCB، مدارها',
    subDomains: ['embedded-systems', 'pcb-design', 'circuits', 'robotics', 'power-electronics', 'sensors', 'iot'],
    subDomainsFa: ['سیستم‌های نهفته', 'طراحی PCB', 'مدارها', 'رباتیک', 'الکترونیک قدرت', 'سنسورها', 'اینترنت اشیا'],
    abilities: [
      'Circuit design and analysis',
      'PCB layout recommendations',
      'Microcontroller programming (Arduino, ESP32, STM32)',
      'Sensor selection and integration',
      'Power supply design',
      'Signal processing guidance',
      'Embedded firmware development',
      'IoT architecture design',
    ],
    abilitiesFa: [
      'طراحی و تحلیل مدار',
      'پیشنهاد چیدمان PCB',
      'برنامه‌نویسی میکروکنترلر (آردوینو، ESP32، STM32)',
      'انتخاب و ادغام سنسور',
      'طراحی منبع تغذیه',
      'راهنمایی پردازش سیگنال',
      'توسعه فریم‌ور نهفته',
      'طراحی معماری IoT',
    ],
    preferredModels: ['qwen2.5-7b-q4', 'qwen2.5-32b-q4'],
    tools: ['read_file', 'write_file', 'run_command', 'list_directory'],
    knowledgeAreas: ['electronics', 'embedded-systems', 'circuit-design', 'microcontrollers', 'signal-processing'],
    knowledgeAreasFa: ['الکترونیک', 'سیستم‌های نهفته', 'طراحی مدار', 'میکروکنترلر', 'پردازش سیگنال'],
    limitations: ['Cannot simulate circuits', 'Cannot program hardware directly'],
    limitationsFa: ['نمی‌تواند مدار را شبیه‌سازی کند', 'نمی‌تواند مستقیماً سخت‌افزار را برنامه‌ریزی کند'],
    keywords: ['circuit', 'arduino', 'esp32', 'stm32', 'pcb', 'sensor', 'voltage', 'current', 'resistor', 'capacitor', 'microcontroller', 'embedded', 'firmware', 'gpio', 'i2c', 'spi', 'uart', 'pwm', 'adc', 'robotics'],
    keywordsFa: ['مدار', 'آردوینو', 'سنسور', 'ولتاژ', 'جریان', 'مقاومت', 'خازن', 'میکروکنترلر', 'فریم‌ور', 'ربات'],
  },

  // ── Science ──
  {
    id: 'science',
    domain: 'science',
    name: 'Science Expert',
    nameFa: 'متخصص علوم',
    description: 'Mathematics, physics, chemistry, biology expert',
    descriptionFa: 'متخصص ریاضی، فیزیک، شیمی، زیست‌شناسی',
    subDomains: ['mathematics', 'physics', 'chemistry', 'biology'],
    subDomainsFa: ['ریاضی', 'فیزیک', 'شیمی', 'زیست‌شناسی'],
    abilities: [
      'Mathematical problem solving',
      'Physics calculations and explanations',
      'Chemistry formula analysis',
      'Biology concept explanation',
      'Scientific method guidance',
      'Research methodology',
    ],
    abilitiesFa: [
      'حل مسائل ریاضی',
      'محاسبات و توضیحات فیزیک',
      'تحلیل فرمول شیمی',
      'توضیح مفاهیم زیست‌شناسی',
      'راهنمایی روش علمی',
      'روش‌شناسی تحقیق',
    ],
    preferredModels: ['qwen2.5-32b-q4', 'qwen2.5-7b-q4'],
    tools: ['calculation', 'read_file', 'search_files'],
    knowledgeAreas: ['mathematics', 'physics', 'chemistry', 'biology', 'scientific-method'],
    knowledgeAreasFa: ['ریاضی', 'فیزیک', 'شیمی', 'زیست‌شناسی', 'روش علمی'],
    limitations: ['Cannot perform physical experiments', 'Cannot access lab equipment'],
    limitationsFa: ['نمی‌تواند آزمایش فیزیکی انجام دهد', 'به تجهیزات آزمایشگاهی دسترسی ندارد'],
    keywords: ['math', 'physics', 'chemistry', 'biology', 'equation', 'formula', 'calculate', 'theorem', 'proof', 'experiment', 'hypothesis', 'quantum', 'relativity', 'molecule', 'cell', 'dna', 'integral', 'derivative'],
    keywordsFa: ['ریاضی', 'فیزیک', 'شیمی', 'زیست', 'معادله', 'فرمول', 'محاسبه', 'قضیه', 'اثبات', 'آزمایش', 'مولکول', 'سلول', 'dna'],
  },

  // ── Business ──
  {
    id: 'business',
    domain: 'business',
    name: 'Business Expert',
    nameFa: 'متخصص کسب‌وکار',
    description: 'Project management, analysis, planning expert',
    descriptionFa: 'متخصص مدیریت پروژه، تحلیل، برنامه‌ریزی',
    subDomains: ['project-management', 'analysis', 'planning', 'strategy', 'marketing'],
    subDomainsFa: ['مدیریت پروژه', 'تحلیل', 'برنامه‌ریزی', 'استراتژی', 'بازاریابی'],
    abilities: [
      'Project planning and management',
      'Business analysis',
      'Strategic planning',
      'Risk assessment',
      'Market research guidance',
      'Process optimization',
    ],
    abilitiesFa: [
      'برنامه‌ریزی و مدیریت پروژه',
      'تحلیل کسب‌وکار',
      'برنامه‌ریزی استراتژیک',
      'ارزیابی ریسک',
      'راهنمایی تحقیق بازار',
      'بهینه‌سازی فرآیند',
    ],
    preferredModels: ['qwen2.5-7b-q4', 'llama3.1-8b-q4'],
    tools: ['read_file', 'write_file'],
    knowledgeAreas: ['business', 'management', 'strategy', 'finance'],
    knowledgeAreasFa: ['کسب‌وکار', 'مدیریت', 'استراتژی', 'مالی'],
    limitations: ['Cannot make financial decisions', 'Cannot access financial data'],
    limitationsFa: ['نمی‌تواند تصمیم مالی بگیرد', 'به داده‌های مالی دسترسی ندارد'],
    keywords: ['business', 'project', 'plan', 'strategy', 'market', 'budget', 'roi', 'stakeholder', 'agile', 'scrum', 'milestone', 'risk', 'analysis', 'kpi'],
    keywordsFa: ['کسب‌وکار', 'پروژه', 'برنامه', 'استراتژی', 'بازار', 'بودجه', 'ریسک', 'تحلیل', 'مدیریت'],
  },

  // ── Creative ──
  {
    id: 'creative',
    domain: 'creative',
    name: 'Creative Expert',
    nameFa: 'متخصص خلاقیت',
    description: 'Writing, design, creative concepts expert',
    descriptionFa: 'متخصص نویسندگی، طراحی، مفاهیم خلاقانه',
    subDomains: ['writing', 'design', 'image-concepts', 'storytelling'],
    subDomainsFa: ['نویسندگی', 'طراحی', 'مفاهیم تصویری', 'داستان‌سرایی'],
    abilities: [
      'Technical and creative writing',
      'Design concept generation',
      'Content strategy',
      'Visual storytelling',
      'Image description and analysis',
    ],
    abilitiesFa: [
      'نویسندگی فنی و خلاقانه',
      'تولید مفهوم طراحی',
      'استراتژی محتوا',
      'داستان‌سرایی بصری',
      'توضیح و تحلیل تصویر',
    ],
    preferredModels: ['qwen2.5-7b-q4', 'llava-7b-q4'],
    tools: ['read_file', 'write_file'],
    knowledgeAreas: ['writing', 'design', 'creative', 'content'],
    knowledgeAreasFa: ['نویسندگی', 'طراحی', 'خلاقیت', 'محتوا'],
    limitations: ['Cannot generate images directly', 'Requires vision model for image analysis'],
    limitationsFa: ['نمی‌تواند مستقیماً تصویر تولید کند', 'برای تحلیل تصویر به مدل بینایی نیاز دارد'],
    keywords: ['write', 'design', 'creative', 'story', 'content', 'blog', 'article', 'image', 'visual', 'logo', 'brand', 'narrative', 'poem', 'essay'],
    keywordsFa: ['نویسندگی', 'طراحی', 'خلاق', 'داستان', 'محتوا', 'مقاله', 'تصویر', 'بصری', 'لوگو', 'برند', 'شعر'],
  },

  // ── General ──
  {
    id: 'general',
    domain: 'general',
    name: 'General Knowledge Expert',
    nameFa: 'متخصص دانش عمومی',
    description: 'Research, learning, general explanation expert',
    descriptionFa: 'متخصص تحقیق، یادگیری، توضیح عمومی',
    subDomains: ['research', 'learning', 'explanation', 'translation'],
    subDomainsFa: ['تحقیق', 'یادگیری', 'توضیح', 'ترجمه'],
    abilities: [
      'Research and information retrieval',
      'Learning assistance',
      'Concept explanation',
      'Translation support',
      'General Q&A',
    ],
    abilitiesFa: [
      'بازیابی اطلاعات و تحقیق',
      'کمک به یادگیری',
      'توضیح مفاهیم',
      'پشتیبانی ترجمه',
      'پرسش و پاسخ عمومی',
    ],
    preferredModels: ['qwen2.5-7b-q4', 'mistral-7b-q4'],
    tools: ['read_file', 'search_files', 'knowledge_search'],
    knowledgeAreas: ['general', 'research', 'learning'],
    knowledgeAreasFa: ['عمومی', 'تحقیق', 'یادگیری'],
    limitations: ['Knowledge limited to training data', 'Cannot browse the internet (offline)'],
    limitationsFa: ['دانش محدود به داده‌های آموزش است', 'به اینترنت دسترسی ندارد (آفلاین)'],
    keywords: ['explain', 'what', 'how', 'why', 'research', 'learn', 'translate', 'understand', 'concept', 'define', 'meaning'],
    keywordsFa: ['توضیح', 'چیست', 'چگونه', 'چرا', 'تحقیق', 'یادگیری', 'ترجمه', 'درک', 'مفهوم', 'معنی'],
  },
];

export function getExpertProfiles(): ExpertProfile[] {
  return EXPERT_PROFILES;
}

export function getExpertProfile(id: string): ExpertProfile | null {
  return EXPERT_PROFILES.find((e) => e.id === id || e.domain === id) || null;
}

export function getExpertsByDomain(domain: ExpertDomain): ExpertProfile | null {
  return EXPERT_PROFILES.find((e) => e.domain === domain) || null;
}
