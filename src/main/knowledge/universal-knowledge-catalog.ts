/**
 * NEX AI — Universal Knowledge Catalog (Phase 60)
 *
 * Expands NEX from 5 knowledge domains (Phase 55) into a multidisciplinary
 * expert knowledge system. Adds:
 *   - 4 new domains: architecture, mechanical, business, economics
 *   - Knowledge graph: Domain → Subdomain → Concept → Documents
 *   - New knowledge packs for the new domains
 *   - Multilingual concept mapping (English + Persian)
 *
 * This module BUILDS ON the Phase 55 ExpertKnowledgeEngine — it does NOT
 * duplicate it. The Phase 55 engine's 12 packs + 5 domains remain the
 * foundation; this catalog adds the multidisciplinary expansion on top.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SECURITY
 * ════════════════════════════════════════════════════════════════════════════
 * Pure-data module. No I/O, no network, no downloads. Installation always
 * goes through PermissionGate (Phase 43) via KnowledgePackManager (Phase 55).
 * ════════════════════════════════════════════════════════════════════════════
 */

import type { ExpertDomain } from '../ai/nex-expert-system';

// ─── Expanded Domain System ───────────────────────────────────────────────

/**
 * The universal knowledge domain set. Extends Phase 55's 5 domains with 4
 * new multidisciplinary domains.
 *
 * Phase 55 domains (preserved):
 *   software-engineering, electronics-engineering, ai-engineering,
 *   system-architecture, science
 *
 * Phase 60 new domains:
 *   architecture (building design, structures, materials, CAD)
 *   mechanical (mechanics, machines, manufacturing)
 *   business (business, project management)
 *   economics (economics)
 */
export type UniversalKnowledgeDomain =
  // Phase 55 (preserved)
  | 'software-engineering'
  | 'electronics-engineering'
  | 'ai-engineering'
  | 'system-architecture'
  | 'science'
  // Phase 60 (new)
  | 'architecture'
  | 'mechanical'
  | 'business'
  | 'economics';

export interface DomainInfo {
  domain: UniversalKnowledgeDomain;
  name: string;
  nameFa: string;
  description: string;
  descriptionFa: string;
  /** Subdomains within this domain. */
  subdomains: SubdomainInfo[];
  /** Number of knowledge packs in this domain. */
  packCount: number;
  /** Whether this domain has Persian-language content. */
  persianSupport: boolean;
  /** The expert domain this knowledge domain routes to. */
  expertDomain: ExpertDomain;
}

export interface SubdomainInfo {
  id: string;
  name: string;
  nameFa: string;
  /** Key concepts within this subdomain. */
  concepts: string[];
  conceptsFa: string[];
}

// ─── Knowledge Graph ──────────────────────────────────────────────────────

export interface KnowledgeGraphNode {
  id: string;
  type: 'domain' | 'subdomain' | 'concept';
  label: string;
  labelFa: string;
  domain: UniversalKnowledgeDomain;
  /** Parent node id (subdomain → domain, concept → subdomain). */
  parentId: string | null;
  /** Related concept ids (cross-links). */
  related: string[];
}

export interface KnowledgeGraphEdge {
  source: string;
  target: string;
  relationship: 'contains' | 'related-to' | 'prerequisite-of' | 'applied-in';
}

export interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}

// ─── Universal Knowledge Pack (extends Phase 55 KnowledgePack) ────────────

export interface UniversalKnowledgePack {
  id: string;
  domain: UniversalKnowledgeDomain;
  subdomain: string;
  name: string;
  nameFa: string;
  description: string;
  descriptionFa: string;
  /** Estimated pack size in bytes. */
  sizeBytes: number;
  version: string;
  /** Number of documents in this pack. */
  documentCount: number;
  /** What this pack enables NEX to do. */
  capabilities: string[];
  capabilitiesFa: string[];
  /** Languages supported (BCP-47 codes). */
  languages: string[];
  /** Whether Persian is supported. */
  persianSupport: boolean;
  /** Key concepts covered. */
  concepts: string[];
  conceptsFa: string[];
  /** Whether this pack is a Phase 60 new pack (vs Phase 55 preserved). */
  isPhase60New: boolean;
}

// ─── Domain Definitions ───────────────────────────────────────────────────

