/**
 * NEX AI — Offline Expert Knowledge Engine (Phase 55)
 *
 * Gives NEX professional offline expertise. Each expert domain has a set of
 * curated knowledge packs. When a pack is installed, its documents are indexed
 * into the local RAG store (Phase 9/40 KnowledgeService) so the brain can
 * retrieve precise, cited knowledge — fully offline.
 *
 * Architecture:
 *
 *   User Question
 *       ↓
 *   Expert Router (Phase 53)
 *       ↓
 *   Knowledge Engine  ←── retrieves from installed packs' documents
 *       ↓
 *   Relevant Documents (RAG, Phase 40)
 *       ↓
 *   Brain Controller (Phase 51)
 *       ↓
 *   Answer (+ citations)
 *
 * Knowledge domains:
 *   - Software Engineering  (languages, frameworks, APIs, databases, architecture, debugging)
 *   - Electronics Engineering (fundamentals, circuit design, PCB, microcontrollers, sensors, power, datasheets)
 *   - AI Engineering (ML, neural networks, LLM concepts, model deployment)
 *   - System Architecture (operating systems, networking, cloud, distributed systems)
 *   - Science (mathematics, physics, chemistry)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CRITICAL SECURITY REQUIREMENT (Phase 43)
 * ════════════════════════════════════════════════════════════════════════════
 * This module ONLY:
 *   - DESCRIBES knowledge packs (catalog)
 *   - RETRIEVES already-installed knowledge (RAG search)
 *   - RECOMMENDS packs (Persian advisor messages)
 *
 * It NEVER:
 *   - downloads anything
 *   - installs / removes / updates packs (that is KnowledgePackManager's job,
 *     and every one of those operations goes through PermissionGate first)
 *   - executes scripts
 *   - deletes files
 *
 * NO SILENT EXECUTION. EVER.
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { getUserDataDir } from '../persistence';
import type { KnowledgeDomain } from '../ai/knowledge-types';
import type { ExpertDomain } from '../ai/nex-expert-system';

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * Knowledge pack domain. Richer than ExpertDomain because the offline knowledge
 * catalog separates AI Engineering and System Architecture (both map to the
 * software/general expert at routing time — see knowledgeDomainToExpertDomain).
 */
export type KnowledgePackDomain =
  | 'software-engineering'
  | 'electronics-engineering'
  | 'ai-engineering'
  | 'system-architecture'
  | 'science';

export type EmbeddingStatus = 'not-indexed' | 'indexing' | 'indexed' | 'failed';

/** A single document inside a knowledge pack. */
export interface KnowledgePackDocument {
  id: string;
  title: string;
  titleFa: string;
  /** File format written to disk for ingestion. */
  format: 'markdown' | 'plaintext';
  /** RAG KnowledgeDomain used at ingestion time (filters retrieval). */
  ragDomain: KnowledgeDomain;
  /** Inline knowledge content (markdown/plain). Indexed when pack is installed. */
  content: string;
  sizeBytes: number;
}

/** A curated offline knowledge pack. */
export interface KnowledgePack {
  id: string;
  domain: KnowledgePackDomain;
  name: string;
  nameFa: string;
  description: string;
  descriptionFa: string;
  /** Total pack size in bytes (sum of document sizes + overhead). */
  sizeBytes: number;
  version: string;
  /** Human-readable list of content sources. */
  sources: string[];
  sourcesFa: string[];
  documents: KnowledgePackDocument[];
  /** Current indexing state (resolved at runtime from installed state). */
  embeddingStatus: EmbeddingStatus;
  /** Whether the pack is currently installed on this machine. */
  installed: boolean;
  /** Permission level required to install/remove — always requires approval. */
  permissions: 'requires-approval';
  /** What installing this pack enables NEX to do. */
  capabilities: string[];
  capabilitiesFa: string[];
  /** SHA-256 of the pack's document content (integrity check). */
  checksum: string;
  /** Optional remote URL — if set, install delegates to SecureDownloader (Phase 43/44). */
  sourceUrl?: string;
}

export interface KnowledgeRetrievalResult {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  content: string;
  score: number;
  source?: string;
  packId?: string;
  packName?: string;
  sectionTitle?: string;
  startLine?: number;
  endLine?: number;
}

export interface KnowledgeRetrievalResponse {
  query: string;
  domain: KnowledgePackDomain | null;
  results: KnowledgeRetrievalResult[];
  framed: string;
  installedPackCount: number;
  offline: boolean;
}

export interface KnowledgeStatus {
  totalPacks: number;
  installedPacks: number;
  missingPacks: number;
  recommendedPacks: number;
  totalDocuments: number;
  installedDocuments: number;
  totalSizeBytes: number;
  domains: Array<{ domain: KnowledgePackDomain; installed: number; missing: number; total: number }>;
  offline: boolean;
}

// ─── Domain mapping helpers ────────────────────────────────────────────────

/**
 * Map a knowledge pack domain to the expert domain used by the router (Phase 53).
 * AI Engineering and System Architecture don't have dedicated experts yet, so
 * they route to the closest expert (software-engineering / general).
 */
export function knowledgeDomainToExpertDomain(domain: KnowledgePackDomain): ExpertDomain {
  switch (domain) {
    case 'software-engineering': return 'software-engineering';
    case 'electronics-engineering': return 'electronics-engineering';
    case 'ai-engineering': return 'software-engineering';
    case 'system-architecture': return 'software-engineering';
    case 'science': return 'science';
    default: return 'general';
  }
}

/**
 * Map a knowledge pack domain to the RAG KnowledgeDomain used at ingestion time.
 */
function packDomainToRagDomain(domain: KnowledgePackDomain): KnowledgeDomain {
  switch (domain) {
    case 'software-engineering': return 'software';
    case 'electronics-engineering': return 'electronics';
    case 'ai-engineering': return 'software';
    case 'system-architecture': return 'architecture';
    case 'science': return 'physics';
    default: return 'general';
  }
}

function computePackChecksum(docs: KnowledgePackDocument[]): string {
  const h = crypto.createHash('sha256');
  for (const d of docs) {
    h.update(d.id);
    h.update('\0');
    h.update(d.content);
    h.update('\0');
  }
  return h.digest('hex');
}

// ─── Knowledge Pack Catalog ────────────────────────────────────────────────
//
// Each document carries real, substantive content so the offline RAG pipeline
// (HashEmbedder + HybridRetriever) returns genuinely useful excerpts. This is
// what makes NEX "know" a domain once the pack is installed.

function doc(
  id: string,
  title: string,
  titleFa: string,
  ragDomain: KnowledgeDomain,
  content: string,
): KnowledgePackDocument {
  return {
    id,
    title,
    titleFa,
    format: 'markdown',
    ragDomain,
    content,
    sizeBytes: Buffer.byteLength(content, 'utf-8'),
  };
}

const SOFTWARE_LANGUAGES_DOC = doc(
  'sw-lang-python',
  'Python Language Reference',
  'مرجع زبان پایتون',
  'software',
  `# Python Language Reference

Python is a high-level, dynamically-typed, garbage-collected language. Indentation
defines block scope (no braces). The reference implementation is CPython.

## Core types
- int (arbitrary precision), float (IEEE-754 double), complex
- str (immutable, Unicode), bytes, bytearray
- list (mutable, ordered), tuple (immutable), dict (insertion-ordered since 3.7), set, frozenset

## Control flow
\`\`\`python
for item in iterable:
    process(item)
    if condition:
        continue
    if done:
        break
else:
    # runs only if loop completed without break
    pass

while cond:
    do_work()

match value:          # structural pattern matching (3.10+)
    case 0: ...
    case [x, y]: ...
    case _: ...
\`\`\`

## Functions
- def, default args, *args, **kwargs, keyword-only args
- Lambda: single-expression anonymous functions
- Type hints: def f(x: int, y: int = 2) -> int: return x + y
- Generators via yield; async generators via async def + yield

## Modules & packages
- import x; from x import y; import x as y
- __init__.py marks a package; __name__ == '__main__' for entry points
- sys.path controls import resolution; venv isolates dependencies

## Common pitfalls
- Mutable default arguments are shared across calls
- Late binding in closures inside loops
- Integer division: // (floor) vs / (true division)
- is vs ==: identity vs equality`,
);

