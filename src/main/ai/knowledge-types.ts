/**
 * NEX AI — Knowledge / RAG Types (Interface-only, Phase 7+)
 *
 * Defines the interfaces for the future Knowledge Base and RAG system.
 * No implementation yet — these are scaffolds so Agent Core can be designed
 * against them without needing a rewrite when RAG is added.
 *
 * Planned modules (Phase 19+):
 *   knowledge/document-parser.ts   — extract text from PDF, HTML, MD, code
 *   knowledge/chunker.ts           — split documents into searchable chunks
 *   knowledge/embedder.ts          — embed chunks via local embedding model
 *   knowledge/vector-db.ts         — local vector database (e.g. sqlite-vec)
 *   knowledge/keyword-search.ts   — full-text search (FTS5 or mini-search)
 *   knowledge/reranker.ts          — rerank candidates with local reranker model
 *   knowledge/citation.ts          — track sources for cited answers
 *   knowledge/versioning.ts        — versioned knowledge snapshots
 *
 * Specialized domains (Phase 20+):
 *   knowledge/domains/electronics.ts   — datasheets, application notes, components
 *   knowledge/domains/architecture.ts  — civil, structural, MEP, building codes
 *   knowledge/domains/embedded.ts      — MCU, MPU, sensor datasheets
 */

// ─── Document Types ─────────────────────────────────────────────────────────

export type DocumentFormat =
  | 'pdf' | 'html' | 'markdown' | 'plaintext'
  | 'source-code' | 'json' | 'yaml' | 'csv'
  | 'image' | 'office-doc';

export interface KnowledgeDocument {
  id: string;
  title: string;
  format: DocumentFormat;
  sourcePath?: string;        // local file path if imported from disk
  sourceUrl?: string;          // remote URL if downloaded
  domain?: KnowledgeDomain;
  version: string;
  createdAt: number;
  updatedAt: number;
  metadata?: {
    author?: string;
    publisher?: string;
    language?: string;
    pageCount?: number;
    sizeBytes?: number;
    checksum?: string;
  };
}

export type KnowledgeDomain =
  | 'general'
  | 'electronics'         // datasheets, app notes, IC specs
  | 'embedded'            // MCU, MPU, firmware
  | 'architecture'        // civil/structural/engineering
  | 'mechanical'
  | 'electrical'
  | 'software'            // code, docs, API references
  | 'physics'
  | 'mathematics'
  | 'chemistry'
  | 'materials-science'
  | 'standards'           // ISO, IEC, IEEE, building codes
  | 'user-imported';

// ─── Chunk Types ────────────────────────────────────────────────────────────

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  index: number;             // position within document
  startOffset?: number;     // char offset in original doc
  endOffset?: number;
  pageNumber?: number;       // for PDFs
  sectionTitle?: string;
  metadata?: Record<string, any>;
  // Populated after embedding
  embedding?: number[];
}

// ─── Search / Retrieval Types ───────────────────────────────────────────────

export type SearchMode = 'keyword' | 'semantic' | 'hybrid';

export interface RetrievalQuery {
  query: string;
  mode: SearchMode;
  domain?: KnowledgeDomain;
  limit?: number;
  /** Minimum similarity score (0-1) for semantic search */
  minScore?: number;
  /** Filter by document IDs */
  documentIds?: string[];
  /** Filter by tags */
  tags?: string[];
}

export interface RetrievalResult {
  chunk: DocumentChunk;
  document: KnowledgeDocument;
  score: number;
  /** Match type (keyword / semantic / both) */
  matchType: 'keyword' | 'semantic' | 'hybrid';
  /** Highlighted text snippets for display */
  highlights?: Array<{ text: string; score: number }>;
}

export interface Citation {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  pageNumber?: number;
  sectionTitle?: string;
  snippet: string;
  /** Char range in the original answer */
  answerStartChar: number;
  answerEndChar: number;
}

// ─── Vector DB Interface (Phase 19+) ────────────────────────────────────────

export interface VectorDB {
  /** Add a chunk with its embedding */
  addChunk(chunk: DocumentChunk): Promise<void>;
  /** Search by vector similarity */
  searchSimilar(queryEmbedding: number[], limit: number, domain?: KnowledgeDomain): Promise<Array<{ chunk: DocumentChunk; score: number }>>;
  /** Delete chunks by document ID */
  deleteByDocument(documentId: string): Promise<void>;
  /** Get stats */
  getStats(): Promise<{ totalChunks: number; totalDocuments: number; sizeBytes: number }>;
}