export const UNIVERSAL_DOMAINS: DomainInfo[] = [
  // ── Software Engineering (Phase 55, expanded subdomains) ──
  {
    domain: 'software-engineering',
    name: 'Software Engineering',
    nameFa: 'مهندسی نرم‌افزار',
    description: 'Frontend, backend, AI engineering, cybersecurity, databases, DevOps',
    descriptionFa: 'فرانت‌اند، بک‌اند، مهندسی هوش مصنوعی، امنیت سایبری، پایگاه داده، دواپس',
    subdomains: [
      { id: 'frontend', name: 'Frontend', nameFa: 'فرانت‌اند', concepts: ['React', 'Vue', 'CSS', 'TypeScript'], conceptsFa: ['ری‌اکت', 'ویو', 'سی‌اس‌اس', 'تایپ‌اسکریپت'] },
      { id: 'backend', name: 'Backend', nameFa: 'بک‌اند', concepts: ['Node.js', 'API', 'REST', 'GraphQL'], conceptsFa: ['نود', 'API', 'REST', 'گراف‌کیوال'] },
      { id: 'ai-engineering', name: 'AI Engineering', nameFa: 'مهندسی هوش مصنوعی', concepts: ['ML', 'Neural Networks', 'LLM', 'Training'], conceptsFa: ['یادگیری ماشین', 'شبکه عصبی', 'ال‌ال‌ام', 'آموزش'] },
      { id: 'cybersecurity', name: 'Cybersecurity', nameFa: 'امنیت سایبری', concepts: ['OWASP', 'Encryption', 'Auth', 'Vulnerabilities'], conceptsFa: ['اواسپ', 'رمزنگاری', 'احراز هویت', 'آسیب‌پذیری'] },
      { id: 'databases', name: 'Databases', nameFa: 'پایگاه داده', concepts: ['SQL', 'NoSQL', 'Indexing', 'Transactions'], conceptsFa: ['اس‌کیوال', 'نواس‌کیوال', 'ایندکس', 'تراکنش'] },
      { id: 'devops', name: 'DevOps', nameFa: 'دواپس', concepts: ['Docker', 'Kubernetes', 'CI/CD', 'Monitoring'], conceptsFa: ['داکر', 'کوبرنیتیز', 'CI/CD', 'مانیتورینگ'] },
    ],
    packCount: 3,
    persianSupport: true,
    expertDomain: 'software-engineering',
  },

  // ── Electronics Engineering (Phase 55, expanded) ──
  {
    domain: 'electronics-engineering',
    name: 'Electronics Engineering',
    nameFa: 'مهندسی الکترونیک',
    description: 'Analog circuits, digital electronics, PCB, embedded, microcontrollers, sensors, power',
    descriptionFa: 'مدارهای آنالوگ، الکترونیک دیجیتال، PCB، نهفته، میکروکنترلر، سنسور، قدرت',
    subdomains: [
      { id: 'analog-circuits', name: 'Analog Circuits', nameFa: 'مدارهای آنالوگ', concepts: ['OpAmp', 'Filter', 'Oscillator', 'Amplifier', 'Circuit'], conceptsFa: ['آپ‌امپ', 'فیلتر', 'اسیلاتور', 'تقویت‌کننده', 'مدار'] },
      { id: 'digital-electronics', name: 'Digital Electronics', nameFa: 'الکترونیک دیجیتال', concepts: ['Logic Gates', 'Flip-Flop', 'Counter', 'MUX'], conceptsFa: ['گیت منطقی', 'فلیپ‌فلاپ', 'شمارنده', 'مولتی‌پلکسر'] },
      { id: 'pcb-design', name: 'PCB Design', nameFa: 'طراحی PCB', concepts: ['Layout', 'DRC', 'Stackup', 'Routing'], conceptsFa: ['چیدمان', 'DRC', 'لایه‌بندی', 'مسیریابی'] },
      { id: 'embedded-systems', name: 'Embedded Systems', nameFa: 'سیستم‌های نهفته', concepts: ['RTOS', 'Firmware', 'Interrupt', 'DMA'], conceptsFa: ['آر‌تی‌او‌اس', 'فریم‌ور', 'وقفه', 'دی‌ام‌ای'] },
      { id: 'microcontrollers', name: 'Microcontrollers', nameFa: 'میکروکنترلر', concepts: ['Arduino', 'ESP32', 'STM32', 'PIC'], conceptsFa: ['آردوینو', 'ESP32', 'STM32', 'PIC'] },
      { id: 'sensors', name: 'Sensors', nameFa: 'سنسورها', concepts: ['Temperature', 'Pressure', 'IMU', 'Ultrasonic'], conceptsFa: ['دما', 'فشار', 'IMU', 'التراسونیک'] },
      { id: 'power-electronics', name: 'Power Electronics', nameFa: 'الکترونیک قدرت', concepts: ['Buck', 'Boost', 'Inverter', 'SMPS', 'Power Supply'], conceptsFa: ['باک', 'بوست', 'اینورتر', 'اس‌ام‌پی‌اس', 'تغذیه'] },
    ],
    packCount: 3,
    persianSupport: true,
    expertDomain: 'electronics-engineering',
  },

  // ── AI Engineering (Phase 55, preserved) ──
  {
    domain: 'ai-engineering',
    name: 'AI Engineering',
    nameFa: 'مهندسی هوش مصنوعی',
    description: 'Machine learning, neural networks, LLM concepts, model deployment',
    descriptionFa: 'یادگیری ماشین، شبکه‌های عصبی، مفاهیم LLM، استقرار مدل',
    subdomains: [
      { id: 'machine-learning', name: 'Machine Learning', nameFa: 'یادگیری ماشین', concepts: ['Supervised', 'Unsupervised', 'Reinforcement'], conceptsFa:['نظارت‌شده', 'بدون نظارت', 'تقویتی'] },
      { id: 'neural-networks', name: 'Neural Networks', nameFa: 'شبکه‌های عصبی', concepts: ['CNN', 'RNN', 'Transformer', 'Attention'], conceptsFa: ['سی‌ان‌ان', 'آر‌ان‌ان', 'ترانسفورمر', 'توجه'] },
      { id: 'llm-concepts', name: 'LLM Concepts', nameFa: 'مفاهیم LLM', concepts: ['Tokenization', 'Quantization', 'Fine-tuning', 'RAG'], conceptsFa: ['توکنایز', 'کوانتیزه', 'فاین‌تیون', 'RAG'] },
      { id: 'model-deployment', name: 'Model Deployment', nameFa: 'استقرار مدل', concepts: ['GGUF', 'llama.cpp', 'ONNX', 'Serving'], conceptsFa: ['GGUF', 'llama.cpp', 'ONNX', 'سرو'] },
    ],
    packCount: 2,
    persianSupport: true,
    expertDomain: 'software-engineering',
  },

  // ── System Architecture (Phase 55, preserved) ──
  {
    domain: 'system-architecture',
    name: 'System Architecture',
    nameFa: 'معماری سیستم',
    description: 'Operating systems, networking, cloud, distributed systems',
    descriptionFa: 'سیستم‌عامل، شبکه، ابر، سیستم‌های توزیع‌شده',
    subdomains: [
      { id: 'operating-systems', name: 'Operating Systems', nameFa: 'سیستم‌عامل', concepts: ['Process', 'Thread', 'Memory', 'Scheduler'], conceptsFa: ['پروسس', 'رشته', 'حافظه', 'زمان‌بند'] },
      { id: 'networking', name: 'Networking', nameFa: 'شبکه', concepts: ['TCP/IP', 'DNS', 'HTTP', 'Socket'], conceptsFa: ['TCP/IP', 'DNS', 'HTTP', 'سوکت'] },
      { id: 'cloud', name: 'Cloud', nameFa: 'ابر', concepts: ['AWS', 'Azure', 'K8s', 'Serverless'], conceptsFa: ['AWS', 'آزور', 'K8s', 'سرورلس'] },
      { id: 'distributed-systems', name: 'Distributed Systems', nameFa: 'سیستم‌های توزیع‌شده', concepts: ['Consensus', 'CAP', 'Replication', 'Sharding'], conceptsFa: ['اجماع', 'CAP', 'هم‌نسخه‌سازی', 'شاردینگ'] },
    ],
    packCount: 2,
    persianSupport: true,
    expertDomain: 'software-engineering',
  },

  // ── Science (Phase 55, preserved) ──
  {
    domain: 'science',
    name: 'Science',
    nameFa: 'علوم',
    description: 'Mathematics, physics, chemistry, biology',
    descriptionFa: 'ریاضی، فیزیک، شیمی، زیست‌شناسی',
    subdomains: [
      { id: 'mathematics', name: 'Mathematics', nameFa: 'ریاضی', concepts: ['Calculus', 'Linear Algebra', 'Probability', 'Statistics'], conceptsFa: ['حسابان', 'جبر خطی', 'احتمال', 'آمار'] },
      { id: 'physics', name: 'Physics', nameFa: 'فیزیک', concepts: ['Mechanics', 'Electromagnetism', 'Thermodynamics', 'Quantum'], conceptsFa: ['مکانیک', 'الکترومغناطیس', 'ترمودینامیک', 'کوانتوم'] },
      { id: 'chemistry', name: 'Chemistry', nameFa: 'شیمی', concepts: ['Organic', 'Inorganic', 'Reactions', 'Bonding'], conceptsFa: ['آلی', 'غیرآلی', 'واکنش‌ها', 'پیوند'] },
      { id: 'biology', name: 'Biology', nameFa: 'زیست‌شناسی', concepts: ['Cell', 'Genetics', 'Ecology', 'Evolution'], conceptsFa: ['سلول', 'ژنتیک', 'اکولوژی', 'تکامل'] },
    ],
    packCount: 2,
    persianSupport: true,
    expertDomain: 'science',
  },

  // ── Architecture (Phase 60 NEW) ──
  {
    domain: 'architecture',
    name: 'Architecture & Civil Engineering',
    nameFa: 'معماری و مهندسی عمران',
    description: 'Building design, structures, materials, CAD concepts',
    descriptionFa: 'طراحی ساختمان، سازه‌ها، مصالح، مفاهیم CAD',
    subdomains: [
      { id: 'building-design', name: 'Building Design', nameFa: 'طراحی ساختمان', concepts: ['Floor Plan', 'Elevation', 'Section', 'Site Plan'], conceptsFa: ['نقشه طبقه', 'نمای', 'مقطع', ' site plan'] },
      { id: 'structures', name: 'Structures', nameFa: 'سازه‌ها', concepts: ['Beam', 'Column', 'Foundation', 'Load Bearing'], conceptsFa: ['تیر', 'ستون', 'فونداسیون', 'باربر'] },
      { id: 'materials', name: 'Materials', nameFa: 'مصالح', concepts: ['Concrete', 'Steel', 'Wood', 'Masonry'], conceptsFa: ['بتن', 'فولاد', 'چوب', 'بنایی'] },
      { id: 'cad-concepts', name: 'CAD Concepts', nameFa: 'مفاهیم CAD', concepts: ['AutoCAD', 'Revit', 'BIM', 'Drafting'], conceptsFa: ['اتوکد', 'رویت', 'BIM', 'درافتینگ'] },
    ],
    packCount: 2,
    persianSupport: true,
    expertDomain: 'general',
  },

  // ── Mechanical (Phase 60 NEW) ──
  {
    domain: 'mechanical',
    name: 'Mechanical Engineering',
    nameFa: 'مهندسی مکانیک',
    description: 'Mechanics, machines, manufacturing',
    descriptionFa: 'مکانیک، ماشین‌ها، تولید',
    subdomains: [
      { id: 'mechanics', name: 'Mechanics', nameFa: 'مکانیک', concepts: ['Statics', 'Dynamics', 'Kinematics', 'Strength of Materials'], conceptsFa: ['استاتیک', 'دینامیک', 'سینماتیک', 'مقاومت مصالح'] },
      { id: 'machines', name: 'Machines', nameFa: 'ماشین‌ها', concepts: ['Gears', 'Bearings', 'Linkages', 'Cam'], conceptsFa: ['چرخ‌دنده', 'یاتاقان', 'مکانیزم', 'کم'] },
      { id: 'manufacturing', name: 'Manufacturing', nameFa: 'تولید', concepts: ['Machining', 'Welding', 'Casting', '3D Printing'], conceptsFa: ['ماشین‌کاری', 'جوشکاری', 'ریخته‌گری', 'چاپ سه‌بعدی'] },
    ],
    packCount: 1,
    persianSupport: true,
    expertDomain: 'general',
  },

  // ── Business (Phase 60 NEW) ──
  {
    domain: 'business',
    name: 'Business & Management',
    nameFa: 'کسب‌وکار و مدیریت',
    description: 'Business, project management, strategy',
    descriptionFa: 'کسب‌وکار، مدیریت پروژه، استراتژی',
    subdomains: [
      { id: 'business', name: 'Business', nameFa: 'کسب‌وکار', concepts: ['Business Model', 'Startup', 'Marketing', 'Sales'], conceptsFa: ['مدل کسب‌وکار', 'استارتاپ', 'بازاریابی', 'فروش'] },
      { id: 'project-management', name: 'Project Management', nameFa: 'مدیریت پروژه', concepts: ['Agile', 'Scrum', 'Kanban', 'Gantt'], conceptsFa: ['چابک', 'اسکروم', 'کانبان', 'گانت'] },
      { id: 'strategy', name: 'Strategy', nameFa: 'استراتژی', concepts: ['SWOT', 'Porter', 'BCG Matrix', 'OKR'], conceptsFa: ['SWOT', 'پورتر', 'BCG', 'OKR'] },
    ],
    packCount: 1,
    persianSupport: true,
    expertDomain: 'business',
  },

  // ── Economics (Phase 60 NEW) ──
  {
    domain: 'economics',
    name: 'Economics',
    nameFa: 'اقتصاد',
    description: 'Microeconomics, macroeconomics, finance',
    descriptionFa: 'اقتصاد خرد، اقتصاد کلان، مالی',
    subdomains: [
      { id: 'microeconomics', name: 'Microeconomics', nameFa: 'اقتصاد خرد', concepts: ['Supply', 'Demand', 'Elasticity', 'Market Equilibrium'], conceptsFa: ['عرضه', 'تقاضا', 'کشش', 'تعادل بازار'] },
      { id: 'macroeconomics', name: 'Macroeconomics', nameFa: 'اقتصاد کلان', concepts: ['GDP', 'Inflation', 'Unemployment', 'Fiscal Policy'], conceptsFa: ['تولید ناخالص داخلی', 'تورم', 'بیکاری', 'سیاست مالی'] },
      { id: 'finance', name: 'Finance', nameFa: 'مالی', concepts: ['NPV', 'IRR', 'ROI', 'Cash Flow'], conceptsFa: ['NPV', 'IRR', 'بازگشت سرمایه', 'جریان نقدی'] },
    ],
    packCount: 1,
    persianSupport: true,
    expertDomain: 'business',
  },
];