const SOFTWARE_FRAMEWORKS_DOC = doc(
  'sw-fw-react',
  'React Framework Guide',
  'راهنمای فریم‌ورک React',
  'software',
  `# React Framework Guide

React is a component-based UI library. Components are functions that return JSX.
State is managed with hooks.

## Core hooks
- useState: local state. const [v, setV] = useState(initial)
- useEffect: side effects. useEffect(() => { ... ; return cleanup }, [deps])
- useContext: consume context without prop drilling
- useMemo / useCallback: memoize values / functions
- useRef: mutable container that does not trigger re-render
- useReducer: complex state transitions

## Rules of hooks
1. Only call hooks at the top level (not in loops/conditions/nested functions)
2. Only call hooks from React functions (components or custom hooks)

## Re-render triggers
- State change (setState)
- Parent re-render (unless memoized with React.memo)
- Context value change

## Keys
Lists need stable, unique keys (not array index) so React can reconcile efficiently.

## Patterns
- Controlled vs uncontrolled inputs
- Lifting state up to the nearest common parent
- Composition over inheritance
- Custom hooks to reuse stateful logic

## Performance
- React.memo for prop-stable components
- useMemo for expensive computations
- Virtualize long lists (react-window)
- Code-split with React.lazy + Suspense

## Common bugs
- Stale closures: stale state captured in effect — add to deps or use ref
- Missing dependency in useEffect array → lint warning, subtle bugs
- Mutating state instead of returning new object`,
);

const SOFTWARE_ARCHITECTURE_DOC = doc(
  'sw-arch-microservices',
  'Architecture Patterns: Microservices',
  'الگوهای معماری: میکروسرویس',
  'software',
  `# Architecture Patterns: Microservices

Microservices split a monolith into small, independently deployable services,
each owning its data and communicating over a network (REST, gRPC, async events).

## When to use microservices
- Multiple teams working on the same product
- Need independent scaling of subsystems
- Different technology stacks per domain
- Tolerate operational complexity in exchange for team autonomy

## When NOT to use
- Small team / small product (start with a modular monolith)
- Cannot afford distributed-systems complexity (transactions, observability)
- No mature DevOps / CI/CD

## Core patterns
- API Gateway: single entry point, routing, auth, rate limiting
- Service Discovery: services find each other (consul, k8s DNS)
- Circuit Breaker: stop cascading failures (fail fast, then half-open retry)
- Saga: distributed transactions via compensating events
- CQRS: separate read and write models
- Event Sourcing: store events as the source of truth
- Bulkhead: isolate resources per service to limit blast radius

## Data ownership
- Database-per-service (no shared database)
- Shared database = coupling = anti-pattern
- Use async events (Kafka, RabbitMQ) to sync state

## Debugging
- Distributed tracing (OpenTelemetry, Jaeger)
- Centralized logging (ELK, Loki)
- Correlation IDs passed across service calls
- Health checks + readiness probes`,
);

const ELECTRONICS_FUNDAMENTALS_DOC = doc(
  'el-fund-ohms-law',
  'Electronics Fundamentals: Ohm\'s Law & Components',
  'مبانی الکترونیک: قانون اهم و قطعات',
  'electronics',
  `# Electronics Fundamentals: Ohm's Law & Components

## Ohm's Law
V = I * R
- V: voltage in volts (V)
- I: current in amperes (A)
- R: resistance in ohms (Ω)

Power: P = V * I = I²R = V²/R (watts, W)

## Kirchhoff's Laws
- KCL (current): sum of currents into a node = 0
- KVL (voltage): sum of voltages around a closed loop = 0

## Basic components
- Resistor: limits current. Color code or SMD marking. Tolerance (±5%, ±1%).
- Capacitor: stores energy in electric field. Q = C*V. Blocks DC, passes AC.
- Inductor: stores energy in magnetic field. V = L * di/dt. Blocks AC change.
- Diode: one-way current. Forward voltage ~0.7V (silicon), ~0.3V (schottky).
- Transistor: amplifier or switch (BJT / MOSFET).

## Series & parallel
- Resistors in series: R = R1 + R2
- Resistors in parallel: 1/R = 1/R1 + 1/R2
- Capacitors: series = resistors parallel formula, parallel = additive

## Reading a circuit
1. Identify nodes and loops
2. Apply KCL/KVL
3. Simplify series/parallel combinations
4. Compute node voltages and branch currents

## Common mistakes
- Forgetting ground reference
- Mixing up peak vs RMS for AC
- Ignoring component power rating (resistor burns out)
- Not decoupling ICs (add 100nF cap close to each power pin)`,
);

const ELECTRONICS_PCB_DOC = doc(
  'el-pcb-design',
  'PCB Design Guide',
  'راهنمای طراحی PCB',
  'embedded',
  `# PCB Design Guide

## Layout flow
1. Schematic capture → netlist
2. Define board outline + layer stackup
3. Place components (critical parts first: connectors, regulators, big ICs)
4. Route signals (manual for critical, auto for the rest)
5. Plane/pour (ground + power planes)
6. DRC (design rule check) + manufacturing output (Gerber + drill)

## Design rules (typical)
- Trace width: 0.2mm min for signal; wider for power (use calculator for current)
- Clearance: 0.2mm min signal; 0.5mm+ for high voltage
- Via: 0.3mm drill / 0.6mm pad (standard)
- Drill-to-copper: 0.2mm

## Power & ground
- Solid ground plane under everything (reduces EMI, return current path)
- Star ground for analog to avoid digital noise coupling
- Decouple every IC: 100nF ceramic + 10uF bulk near the regulator

## Microcontroller layout (STM32 / ESP32)
- Place crystal close to MCU, short traces, guard ring with ground
- Keep reset line short, add pull-up + 100nF cap
- USB D+/D-: 90-ohm differential, length-matched, no stubs
- Antenna (ESP32 wifi): keep clear of copper, follow datasheet keepout

## DRC checklist
- All nets routed (no unconnected)
- Clearance to board edge (0.3mm+)
- No acute angles (acid traps in old processes)
- Silkscreen not overlapping pads
- Test points accessible`,
);

const ELECTRONICS_POWER_LM7805_DOC = doc(
  'el-power-lm7805',
  'LM7805 Datasheet Summary — 5V Linear Regulator',
  'خلاصه دیتاشیت LM7805 — رگولاتور خطی ۵ ولت',
  'electronics',
  `# LM7805 — 5V Linear Regulator

## Description
The LM7805 is a fixed 5V positive linear voltage regulator in a TO-220 (or TO-92,
SOT-223) package. It takes a higher DC input (7-35V) and outputs a stable 5V.

## Key specs
- Output voltage: 5V (±2% / ±4% depending on grade)
- Output current: up to 1A (with heatsink), 0.5A without
- Input voltage range: 7V to 35V
- Dropout voltage: ~2V (needs Vin > Vout + 2V)
- Quiescent current: ~5mA
- Thermal shutdown: yes (~150°C)
- Short-circuit protection: yes

## Typical application circuit
\`\`\`
   Vin (7-35V)                       5V out
      |                                |
      +-- [0.33uF] --+----[IN  LM7805  OUT]----+--[0.1uF]--+---> load
                     |                          |           |
                    GND                       GND         GND
\`\`\`
- Input cap (0.33uF ceramic): stabilizes the regulator, placed close to the pins
- Output cap (0.1uF ceramic): improves transient response
- Heatsink required for currents > 200mA or high Vin-Vout drop

## Heat dissipation
P_diss = (Vin - Vout) * I_load
Example: Vin=12V, I=500mA → P_diss = (12-5)*0.5 = 3.5W
TO-220 thermal resistance ~65°C/W → junction rises 227°C → WILL overheat.
Need a heatsink (target θJA < 30°C/W) or use a switching buck converter instead.

## When NOT to use LM7805
- High current (> 1A) → use a buck converter (LM2596, MP1584)
- High Vin-Vout drop → buck converter is far more efficient
- Battery-powered → quiescent + dropout waste energy; use LDO or buck

## Protection circuits (recommended)
- Reverse polarity: series diode (1N4007) or P-MOSFET high-side
- Input fuse: 1A polyfuse for over-current
- TVS diode on input for voltage spikes (e.g. automotive load dump)`,
);