// ─── Embedder Interface (Phase 19+) ─────────────────────────────────────────

export interface Embedder {
  /** Embed a text into a vector */
  embed(text: string): Promise<number[]>;
  /** Embed multiple texts in batch */
  embedBatch(texts: string[]): Promise<number[][]>;
  /** Embedding dimension (e.g. 768 for many models) */
  readonly dimension: number;
  /** Maximum input length (tokens) */
  readonly maxTokens: number;
}

// ─── Reranker Interface (Phase 19+) ─────────────────────────────────────────

export interface Reranker {
  /** Rerank retrieved chunks by relevance to the query */
  rerank(query: string, chunks: DocumentChunk[], topK: number): Promise<Array<{ chunk: DocumentChunk; score: number }>>;
}

// ─── Document Parser Interface (Phase 19+) ─────────────────────────────────

export interface DocumentParser {
  /** Returns true if this parser can handle the given format */
  canHandle(format: DocumentFormat): boolean;
  /** Parse a document into raw text + structure */
  parse(filePath: string): Promise<{ text: string; pages?: string[]; sections?: Array<{ title: string; text: string }> }>;
}

// ─── Knowledge Base Interface (Phase 19+) ──────────────────────────────────

export interface KnowledgeBase {
  /** Add a document from file */
  addDocument(filePath: string, domain?: KnowledgeDomain, metadata?: Record<string, any>): Promise<KnowledgeDocument>;
  /** Remove a document and its chunks */
  removeDocument(documentId: string): Promise<void>;
  /** List documents */
  listDocuments(domain?: KnowledgeDomain): Promise<KnowledgeDocument[]>;
  /** Retrieve relevant chunks for a query */
  retrieve(query: RetrievalQuery): Promise<RetrievalResult[]>;
  /** Get a specific document by ID */
  getDocument(documentId: string): Promise<KnowledgeDocument | null>;
  /** Get stats */
  getStats(): Promise<{ documents: number; chunks: number; domains: Record<KnowledgeDomain, number> }>;
}

// ─── Specialized Domain Knowledge (Phase 20+) ───────────────────────────────

export interface ElectronicsKnowledge {
  /** Look up a component by part number */
  findComponent(partNumber: string): Promise<ComponentInfo | null>;
  /** Find datasheets matching a query */
  findDatasheet(query: string): Promise<DatasheetInfo[]>;
  /** Compare two components */
  compareComponents(a: string, b: string): Promise<ComponentComparison>;
  /** Find application notes */
  findAppNote(query: string): Promise<AppNoteInfo[]>;
}

export interface ComponentInfo {
  partNumber: string;
  manufacturer: string;
  description: string;
  category: 'mcu' | 'mpu' | 'ic' | 'sensor' | 'power' | 'analog' | 'digital' | 'rf' | 'embedded';
  package?: string;
  datasheetUrl?: string;
  keySpecs?: Record<string, string>;
}

export interface DatasheetInfo {
  partNumber: string;
  pages: number;
  fileSize: number;
  downloadedAt?: number;
  localPath?: string;
}

export interface AppNoteInfo {
  title: string;
  partNumber?: string;
  url?: string;
  summary?: string;
}

export interface ComponentComparison {
  a: ComponentInfo;
  b: ComponentInfo;
  differences: Array<{ spec: string; valueA: string; valueB: string }>;
  recommendation?: string;
}

export interface ArchitectureKnowledge {
  /** Find building code references */
  findBuildingCode(query: string): Promise<BuildingCodeRef[]>;
  /** Look up material properties */
  findMaterial(name: string): Promise<MaterialInfo | null>;
  /** Find MEP design guidance */
  findMEPDesign(query: string): Promise<MEPDesignInfo[]>;
}

export interface BuildingCodeRef {
  code: string;       // e.g. "IBC 2021 §1613"
  title: string;
  section: string;
  text: string;
  source: string;
}

export interface MaterialInfo {
  name: string;
  category: 'concrete' | 'steel' | 'wood' | 'masonry' | 'composites' | 'insulation';
  properties: Record<string, number>;
  unit?: string;
}

export interface MEPDesignInfo {
  system: 'hvac' | 'plumbing' | 'electrical' | 'fire-safety';
  title: string;
  guidance: string;
  source: string;
}