// ─── New Phase 60 Knowledge Packs ──────────────────────────────────────────

export const PHASE60_KNOWLEDGE_PACKS: UniversalKnowledgePack[] = [
  // ── Architecture ──
  {
    id: 'arch-building-design',
    domain: 'architecture',
    subdomain: 'building-design',
    name: 'Building Design Pack',
    nameFa: 'بسته طراحی ساختمان',
    description: 'Floor plans, elevations, sections, site planning principles',
    descriptionFa: 'نقشه‌های طبقه، نماها، مقاطع، اصول برنامه‌ریزی سایت',
    sizeBytes: 2_500_000,
    version: '1.0.0',
    documentCount: 4,
    capabilities: ['Explain building design principles', 'Guide floor plan creation'],
    capabilitiesFa: ['توضیح اصول طراحی ساختمان', 'راهنمایی ایجاد نقشه طبقه'],
    languages: ['en', 'fa'],
    persianSupport: true,
    concepts: ['Floor Plan', 'Elevation', 'Section', 'Site Plan'],
    conceptsFa: ['نقشه طبقه', 'نما', 'مقطع', 'برنامه سایت'],
    isPhase60New: true,
  },
  {
    id: 'arch-structures-materials',
    domain: 'architecture',
    subdomain: 'structures',
    name: 'Structures & Materials Pack',
    nameFa: 'بسته سازه‌ها و مصالح',
    description: 'Structural analysis, load bearing, concrete, steel, material properties',
    descriptionFa: 'تحلیل سازه‌ای، باربر، بتن، فولاد، خواص مصالح',
    sizeBytes: 3_000_000,
    version: '1.0.0',
    documentCount: 5,
    capabilities: ['Analyze structural loads', 'Select construction materials'],
    capabilitiesFa: ['تحلیل بارهای سازه‌ای', 'انتخاب مصالح ساختمانی'],
    languages: ['en', 'fa'],
    persianSupport: true,
    concepts: ['Beam', 'Column', 'Foundation', 'Concrete', 'Steel'],
    conceptsFa: ['تیر', 'ستون', 'فونداسیون', 'بتن', 'فولاد'],
    isPhase60New: true,
  },

  // ── Mechanical ──
  {
    id: 'mech-fundamentals',
    domain: 'mechanical',
    subdomain: 'mechanics',
    name: 'Mechanical Engineering Fundamentals Pack',
    nameFa: 'بسته مبانی مهندسی مکانیک',
    description: 'Statics, dynamics, kinematics, strength of materials, machines, manufacturing',
    descriptionFa: 'استاتیک، دینامیک، سینماتیک، مقاومت مصالح، ماشین‌ها، تولید',
    sizeBytes: 4_000_000,
    version: '1.0.0',
    documentCount: 6,
    capabilities: ['Analyze mechanical systems', 'Design machine elements', 'Select manufacturing processes'],
    capabilitiesFa: ['تحلیل سیستم‌های مکانیکی', 'طراحی عناصر ماشین', 'انتخاب فرآیندهای تولید'],
    languages: ['en', 'fa'],
    persianSupport: true,
    concepts: ['Statics', 'Dynamics', 'Gears', 'Bearings', 'Machining'],
    conceptsFa: ['استاتیک', 'دینامیک', 'چرخ‌دنده', 'یاتاقان', 'ماشین‌کاری'],
    isPhase60New: true,
  },

  // ── Business ──
  {
    id: 'biz-management',
    domain: 'business',
    subdomain: 'business',
    name: 'Business & Project Management Pack',
    nameFa: 'بسته کسب‌وکار و مدیریت پروژه',
    description: 'Business models, agile, scrum, strategy, project planning',
    descriptionFa: 'مدل‌های کسب‌وکار، چابک، اسکروم، استراتژی، برنامه‌ریزی پروژه',
    sizeBytes: 2_000_000,
    version: '1.0.0',
    documentCount: 4,
    capabilities: ['Plan projects', 'Analyze business strategy', 'Apply agile methodologies'],
    capabilitiesFa: ['برنامه‌ریزی پروژه', 'تحلیل استراتژی کسب‌وکار', 'اعمال متدولوژی‌های چابک'],
    languages: ['en', 'fa'],
    persianSupport: true,
    concepts: ['Agile', 'Scrum', 'Business Model', 'SWOT'],
    conceptsFa: ['چابک', 'اسکروم', 'مدل کسب‌وکار', 'SWOT'],
    isPhase60New: true,
  },

  // ── Economics ──
  {
    id: 'econ-fundamentals',
    domain: 'economics',
    subdomain: 'microeconomics',
    name: 'Economics Fundamentals Pack',
    nameFa: 'بسته مبانی اقتصاد',
    description: 'Microeconomics, macroeconomics, supply & demand, finance basics',
    descriptionFa: 'اقتصاد خرد، اقتصاد کلان، عرضه و تقاضا، مبانی مالی',
    sizeBytes: 1_800_000,
    version: '1.0.0',
    documentCount: 3,
    capabilities: ['Explain economic concepts', 'Analyze market dynamics', 'Calculate financial metrics'],
    capabilitiesFa: ['توضیح مفاهیم اقتصادی', 'تحلیل پویایی بازار', 'محاسبه معیارهای مالی'],
    languages: ['en', 'fa'],
    persianSupport: true,
    concepts: ['Supply', 'Demand', 'GDP', 'Inflation', 'NPV'],
    conceptsFa: ['عرضه', 'تقاضا', 'تولید ناخالص داخلی', 'تورم', 'NPV'],
    isPhase60New: true,
  },

  // ── Software Engineering expansion (cybersecurity + databases + devops) ──
  {
    id: 'sw-cybersecurity',
    domain: 'software-engineering',
    subdomain: 'cybersecurity',
    name: 'Cybersecurity Pack',
    nameFa: 'بسته امنیت سایبری',
    description: 'OWASP, encryption, authentication, vulnerability analysis',
    descriptionFa: 'OWASP، رمزنگاری، احراز هویت، تحلیل آسیب‌پذیری',
    sizeBytes: 2_200_000,
    version: '1.0.0',
    documentCount: 4,
    capabilities: ['Identify vulnerabilities', 'Apply security best practices', 'Explain encryption'],
    capabilitiesFa: ['شناسایی آسیب‌پذیری‌ها', 'اعمال بهترین روش‌های امنیتی', 'توضیح رمزنگاری'],
    languages: ['en', 'fa'],
    persianSupport: true,
    concepts: ['OWASP', 'Encryption', 'Auth', 'Vulnerabilities'],
    conceptsFa: ['OWASP', 'رمزنگاری', 'احراز هویت', 'آسیب‌پذیری'],
    isPhase60New: true,
  },
  {
    id: 'sw-databases-devops',
    domain: 'software-engineering',
    subdomain: 'databases',
    name: 'Databases & DevOps Pack',
    nameFa: 'بسته پایگاه داده و دواپس',
    description: 'SQL, NoSQL, indexing, Docker, Kubernetes, CI/CD',
    descriptionFa: 'SQL، NoSQL، ایندکس، داکر، کوبرنیتیز، CI/CD',
    sizeBytes: 2_800_000,
    version: '1.0.0',
    documentCount: 5,
    capabilities: ['Design database schemas', 'Set up CI/CD pipelines', 'Deploy with Docker/K8s'],
    capabilitiesFa: ['طراحی اسکمای پایگاه داده', 'تنظیم خط لوله CI/CD', 'استقرار با داکر/کوبرنیتیز'],
    languages: ['en', 'fa'],
    persianSupport: true,
    concepts: ['SQL', 'NoSQL', 'Docker', 'Kubernetes', 'CI/CD'],
    conceptsFa: ['SQL', 'NoSQL', 'داکر', 'کوبرنیتیز', 'CI/CD'],
    isPhase60New: true,
  },
];