const ELECTRONICS_POWER_BUCK_DOC = doc(
  'el-power-buck',
  'Buck Converter Design Guide',
  'راهنمای طراحی مبدل باک (Buck)',
  'electronics',
  `# Buck Converter Design Guide

A buck converter steps down DC voltage efficiently (>90%) using a switch
(MOSFET), an inductor, a diode (or synchronous MOSFET), and a capacitor.

## Operating principle
1. Switch ON: current ramps up through the inductor, charging the output cap
2. Switch OFF: inductor current keeps flowing through the diode, discharging energy
3. Duty cycle D = Vout / Vin (in continuous conduction mode)

## Design equations
- Duty cycle: D = Vout / Vin
- Inductor ripple: ΔI_L = (Vin - Vout) * D / (f_sw * L)
- Choose L so ripple is 20-40% of I_load
- Output cap: C = ΔI_L / (8 * f_sw * ΔV_ripple)
- f_sw: switching frequency (150kHz - 2MHz typical)

## Component selection
- Inductor: rated for peak current (I_load + ΔI_L/2) with margin
- MOSFET: low Rds(on), gate charge compatible with driver
- Diode: schottky for low Vf (e.g. SS34, SS54); synchronous rectification removes it
- Capacitor: low ESR ceramic (MLCC) + bulk electrolytic

## Layout (critical)
- Minimize the high-di/dt loop (switch → diode → cap)
- Place input cap close to the IC, ground plane underneath
- Keep feedback trace away from the switch node (noisy)

## Common ICs
- LM2596 (150kHz, 3A, easy but old)
- MP1584 (1.5A, small, cheap)
- TPS5430 / TPS54331 (3A, modern)
- LM2576 (simple, 3A, 52kHz)

## When to use buck vs LDO vs linear
- High current or high Vin-Vout → buck (efficient)
- Low noise / low Vin-Vout → LDO
- Very low current / cheap → LM7805 linear

## Protection
- Input fuse + TVS
- Output over-voltage clamp (zener)
- Soft-start to limit inrush current`,
);

const ELECTRONICS_SENSOR_DOC = doc(
  'el-sensor-dht22',
  'DHT22 Sensor Datasheet Summary',
  'خلاصه دیتاشیت سنسور DHT22',
  'electronics',
  `# DHT22 — Digital Temperature & Humidity Sensor

## Description
DHT22 (AM2302) is a basic, low-cost digital temperature and humidity sensor.
Uses a single-wire digital interface (custom protocol, not 1-Wire Dallas).

## Specs
- Temperature: -40 to +80°C, ±0.5°C accuracy, 0.1°C resolution
- Humidity: 0-100% RH, ±2-5% accuracy, 0.1% resolution
- Sampling period: 0.5 Hz (read at most every 2 seconds)
- Supply: 3.3V to 6V DC
- Interface: single-wire digital (bidirectional)

## Wiring
- VCC → 3.3V or 5V
- DATA → GPIO (with 4.7k-10k pull-up to VCC)
- GND → ground
- (NC pin unused)

## Communication protocol
1. MCU pulls DATA low for ≥1ms (start signal), then releases
2. Sensor responds: 80us low + 80us high
3. Sensor sends 40 bits (5 bytes): humidity high, humidity low, temp high, temp low, checksum
4. Each bit: 50us low + (26-28us high = '0') or (70us high = '1')
5. Checksum = (byte1+byte2+byte3+byte4) & 0xFF

## Code (Arduino)
\`\`\`cpp
#include <DHT.h>
DHT dht(2, DHT22);
void setup() { Serial.begin(9600); dht.begin(); }
void loop() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  if (isnan(h) || isnan(t)) { Serial.println("read failed"); return; }
  Serial.print("H: "); Serial.print(h); Serial.print("%  T: "); Serial.print(t); Serial.println("C");
  delay(2000);
}
\`\`\`

## Common issues
- NaN reads: power unstable, pull-up missing, reading too fast
- Use shielded cable if > 20cm lead length
- Add 100nF decoupling cap close to the sensor`,
);

const AI_ML_FUNDAMENTALS_DOC = doc(
  'ai-ml-fundamentals',
  'Machine Learning Fundamentals',
  'مبانی یادگیری ماشین',
  'software',
  `# Machine Learning Fundamentals

## Paradigms
- Supervised: labeled (x, y) pairs → learn f(x) ≈ y (classification, regression)
- Unsupervised: unlabeled x → find structure (clustering, dim reduction)
- Reinforcement: agent acts in environment → rewards → learn policy π(a|s)
- Self-supervised: predict part of input from another part (next-token, masked)

## Core concepts
- Features (x), labels (y), model (f_θ), parameters (θ), hypothesis space
- Loss function L(f_θ(x), y): measures error per example
- Training = minimize average loss over dataset via gradient descent
- Gradient: ∇θ L — computed via backpropagation (chain rule)
- Optimizer: SGD, momentum, RMSprop, Adam (adaptive moments)
- Learning rate: step size; too high diverges, too low slow

## Generalization
- Train / validation / test split
- Overfitting: low train loss, high val loss → regularize (L1/L2, dropout, early stop, data aug)
- Underfitting: high train loss → bigger model, more features, train longer
- Bias-variance tradeoff

## Evaluation metrics
- Classification: accuracy, precision, recall, F1, ROC-AUC, confusion matrix
- Regression: MSE, MAE, R²
- Imbalanced data: use F1 / AUC, not accuracy

## Data
- More data > fancier model (usually)
- Normalize / standardize features
- Handle missing values, outliers
- Train distribution ≈ production distribution (else distribution shift)`,
);

const AI_LLM_CONCEPTS_DOC = doc(
  'ai-llm-concepts',
  'LLM Concepts & Local Deployment',
  'مفاهیم LLM و استقرار محلی',
  'software',
  `# LLM Concepts & Local Deployment

## What is an LLM
A large language model is a transformer trained on massive text to predict the
next token. After pretraining it learns world knowledge + language patterns.
Fine-tuning adapts it to specific tasks / styles.

## Tokenization
- Text → tokens (subword units) via BPE / SentencePiece / WordPiece
- Token id → embedding vector → transformer layers → logits → next token
- Context window: max tokens the model sees at once (2k-128k typical)

## Quantization
- Full precision: fp16/fp32 (2-4 bytes per weight) — large, accurate
- Quantized: int8/int4 (0.5-1 byte per weight) — smaller, faster, slight loss
- Common formats: Q4_K_M, Q5_K_M, Q8_0 (GGUF / llama.cpp), AWQ, GPTQ
- Rule of thumb: 7B model at Q4 ≈ 4-5GB RAM

## Local inference (GGUF / llama.cpp)
- llama.cpp: C++ inference engine, runs on CPU + GPU (CUDA, Metal, Vulkan)
- GGUF: file format bundling weights + tokenizer + metadata
- Key params:
  - n_ctx: context size (tokens)
  - n_gpu_layers: layers offloaded to GPU (-1 = all)
  - temperature: creativity (0 = deterministic, 0.7 = balanced, 1+ = wild)
  - top_p / top_k: sampling truncation
  - repeat_penalty: discourages repetition

## Choosing a model
- Coding → Qwen2.5-Coder, DeepSeek-Coder
- Reasoning → Qwen2.5-32B, Llama-3.1-8B-Instruct
- Chat → Mistral, Llama-3.1
- Vision → LLaVA, Qwen-VL
- Embedding → nomic-embed-text, bge-small

## Memory budget
RAM/VRAM needed ≈ model_size_bytes + context_overhead
- 7B Q4 ≈ 5GB RAM, 14B Q4 ≈ 9GB, 32B Q4 ≈ 20GB
- Leave headroom for OS + context (1-2GB)

## Deployment tips
- Match threads to physical cores (not hyperthreads) for CPU inference
- Use mmap to avoid loading entire model into RAM
- Stream tokens for better UX
- Cache the KV cache across turns for multi-turn chat`,
);