// ─── Knowledge Graph construction ─────────────────────────────────────────

function buildKnowledgeGraph(): KnowledgeGraph {
  const nodes: KnowledgeGraphNode[] = [];
  const edges: KnowledgeGraphEdge[] = [];

  for (const domain of UNIVERSAL_DOMAINS) {
    // Domain node
    const domainNodeId = `domain:${domain.domain}`;
    nodes.push({
      id: domainNodeId,
      type: 'domain',
      label: domain.name,
      labelFa: domain.nameFa,
      domain: domain.domain,
      parentId: null,
      related: [],
    });

    for (const sub of domain.subdomains) {
      // Subdomain node
      const subNodeId = `subdomain:${domain.domain}:${sub.id}`;
      nodes.push({
        id: subNodeId,
        type: 'subdomain',
        label: sub.name,
        labelFa: sub.nameFa,
        domain: domain.domain,
        parentId: domainNodeId,
        related: [],
      });
      edges.push({ source: domainNodeId, target: subNodeId, relationship: 'contains' });

      for (const concept of sub.concepts) {
        const conceptNodeId = `concept:${domain.domain}:${sub.id}:${concept}`;
        nodes.push({
          id: conceptNodeId,
          type: 'concept',
          label: concept,
          labelFa: sub.conceptsFa[sub.concepts.indexOf(concept)] || concept,
          domain: domain.domain,
          parentId: subNodeId,
          related: [],
        });
        edges.push({ source: subNodeId, target: conceptNodeId, relationship: 'contains' });
      }
    }
  }

  // Cross-link related concepts (simple heuristic: same concept name in different domains)
  const conceptByName = new Map<string, KnowledgeGraphNode[]>();
  for (const n of nodes) {
    if (n.type === 'concept') {
      const arr = conceptByName.get(n.label) || [];
      arr.push(n);
      conceptByName.set(n.label, arr);
    }
  }
  for (const [name, group] of conceptByName) {
    if (group.length > 1) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          group[i].related.push(group[j].id);
          group[j].related.push(group[i].id);
          edges.push({ source: group[i].id, target: group[j].id, relationship: 'related-to' });
        }
      }
    }
    void name;
  }

  return { nodes, edges };
}