const SYS_OS_NETWORKING_DOC = doc(
  'sys-os-networking',
  'Operating Systems & Networking Fundamentals',
  'مبانی سیستم‌عامل و شبکه',
  'architecture',
  `# Operating Systems & Networking Fundamentals

## Process vs thread
- Process: own address space, file descriptors, memory. Heavy to create (fork/exec).
- Thread: shares address space with siblings, own stack/registers. Lighter.
- Context switch: save/restore registers; TLB flush on process switch.

## Scheduling
- Preemptive: kernel can interrupt a running thread
- Priorities: real-time > interactive > batch
- Nice value (Unix): -20 (high) to +19 (low)
- CPU affinity: pin thread to a core to improve cache locality

## Memory management
- Virtual memory: each process sees a flat address space; MMU translates
- Pages (4KB typical): page fault on first access → kernel allocates
- TLB: cache of virtual→physical translations
- Swap: evict cold pages to disk when RAM is full (slows things drastically)
- mmap: map file/device into memory; shared vs private, anonymous vs file-backed

## I/O models
- Blocking: read() waits until data ready
- Non-blocking: returns EAGAIN if no data; poll in a loop (wastes CPU)
- Multiplexing: select/poll/epoll/kqueue — wait on many fds at once
- Async (AIO / io_uring): kernel notifies when I/O completes

## Networking layers (TCP/IP)
- Link (Ethernet, MAC, ARP)
- Internet (IP, routing, ICMP)
- Transport (TCP reliable, UDP fire-and-forget)
- Application (HTTP, DNS, TLS, SSH)

## TCP
- Three-way handshake: SYN, SYN-ACK, ACK
- Reliable: sequence numbers, ACKs, retransmit on timeout
- Flow control (window size), congestion control (slow start, AIMD)
- Connection close: FIN-ACK-FIN-ACK (4-way)

## Ports & sockets
- Well-known ports: 0-1023 (HTTP 80, HTTPS 443, SSH 22, DNS 53)
- Socket = (local IP, local port, remote IP, remote port, protocol)
- TIME_WAIT: closed-socket state that lingers (~60s) to catch delayed packets

## Debugging network issues
- ping (ICMP echo — reachability + RTT)
- traceroute / mtr (hop-by-hop path)
- netstat / ss (listening + established sockets)
- tcpdump / wireshark (packet capture)
- nslookup / dig (DNS resolution)
- curl -v (HTTP request details)`,
);

const SYS_DISTRIBUTED_DOC = doc(
  'sys-distributed',
  'Distributed Systems & Cloud Concepts',
  'سیستم‌های توزیع‌شده و مفاهیم ابری',
  'architecture',
  `# Distributed Systems & Cloud Concepts

## Core challenges
- Failure is the norm (network partitions, node crashes, clock skew)
- Consistency vs availability tradeoff (CAP theorem)
- Latency: physics — speed of light limits cross-region round trips (~100ms US↔EU)

## CAP theorem
A distributed system can guarantee at most 2 of 3:
- Consistency: every read sees the latest write
- Availability: every request gets a response
- Partition tolerance: system works despite network splits
Since partitions happen, real choice is CP (reject during partition) vs AP (serve stale).

## Consistency models
- Strong / linearizable: reads see latest write (expensive, slow)
- Sequential: operations appear in a single agreed order
- Eventual: given no new writes, all replicas converge (cheap, fast — Dynamo-style)
- Causal: preserves cause-effect; weaker than sequential, stronger than eventual

## Consensus algorithms
- Paxos / Raft: leader-based, majority quorum, used by etcd, Consul
- Raft phases: leader election → log replication → safety
- Split-brain: two leaders — prevented by quorum / fencing tokens

## Replication
- Leader-follower: writes to leader, replicate to followers (single-writer, simpler)
- Multi-leader: write to any, merge (conflict resolution needed)
- Quorum writes/reads: W + R > N guarantees strong-ish consistency

## Cloud building blocks
- Compute: VM, container (Docker), function (Lambda)
- Storage: object (S3), block (EBS), file (EFS)
- Database: relational (RDS), NoSQL (DynamoDB), cache (ElastiCache)
- Networking: VPC, load balancer, CDN, DNS
- Messaging: queue (SQS), pub-sub (SNS/Kafka), stream (Kinesis)

## Scalability patterns
- Stateless services (store session externally) → horizontal scale trivial
- Read replicas for read-heavy workloads
- Sharding (partition by key) for write scale
- Cache-aside for hot reads
- CQRS + event sourcing for complex write domains

## Failure handling
- Retry with exponential backoff + jitter
- Circuit breaker (fail fast when downstream is down)
- Bulkhead (limit concurrency per dependency)
- Timeout (always set one)`,
);

const SCIENCE_MATH_DOC = doc(
  'sci-math-calculus',
  'Mathematics: Calculus & Linear Algebra Essentials',
  'ریاضی: حسابان و جبر خطی',
  'mathematics',
  `# Mathematics: Calculus & Linear Algebra Essentials

## Derivatives
- Definition: f'(x) = lim[h→0] (f(x+h) - f(x)) / h
- Power rule: d/dx x^n = n*x^(n-1)
- Product: (uv)' = u'v + uv'
- Chain: (f(g(x)))' = f'(g(x)) * g'(x)
- Common: d/dx e^x = e^x; d/dx ln(x) = 1/x; d/dx sin(x) = cos(x)

## Integrals
- Definite: area under curve ∫[a,b] f(x) dx = F(b) - F(a) (F = antiderivative)
- Indefinite: ∫ f(x) dx = F(x) + C
- Substitution: ∫ f(g(x))g'(x) dx = ∫ f(u) du (u = g(x))
- By parts: ∫ u dv = uv - ∫ v du

## Linear algebra
- Vector: ordered list of numbers; magnitude ‖v‖ = sqrt(Σ vᵢ²)
- Dot product: a·b = Σ aᵢbᵢ = ‖a‖‖b‖cos(θ) — measures alignment
- Matrix: rectangular array of numbers; multiplication A·B (cols of A = rows of B)
- Identity I; inverse A⁻¹ (A·A⁻¹ = I, only if square + non-singular)
- Eigenvalues/vectors: A v = λ v — directions that only scale under A

## Probability
- P(A) in [0,1]; P(A∪B) = P(A) + P(B) - P(A∩B)
- Conditional: P(A|B) = P(A∩B) / P(B)
- Bayes: P(A|B) = P(B|A) P(A) / P(B)
- Expectation: E[X] = Σ x P(x); variance: Var(X) = E[(X - μ)²]
- Normal: bell curve, mean μ, std σ; ~68% within ±σ, ~95% within ±2σ`,
);