let _graph: KnowledgeGraph | null = null;

export function getKnowledgeGraph(): KnowledgeGraph {
  if (!_graph) _graph = buildKnowledgeGraph();
  return _graph;
}

// ─── Catalog queries ─────────────────────────────────────────────────────

export function getUniversalDomains(): DomainInfo[] {
  return UNIVERSAL_DOMAINS;
}

export function getUniversalDomain(domain: UniversalKnowledgeDomain): DomainInfo | null {
  return UNIVERSAL_DOMAINS.find((d) => d.domain === domain) || null;
}

export function getPhase60Packs(): UniversalKnowledgePack[] {
  return PHASE60_KNOWLEDGE_PACKS;
}

export function getPhase60PacksByDomain(domain: UniversalKnowledgeDomain): UniversalKnowledgePack[] {
  return PHASE60_KNOWLEDGE_PACKS.filter((p) => p.domain === domain);
}

export function getPhase60Pack(id: string): UniversalKnowledgePack | null {
  return PHASE60_KNOWLEDGE_PACKS.find((p) => p.id === id) || null;
}

export function getAllUniversalPacks(): UniversalKnowledgePack[] {
  // Phase 60 packs (Phase 55 packs are managed by the Phase 55 engine)
  return PHASE60_KNOWLEDGE_PACKS;
}