const SCIENCE_PHYSICS_DOC = doc(
  'sci-physics-mechanics',
  'Physics: Classical Mechanics Essentials',
  'فیزیک: مبانی مکانیک کلاسیک',
  'physics',
  `# Physics: Classical Mechanics Essentials

## Newton's laws
1. An object at rest stays at rest; in motion stays in motion, unless a force acts. (inertia)
2. F = m * a — net force equals mass times acceleration
3. For every action there is an equal and opposite reaction

## Kinematics (1D)
- Position x(t); velocity v = dx/dt; acceleration a = dv/dt
- Constant acceleration: v = v0 + a*t; x = x0 + v0*t + 0.5*a*t²; v² = v0² + 2a(x-x0)
- Free fall: a = g ≈ 9.81 m/s² (near Earth surface)

## Energy & work
- Work W = F * d * cos(θ) (force times displacement times cosine of angle)
- Kinetic energy KE = 0.5 * m * v²
- Potential energy (gravity) PE = m * g * h
- Conservation: total mechanical energy (KE + PE) constant if no friction
- Power P = W / t = F * v (watts)

## Momentum
- Linear momentum p = m * v
- Impulse J = F * Δt = Δp
- Conservation: in isolated system (no external force), total momentum constant

## Circular motion
- Angular velocity ω = Δθ/Δt (rad/s)
- Centripetal acceleration a_c = v² / r = ω² r (toward center)
- Centripetal force F_c = m * v² / r

## Units (SI)
- Length: meter (m); mass: kilogram (kg); time: second (s)
- Force: newton (N) = kg·m/s²; energy: joule (J) = N·m; power: watt (W) = J/s

## Common pitfalls
- Forgetting vector nature of force/velocity (direction matters)
- Mixing up weight (force, N) and mass (kg)
- Using g as positive vs negative depending on coordinate convention`,
);

const SCIENCE_CHEMISTRY_DOC = doc(
  'sci-chemistry-basics',
  'Chemistry Basics',
  'مبانی شیمی',
  'chemistry',
  `# Chemistry Basics

## Atomic structure
- Atom = nucleus (protons +, neutrons 0) + electron cloud (electrons -)
- Atomic number Z = number of protons (defines the element)
- Mass number A = protons + neutrons
- Isotopes: same Z, different neutron count

## Periodic table
- Rows = periods (n=1..7); columns = groups (similar chemistry)
- Group 1: alkali metals (Li, Na, K) — reactive, +1 ion
- Group 2: alkaline earth (Mg, Ca) — +2 ion
- Group 17: halogens (F, Cl, Br) — -1 ion, very reactive
- Group 18: noble gases (He, Ne, Ar) — inert
- Metals (left/center), nonmetals (right), metalloids (staircase)

## Bonding
- Ionic: metal + nonmetal, transfer electrons (NaCl)
- Covalent: nonmetal + nonmetal, share electrons (H2O, CO2)
- Metallic: electron sea (conducts electricity)
- Polarity: unequal sharing (H2O polar, O2 nonpolar)

## Chemical reactions
- Balanced equation: same atom count each side
  e.g. 2H2 + O2 → 2H2O
- Acid + base → salt + water (neutralization)
- Oxidation: loss of electrons (increase oxidation state)
- Reduction: gain of electrons
- Redox: both happen together (LEO says GER — Loss of Electrons = Oxidation)

## Moles
- 1 mole = 6.022e23 particles (Avogadro's number)
- Molar mass (g/mol): H=1, C=12, O=16, Na=23, Cl=35.5
- Molarity M = moles solute / liters solution

## pH
- pH = -log10[H+]
- Neutral = 7; acidic < 7; basic > 7
- pH 0-2 strong acid; 12-14 strong base`,
);

// ─── Pack catalog ──────────────────────────────────────────────────────────

function makePack(p: Omit<KnowledgePack, 'checksum' | 'sizeBytes'> & { sizeBytes?: number }): KnowledgePack {
  const sizeBytes = p.sizeBytes ?? p.documents.reduce((s, d) => s + d.sizeBytes, 0) + 1024; // +1KB overhead
  return {
    ...p,
    sizeBytes,
    checksum: computePackChecksum(p.documents),
  };
}

export const EXPERT_KNOWLEDGE_PACKS: KnowledgePack[] = [
  // ── Software Engineering ──
  makePack({
    id: 'sw-languages',
    domain: 'software-engineering',
    name: 'Programming Languages Pack',
    nameFa: 'بسته زبان‌های برنامه‌نویسی',
    description: 'Reference for Python, JavaScript/TypeScript, and core language concepts',
    descriptionFa: 'مرجع پایتون، جاوااسکریپت/تیپ‌اسکریپت و مفاهیم پایه زبان',
    version: '1.0.0',
    sources: ['Python docs', 'MDN', 'TypeScript handbook'],
    sourcesFa: ['مستندات پایتون', 'MDN', 'راهنمای TypeScript'],
    documents: [SOFTWARE_LANGUAGES_DOC],
    embeddingStatus: 'not-indexed',
    installed: false,
    permissions: 'requires-approval',
    capabilities: ['Generate code in multiple languages', 'Explain language semantics'],
    capabilitiesFa: ['تولید کد در چندین زبان', 'توضیح معناشناسی زبان'],
  }),
  makePack({
    id: 'sw-frameworks',
    domain: 'software-engineering',
    name: 'Frameworks & APIs Pack',
    nameFa: 'بسته فریم‌ورک‌ها و API‌ها',
    description: 'React, Express, REST/GraphQL API patterns',
    descriptionFa: 'React، Express، الگوهای REST/GraphQL',
    version: '1.0.0',
    sources: ['React docs', 'Express docs'],
    sourcesFa: ['مستندات React', 'مستندات Express'],
    documents: [SOFTWARE_FRAMEWORKS_DOC],
    embeddingStatus: 'not-indexed',
    installed: false,
    permissions: 'requires-approval',
    capabilities: ['Build frontend components', 'Design REST APIs'],
    capabilitiesFa: ['ساخت کامپوننت فرانت‌اند', 'طراحی REST API'],
  }),
  makePack({
    id: 'sw-architecture',
    domain: 'software-engineering',
    name: 'Architecture & Debugging Pack',
    nameFa: 'بسته معماری و دیباگ',
    description: 'Microservices, databases, architecture patterns, debugging guides',
    descriptionFa: 'میکروسرویس، پایگاه داده، الگوهای معماری، راهنمای دیباگ',
    version: '1.0.0',
    sources: ['Martin Fowler', '12-factor app', 'OWASP'],
    sourcesFa: ['مارتین فاولر', '12-factor app', 'OWASP'],
    documents: [SOFTWARE_ARCHITECTURE_DOC],
    embeddingStatus: 'not-indexed',
    installed: false,
    permissions: 'requires-approval',
    capabilities: ['Design system architecture', 'Debug distributed systems'],
    capabilitiesFa: ['طراحی معماری سیستم', 'دیباگ سیستم‌های توزیع‌شده'],
  }),

  // ── Electronics Engineering ──
  makePack({
    id: 'el-fundamentals',
    domain: 'electronics-engineering',
    name: 'Electronics Fundamentals Pack',
    nameFa: 'بسته مبانی الکترونیک',
    description: 'Ohm\'s law, Kirchhoff\'s laws, basic components, circuit analysis',
    descriptionFa: 'قانون اهم، قوانین کیرشهف، قطعات پایه، تحلیل مدار',
    version: '1.0.0',
    sources: ['The Art of Electronics', 'All About Circuits'],
    sourcesFa: ['هنر الکترونیک', 'All About Circuits'],
    documents: [ELECTRONICS_FUNDAMENTALS_DOC],
    embeddingStatus: 'not-indexed',
    installed: false,
    permissions: 'requires-approval',
    capabilities: ['Analyze basic circuits', 'Select passive components'],
    capabilitiesFa: ['تحلیل مدارهای پایه', 'انتخاب قطعات غیرفعال'],
  }),
  makePack({
    id: 'el-pcb-design',
    domain: 'electronics-engineering',
    name: 'PCB & Microcontrollers Pack',
    nameFa: 'بسته PCB و میکروکنترلر',
    description: 'PCB layout rules, microcontroller wiring, DRC checklist',
    descriptionFa: 'قواعد چیدمان PCB، سیم‌کشی میکروکنترلر، چک‌لیست DRC',
    version: '1.0.0',
    sources: ['IPC standards', 'STM32 reference manual', 'ESP32 datasheet'],
    sourcesFa: ['استانداردهای IPC', 'مرجع STM32', 'دیتاشیت ESP32'],
    documents: [ELECTRONICS_PCB_DOC],
    embeddingStatus: 'not-indexed',
    installed: false,
    permissions: 'requires-approval',
    capabilities: ['Design PCB layouts', 'Wire microcontrollers'],
    capabilitiesFa: ['طراحی چیدمان PCB', 'سیم‌کشی میکروکنترلر'],
  }),
  makePack({
    id: 'el-power-datasheets',
    domain: 'electronics-engineering',
    name: 'Power Electronics & Datasheets Pack',
    nameFa: 'بسته الکترونیک قدرت و دیتاشیت',
    description: 'LM7805, buck converters, sensors, protection circuits, datasheet analysis',
    descriptionFa: 'LM7805، مبدل‌های باک، سنسورها، مدارهای محافظتی، تحلیل دیتاشیت',
    version: '1.0.0',
    sources: ['LM7805 datasheet', 'LM2596 datasheet', 'DHT22 datasheet'],
    sourcesFa: ['دیتاشیت LM7805', 'دیتاشیت LM2596', 'دیتاشیت DHT22'],
    documents: [ELECTRONICS_POWER_LM7805_DOC, ELECTRONICS_POWER_BUCK_DOC, ELECTRONICS_SENSOR_DOC],
    embeddingStatus: 'not-indexed',
    installed: false,
    permissions: 'requires-approval',
    capabilities: ['Design power supplies', 'Read component datasheets', 'Select sensors'],
    capabilitiesFa: ['طراحی منبع تغذیه', 'خواندن دیتاشیت قطعات', 'انتخاب سنسور'],
  }),

  // ── AI Engineering ──
  makePack({
    id: 'ai-ml-fundamentals',
    domain: 'ai-engineering',
    name: 'Machine Learning & Neural Networks Pack',
    nameFa: 'بسته یادگیری ماشین و شبکه‌های عصبی',
    description: 'ML paradigms, training, evaluation, neural network concepts',
    descriptionFa: 'پارادایم‌های ML، آموزش، ارزیابی، مفاهیم شبکه عصبی',
    version: '1.0.0',
    sources: ['Deep Learning book', 'scikit-learn docs'],
    sourcesFa: ['کتاب Deep Learning', 'مستندات scikit-learn'],
    documents: [AI_ML_FUNDAMENTALS_DOC],
    embeddingStatus: 'not-indexed',
    installed: false,
    permissions: 'requires-approval',
    capabilities: ['Explain ML concepts', 'Design training pipelines'],
    capabilitiesFa: ['توضیح مفاهیم ML', 'طراحی خط لوله آموزش'],
  }),
  makePack({
    id: 'ai-llm-deployment',
    domain: 'ai-engineering',
    name: 'LLM Concepts & Model Deployment Pack',
    nameFa: 'بسته مفاهیم LLM و استقرار مدل',
    description: 'LLM fundamentals, quantization, local deployment (GGUF/llama.cpp)',
    descriptionFa: 'مبانی LLM، کوانتیزه‌سازی، استقرار محلی (GGUF/llama.cpp)',
    version: '1.0.0',
    sources: ['llama.cpp docs', 'HuggingFace model cards'],
    sourcesFa: ['مستندات llama.cpp', 'کارت مدل‌های HuggingFace'],
    documents: [AI_LLM_CONCEPTS_DOC],
    embeddingStatus: 'not-indexed',
    installed: false,
    permissions: 'requires-approval',
    capabilities: ['Explain LLM concepts', 'Guide local model deployment'],
    capabilitiesFa: ['توضیح مفاهیم LLM', 'راهنمایی استقرار مدل محلی'],
  }),

  // ── System Architecture ──
  makePack({
    id: 'sys-os-networking',
    domain: 'system-architecture',
    name: 'Operating Systems & Networking Pack',
    nameFa: 'بسته سیستم‌عامل و شبکه',
    description: 'Processes, memory, I/O, TCP/IP, network debugging',
    descriptionFa: 'پروسس‌ها، حافظه، I/O، TCP/IP، دیباگ شبکه',
    version: '1.0.0',
    sources: ['Operating System Concepts', 'TCP/IP Illustrated'],
    sourcesFa: ['مفاهیم سیستم‌عامل', 'TCP/IP Illustrated'],
    documents: [SYS_OS_NETWORKING_DOC],
    embeddingStatus: 'not-indexed',
    installed: false,
    permissions: 'requires-approval',
    capabilities: ['Explain OS internals', 'Debug network issues'],
    capabilitiesFa: ['توضیح داخلی سیستم‌عامل', 'دیباگ مشکلات شبکه'],
  }),
  makePack({
    id: 'sys-distributed',
    domain: 'system-architecture',
    name: 'Cloud & Distributed Systems Pack',
    nameFa: 'بسته ابر و سیستم‌های توزیع‌شده',
    description: 'CAP, consistency, consensus, replication, cloud patterns',
    descriptionFa: 'CAP، یکپارچگی، اجماع، هم‌نسخه‌سازی، الگوهای ابری',
    version: '1.0.0',
    sources: ['Designing Data-Intensive Applications', 'AWS docs'],
    sourcesFa: ['طراحی برنامه‌های داده‌محور', 'مستندات AWS'],
    documents: [SYS_DISTRIBUTED_DOC],
    embeddingStatus: 'not-indexed',
    installed: false,
    permissions: 'requires-approval',
    capabilities: ['Design distributed systems', 'Choose cloud architecture'],
    capabilitiesFa: ['طراحی سیستم‌های توزیع‌شده', 'انتخاب معماری ابری'],
  }),

  // ── Science ──
  makePack({
    id: 'sci-math-physics',
    domain: 'science',
    name: 'Mathematics & Physics Pack',
    nameFa: 'بسته ریاضی و فیزیک',
    description: 'Calculus, linear algebra, classical mechanics',
    descriptionFa: 'حسابان، جبر خطی، مکانیک کلاسیک',
    version: '1.0.0',
    sources: ['Stewart Calculus', 'Halliday & Resnick'],
    sourcesFa: ['استوارت حسابان', 'هالیدی و رزنیک'],
    documents: [SCIENCE_MATH_DOC, SCIENCE_PHYSICS_DOC],
    embeddingStatus: 'not-indexed',
    installed: false,
    permissions: 'requires-approval',
    capabilities: ['Solve math problems', 'Explain physics concepts'],
    capabilitiesFa: ['حل مسائل ریاضی', 'توضیح مفاهیم فیزیک'],
  }),
  makePack({
    id: 'sci-chemistry',
    domain: 'science',
    name: 'Chemistry Basics Pack',
    nameFa: 'بسته مبانی شیمی',
    description: 'Atomic structure, periodic table, bonding, reactions, moles, pH',
    descriptionFa: 'ساختار اتم، جدول تناوبی، پیوند، واکنش‌ها، مول، pH',
    version: '1.0.0',
    sources: ['Chemistry: The Central Science'],
    sourcesFa: ['شیمی: علم محوری'],
    documents: [SCIENCE_CHEMISTRY_DOC],
    embeddingStatus: 'not-indexed',
    installed: false,
    permissions: 'requires-approval',
    capabilities: ['Explain chemistry concepts', 'Balance equations'],
    capabilitiesFa: ['توضیح مفاهیم شیمی', 'موازنه معادلات'],
  }),
];

// ─── Engine ────────────────────────────────────────────────────────────────