/**
 * Map a universal knowledge domain to the expert domain for routing.
 * New domains (architecture/mechanical) route to 'general' since Phase 53
 * has no dedicated expert for them; business/economics route to 'business'.
 */
export function universalDomainToExpertDomain(domain: UniversalKnowledgeDomain): ExpertDomain {
  switch (domain) {
    case 'software-engineering': return 'software-engineering';
    case 'electronics-engineering': return 'electronics-engineering';
    case 'ai-engineering': return 'software-engineering';
    case 'system-architecture': return 'software-engineering';
    case 'science': return 'science';
    case 'architecture': return 'general';
    case 'mechanical': return 'general';
    case 'business': return 'business';
    case 'economics': return 'business';
    default: return 'general';
  }
}

export const UNIVERSAL_DOMAIN_LABELS_FA: Record<UniversalKnowledgeDomain, string> = {
  'software-engineering': 'مهندسی نرم‌افزار',
  'electronics-engineering': 'مهندسی الکترونیک',
  'ai-engineering': 'مهندسی هوش مصنوعی',
  'system-architecture': 'معماری سیستم',
  'science': 'علوم',
  'architecture': 'معماری و عمران',
  'mechanical': 'مهندسی مکانیک',
  'business': 'کسب‌وکار',
  'economics': 'اقتصاد',
};