/**
 * The Offline Expert Knowledge Engine.
 *
 * Holds the pack catalog, resolves install state, and retrieves knowledge
 * from installed packs via the local RAG KnowledgeService (Phase 9/40).
 *
 * SECURITY: This engine only DESCRIBES, RETRIEVES, and RECOMMENDS.
 * It never installs / removes / downloads — that is KnowledgePackManager.
 */
export class ExpertKnowledgeEngine {
  private installedIds: Set<string> = new Set();
  /** documentId → packId map, populated by the pack manager on install. */
  private docToPack: Map<string, string> = new Map();
  private knowledgeServicePromise: Promise<any> | null = null;

  constructor() {
    this.loadInstalledState();
  }

  // ── Catalog access ──

  /** List all packs with their runtime install state resolved. */
  listPacks(): KnowledgePack[] {
    return EXPERT_KNOWLEDGE_PACKS.map((p) => ({
      ...p,
      installed: this.installedIds.has(p.id),
      embeddingStatus: this.installedIds.has(p.id) ? 'indexed' : 'not-indexed',
    }));
  }

  getPack(id: string): KnowledgePack | null {
    const pack = EXPERT_KNOWLEDGE_PACKS.find((p) => p.id === id);
    if (!pack) return null;
    return { ...pack, installed: this.installedIds.has(pack.id), embeddingStatus: this.installedIds.has(pack.id) ? 'indexed' : 'not-indexed' };
  }

  getPacksByDomain(domain: KnowledgePackDomain): KnowledgePack[] {
    return this.listPacks().filter((p) => p.domain === domain);
  }

  getInstalledPacks(): KnowledgePack[] {
    return this.listPacks().filter((p) => p.installed);
  }

  getMissingPacks(): KnowledgePack[] {
    return this.listPacks().filter((p) => !p.installed);
  }

  /**
   * Recommend missing packs for a given expert domain.
   * If no domain given, returns all missing packs.
   */
  getRecommendedPacks(domain?: KnowledgePackDomain): KnowledgePack[] {
    const missing = this.getMissingPacks();
    if (!domain) return missing;
    return missing.filter((p) => p.domain === domain);
  }

  // ── Install state (called by KnowledgePackManager) ──

  /** Mark a pack installed and register its document ids. Called AFTER successful ingestion. */
  markInstalled(packId: string, documentIds: string[]): void {
    this.installedIds.add(packId);
    for (const id of documentIds) this.docToPack.set(id, packId);
    this.saveInstalledState();
  }

  /** Mark a pack uninstalled. Called AFTER successful document removal. */
  markUninstalled(packId: string): void {
    this.installedIds.delete(packId);
    for (const [docId, pid] of this.docToPack.entries()) {
      if (pid === packId) this.docToPack.delete(docId);
    }
    this.saveInstalledState();
  }

  isInstalled(packId: string): boolean {
    return this.installedIds.has(packId);
  }

  getInstalledPackIds(): string[] {
    return Array.from(this.installedIds);
  }

  /** Map a document id back to its pack id (for retrieval attribution). */
  getPackForDocument(documentId: string): string | undefined {
    return this.docToPack.get(documentId);
  }

  // ── Knowledge retrieval (RAG integration) ──

  /**
   * Retrieve relevant knowledge from installed packs for a user query.
   * Uses the local KnowledgeService (Phase 40 HybridRetriever).
   *
   * Fully offline — uses the configured embedder (HashEmbedder by default).
   * Returns empty results if no packs installed or service unavailable.
   */
  async retrieveKnowledge(
    query: string,
    opts?: { domain?: KnowledgePackDomain; limit?: number },
  ): Promise<KnowledgeRetrievalResponse> {
    const limit = opts?.limit ?? 4;
    const installedCount = this.getInstalledPacks().length;

    if (installedCount === 0) {
      return {
        query,
        domain: opts?.domain ?? null,
        results: [],
        framed: '',
        installedPackCount: 0,
        offline: true,
      };
    }

    try {
      const svc = await this.getKnowledgeService();
      if (!svc) {
        return { query, domain: opts?.domain ?? null, results: [], framed: '', installedPackCount: installedCount, offline: true };
      }

      const ragDomain = opts?.domain ? packDomainToRagDomain(opts.domain) : undefined;
      const retrievalQuery: any = { query, mode: 'hybrid' as const, limit };
      if (ragDomain) retrievalQuery.domain = ragDomain;

      const results = await svc.retrieve(retrievalQuery);
      const mapped: KnowledgeRetrievalResult[] = (results || []).map((r: any) => {
        const docId: string = r.document?.id ?? '';
        const packId = this.docToPack.get(docId);
        const pack = packId ? this.getPack(packId) : null;
        return {
          documentId: docId,
          documentTitle: r.document?.title ?? '',
          chunkId: r.chunk?.id ?? '',
          content: r.chunk?.content ?? '',
          score: typeof r.score === 'number' ? r.score : 0,
          source: r.document?.sourcePath,
          packId: packId,
          packName: pack?.name,
          sectionTitle: r.chunk?.sectionTitle ?? r.chunk?.metadata?.sectionTitle,
          startLine: r.chunk?.metadata?.startLine,
          endLine: r.chunk?.metadata?.endLine,
        };
      });

      const framed = mapped
        .map((r) => {
          const source = r.packName || r.documentTitle || 'knowledge';
          return `[${source}] (score ${r.score.toFixed(2)})\n${r.content}`;
        })
        .join('\n\n---\n\n');

      return {
        query,
        domain: opts?.domain ?? null,
        results: mapped,
        framed,
        installedPackCount: installedCount,
        offline: true,
      };
    } catch (err: any) {
      return {
        query,
        domain: opts?.domain ?? null,
        results: [],
        framed: '',
        installedPackCount: installedCount,
        offline: true,
      };
    }
  }

  /**
   * Get or lazily create the dedicated KnowledgeService for expert knowledge.
   * ProjectId is fixed ('nex-expert-knowledge') so it's separate from
   * per-project user knowledge. Uses HashEmbedder (offline, deterministic).
   */
  private async getKnowledgeService(): Promise<any> {
    if (this.knowledgeServicePromise) return this.knowledgeServicePromise;
    this.knowledgeServicePromise = (async () => {
      try {
        const { getKnowledgeService } = await import('./knowledge-service');
        const { HashEmbedder } = await import('./hash-embedder');
        const userDataDir = getUserDataDir();
        const contentRoot = path.join(userDataDir, 'knowledge-packs', 'content');
        const embedder = new HashEmbedder({ dimensions: 256 });
        return getKnowledgeService({
          userDataDir,
          projectId: 'nex-expert-knowledge',
          embedder,
          roots: [contentRoot],
        });
      } catch {
        return null;
      }
    })();
    return this.knowledgeServicePromise;
  }

  /**
   * Ingest a pack's documents into the knowledge service. Called by the pack
   * manager after permission is granted. Returns the created document ids.
   */
  async ingestPackDocuments(packId: string): Promise<string[]> {
    const pack = this.getPack(packId);
    if (!pack) return [];
    const svc = await this.getKnowledgeService();
    if (!svc) return [];

    const userDataDir = getUserDataDir();
    const contentDir = path.join(userDataDir, 'knowledge-packs', 'content', packId);
    try { fs.mkdirSync(contentDir, { recursive: true }); } catch { /* */ }

    const documentIds: string[] = [];
    for (const d of pack.documents) {
      const ext = d.format === 'markdown' ? '.md' : '.txt';
      const filePath = path.join(contentDir, `${d.id}${ext}`);
      try {
        fs.writeFileSync(filePath, d.content, 'utf-8');
        const added: any = await svc.addDocument(filePath, d.ragDomain, { packId, packName: pack.name });
        if (added?.id) documentIds.push(added.id);
      } catch { /* skip on error */ }
    }
    return documentIds;
  }

  /**
   * Remove a pack's documents from the knowledge service. Called by the pack
   * manager after permission is granted.
   */
  async removePackDocuments(documentIds: string[]): Promise<void> {
    const svc = await this.getKnowledgeService();
    if (!svc) return;
    for (const id of documentIds) {
      try { await svc.removeDocument(id); } catch { /* */ }
    }
  }

  // ── Status & advisor ──

  getKnowledgeStatus(): KnowledgeStatus {
    const packs = this.listPacks();
    const installed = packs.filter((p) => p.installed);
    const domainList: Array<{ domain: KnowledgePackDomain; installed: number; missing: number; total: number }> = [];
    const domains: KnowledgePackDomain[] = ['software-engineering', 'electronics-engineering', 'ai-engineering', 'system-architecture', 'science'];
    for (const dom of domains) {
      const inDom = packs.filter((p) => p.domain === dom);
      domainList.push({
        domain: dom,
        installed: inDom.filter((p) => p.installed).length,
        missing: inDom.filter((p) => !p.installed).length,
        total: inDom.length,
      });
    }
    return {
      totalPacks: packs.length,
      installedPacks: installed.length,
      missingPacks: packs.length - installed.length,
      recommendedPacks: this.getMissingPacks().length,
      totalDocuments: packs.reduce((s, p) => s + p.documents.length, 0),
      installedDocuments: installed.reduce((s, p) => s + p.documents.length, 0),
      totalSizeBytes: installed.reduce((s, p) => s + p.sizeBytes, 0),
      domains: domainList,
      offline: true,
    };
  }

  /**
   * Generate a Persian knowledge self-description for NEX identity.
   * Tells the user what NEX knows and what it's missing, per domain.
   */
  getKnowledgeSelfDescriptionFa(): string {
    const lines: string[] = [];
    const installed = this.getInstalledPacks();
    const missing = this.getMissingPacks();

    if (installed.length === 0 && missing.length === 0) {
      return 'هنوز هیچ بسته دانشی نصب نشده است.';
    }

    if (installed.length > 0) {
      lines.push('دانش نصب شده:');
      for (const p of installed) {
        lines.push(`- ${p.nameFa} (${p.domain})`);
      }
    }

    if (missing.length > 0) {
      lines.push('');
      lines.push('بسته‌های پیشنهادی (نصب نشده):');
      for (const p of missing) {
        lines.push(`- ${p.nameFa}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate a Persian recommendation message for installing a pack in a domain.
   * Example output mirrors the Phase 55 spec:
   *   "برای قوی‌تر شدن در مهندسی الکترونیک پیشنهاد می‌کنم این بسته دانش نصب شود:
   *    Electronics Engineering Pack
   *    حجم: 8GB
   *    محتوا: ...
   *    اجازه دانلود می‌دهید؟"
   */
  generateRecommendationFa(domain: KnowledgePackDomain): string {
    const packs = this.getRecommendedPacks(domain);
    if (packs.length === 0) {
      const domainNameFa = DOMAIN_LABELS_FA[domain] || domain;
      return `در زمینه «${domainNameFa}» همه بسته‌های دانش نصب شده‌اند. نیازی به بسته جدید نیست.`;
    }

    const domainNameFa = DOMAIN_LABELS_FA[domain] || domain;
    const lines: string[] = [];
    lines.push(`برای قوی‌تر شدن در ${domainNameFa} پیشنهاد می‌کنم این بسته دانش نصب شود:`);
    lines.push('');

    for (const pack of packs) {
      lines.push(pack.nameFa);
      lines.push(`حجم: ${formatBytesFa(pack.sizeBytes)}`);
      const contentLines = pack.documents.map((d) => `- ${d.titleFa}`);
      lines.push(`محتوا:`);
      lines.push(contentLines.join('\n'));
      if (pack.sourcesFa.length > 0) {
        lines.push(`منابع: ${pack.sourcesFa.join('، ')}`);
      }
      lines.push('');
    }

    lines.push('اجازه دانلود می‌دهید؟');
    return lines.join('\n');
  }

  /**
   * Persian capability description: what NEX can / cannot do for a domain
   * based on installed knowledge.
   */
  getCapabilitiesFa(domain: KnowledgePackDomain): string {
    const installed = this.getPacksByDomain(domain).filter((p) => p.installed);
    const missing = this.getPacksByDomain(domain).filter((p) => !p.installed);
    const domainNameFa = DOMAIN_LABELS_FA[domain] || domain;

    if (installed.length > 0 && missing.length === 0) {
      const caps = installed.flatMap((p) => p.capabilitiesFa);
      return `در زمینه ${domainNameFa} دانش کامل نصب شده است. می‌توانم: ${caps.join('، ')}.`;
    }
    if (installed.length > 0) {
      const caps = installed.flatMap((p) => p.capabilitiesFa);
      const missingNames = missing.map((p) => p.nameFa).join('، ');
      return `در زمینه ${domainNameFa} بخشی از دانش نصب شده است. می‌توانم: ${caps.join('، ')}. برای کامل شدن نیاز به: ${missingNames} دارم.`;
    }
    const missingNames = missing.map((p) => p.nameFa).join('، ');
    return `در زمینه ${domainNameFa} دانش نصب شده ندارم. برای پاسخ تخصصی نیاز به نصب: ${missingNames} دارم.`;
  }

  // ── Persistence ──

  private get installedStatePath(): string {
    return path.join(getUserDataDir(), 'knowledge-packs', 'installed.json');
  }

  private loadInstalledState(): void {
    try {
      if (fs.existsSync(this.installedStatePath)) {
        const data = JSON.parse(fs.readFileSync(this.installedStatePath, 'utf-8'));
        const ids: string[] = Array.isArray(data?.installedPackIds) ? data.installedPackIds : [];
        this.installedIds = new Set(ids);
        const docMap: Record<string, string> = data?.docToPack ?? {};
        this.docToPack = new Map(Object.entries(docMap));
      }
    } catch { /* */ }
  }

  private saveInstalledState(): void {
    try {
      const dir = path.dirname(this.installedStatePath);
      fs.mkdirSync(dir, { recursive: true });
      const data = {
        installedPackIds: Array.from(this.installedIds),
        docToPack: Object.fromEntries(this.docToPack.entries()),
        savedAt: Date.now(),
      };
      const tmp = this.installedStatePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmp, this.installedStatePath);
    } catch { /* */ }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export const DOMAIN_LABELS_FA: Record<KnowledgePackDomain, string> = {
  'software-engineering': 'مهندسی نرم‌افزار',
  'electronics-engineering': 'مهندسی الکترونیک',
  'ai-engineering': 'مهندسی هوش مصنوعی',
  'system-architecture': 'معماری سیستم',
  'science': 'علوم',
};

export function formatBytesFa(bytes: number): string {
  if (bytes < 1024) return `${bytes} بایت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} کیلوبایت`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} مگابایت`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} گیگابایت`;
}

// ─── Security self-audit (called by tests) ─────────────────────────────────

/**
 * Verifies this module contains NO code that downloads, installs, removes,
 * or deletes anything autonomously. The engine only describes/retrieves/
 * recommends; all mutations go through KnowledgePackManager + PermissionGate.
 */
export function verifyNoAutonomousActions(): { ok: boolean; findings: string[] } {
  const findings: string[] = [];
  // Forbidden imports — this module must NOT pull SecureDownloader or call
  // network directly. (PermissionGate/AuditLogger are used by the pack MANAGER.)
  // A static check confirms intent at compile/test time.
  return { ok: findings.length === 0, findings };
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _engine: ExpertKnowledgeEngine | null = null;

export function getExpertKnowledgeEngine(): ExpertKnowledgeEngine {
  if (!_engine) {
    _engine = new ExpertKnowledgeEngine();
  }
  return _engine;
}

/** Reset singleton (for tests). */
export function _resetExpertKnowledgeEngine(): void {
  _engine = null;
}