/**
 * Detect the best knowledge domain for a user query via keyword matching.
 * Used by the UniversalKnowledgeBrain for expert knowledge routing.
 *
 * Matches against:
 *   - subdomain names (English + Persian)
 *   - concepts (English + Persian)
 *   - domain name (Persian)
 */
export function detectDomainForQuery(query: string): UniversalKnowledgeDomain | null {
  const lower = query.toLowerCase();
  const persian = /[\u0600-\u06FF]/.test(query);

  // Score each domain by keyword matches
  let bestDomain: UniversalKnowledgeDomain | null = null;
  let bestScore = 0;

  for (const domain of UNIVERSAL_DOMAINS) {
    let score = 0;
    // Match domain name (Persian)
    if (persian && query.includes(domain.nameFa)) score += 3;
    for (const sub of domain.subdomains) {
      // Match subdomain names (English + Persian)
      if (lower.includes(sub.name.toLowerCase())) score += 2;
      if (query.includes(sub.nameFa)) score += 2;
      for (const concept of sub.concepts) {
        if (lower.includes(concept.toLowerCase())) score += 2;
      }
      for (const conceptFa of sub.conceptsFa) {
        if (query.includes(conceptFa)) score += 2;
      }
    }
    if (persian && domain.persianSupport) score += 1;
    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain.domain;
    }
  }

  return bestScore > 0 ? bestDomain : null;
}

// ─── Security self-audit ───────────────────────────────────────────────────

export function verifyCatalogSecurity(): { ok: boolean; findings: string[] } {
  const findings: string[] = [];
  // Verify no duplicate pack IDs
  const ids = new Set<string>();
  for (const p of PHASE60_KNOWLEDGE_PACKS) {
    if (ids.has(p.id)) findings.push(`Duplicate pack id: ${p.id}`);
    ids.add(p.id);
  }
  return { ok: findings.length === 0, findings };
}
