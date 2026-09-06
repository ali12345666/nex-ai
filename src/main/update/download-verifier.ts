/**
 * NEX AI — Download Verifier (Phase 43)
 *
 * Verifies downloaded files using SHA-256 hash verification + digital signature
 * architecture. Downloads go to a sandbox (temp directory) — never directly
 * to the target path until verified.
 *
 * Phase 18 (pre-Phase 19): Implemented Ed25519 signature verification using
 * Node.js built-in `crypto.verify` (no external dependency). The public key
 * is loaded from an embedded PEM file at `build/update-public-key.pem`. If
 * no key file exists, signature verification falls back to hash-only (with
 * a warning logged). When a signature IS provided AND a public key IS
 * available, both hash AND signature must pass — a valid hash with an
 * invalid signature returns `verified=false` (defense in depth).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

export interface DownloadVerificationResult {
  verified: boolean;
  /** SHA-256 hash of the downloaded file. */
  hash: string;
  /** Whether the hash matches the expected hash. */
  hashMatches: boolean;
  /** Whether the signature is valid (if signature verification was used). */
  signatureValid?: boolean;
  /** Path to the verified file in the sandbox. */
  sandboxPath: string;
  /** Error message (if verification failed). */
  error?: string;
}

/**
 * Load the Ed25519 public key from the embedded PEM file.
 * Returns null if no key file exists (signature verification disabled).
 */
function loadEmbeddedPublicKey(): crypto.KeyObject | null {
  // Try multiple locations: build/ (packaged), ../../build/ (dev)
  const candidates = [
    path.join(__dirname, '../../build/update-public-key.pem'),
    path.join(process.resourcesPath || '', 'build/update-public-key.pem'),
  ];
  for (const keyPath of candidates) {
    try {
      if (fs.existsSync(keyPath)) {
        const pem = fs.readFileSync(keyPath, 'utf-8');
        return crypto.createPublicKey(pem);
      }
    } catch { /* try next candidate */ }
  }
  return null;
}

export class DownloadVerifier {
  private sandboxDir: string;
  private publicKey: crypto.KeyObject | null;

  constructor() {
    this.sandboxDir = path.join(os.tmpdir(), 'nex-update-sandbox');
    if (!fs.existsSync(this.sandboxDir)) {
      fs.mkdirSync(this.sandboxDir, { recursive: true });
    }
    this.publicKey = loadEmbeddedPublicKey();
    if (!this.publicKey) {
      console.warn('[UPDATE] No Ed25519 public key found — signature verification disabled (hash-only mode)');
    }
  }

  /**
   * Compute the SHA-256 hash of a file (streaming, handles large files).
   */
  async computeFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const input = fs.createReadStream(filePath);
      input.on('data', (chunk) => hash.update(chunk));
      input.on('end', () => resolve(hash.digest('hex')));
      input.on('error', reject);
    });
  }

  /**
   * Verify a downloaded file against an expected hash and optional signature.
   *
   * When `expectedSignature` is provided:
   * - If a public key is available: verify the Ed25519 signature of the
   *   file content. Both hash AND signature must pass for `verified=true`.
   *   A valid hash with an invalid signature returns `verified=false`.
   * - If no public key is available: fall back to hash-only verification
   *   (log a warning). `signatureValid` is set to `undefined` to indicate
   *   signature verification was skipped (NOT that it failed).
   *
   * When `expectedSignature` is NOT provided:
   * - Hash-only verification (existing behavior).
   *
   * The signature is expected to be a base64-encoded Ed25519 signature
   * of the file's raw bytes (NOT the hash — the signature covers the
   * file content directly, which is more secure than signing the hash).
   */
  async verifyDownload(
    sandboxFilePath: string,
    expectedHash: string,
    expectedSignature?: string,
  ): Promise<DownloadVerificationResult> {
    try {
      if (!fs.existsSync(sandboxFilePath)) {
        return {
          verified: false,
          hash: '',
          hashMatches: false,
          sandboxPath: sandboxFilePath,
          error: 'File not found in sandbox',
        };
      }

      const actualHash = await this.computeFileHash(sandboxFilePath);
      const hashMatches = actualHash === expectedHash;

      // Phase 18 (pre-Phase 19): Real Ed25519 signature verification.
      let signatureValid: boolean | undefined;
      if (expectedSignature) {
        if (this.publicKey) {
          // Read the file content and verify the Ed25519 signature.
          // Ed25519 signs the message directly (no separate hash needed —
          // the signing algorithm internally hashes + signs).
          const fileContent = fs.readFileSync(sandboxFilePath);
          try {
            const sigBuf = Buffer.from(expectedSignature, 'base64');
            const isValid = crypto.verify(
              null, // Ed25519 uses null algorithm (no separate hash)
              fileContent,
              this.publicKey,
              sigBuf,
            );
            signatureValid = isValid;
            if (!isValid) {
              console.warn('[UPDATE] Signature verification FAILED — file may be tampered');
            }
          } catch (verifyErr: any) {
            console.warn('[UPDATE] Signature verification error:', verifyErr?.message);
            signatureValid = false;
          }
        } else {
          // No public key available — signature verification skipped.
          // This is safe as long as hash verification passes (defense in
          // depth: hash-only is still a valid integrity check). The
          // `signatureValid=undefined` signals to the caller that
          // signature verification was SKIPPED, not that it failed.
          signatureValid = undefined;
          console.warn('[UPDATE] Signature provided but no public key — verification skipped');
        }
      }

      // Defense in depth: if signature was provided AND verified, it must
      // be valid. If signatureValid is explicitly false (verification ran
      // and failed), the download is rejected even if the hash matches.
      const verified = hashMatches && (signatureValid !== false);

      return {
        verified,
        hash: actualHash,
        hashMatches,
        signatureValid,
        sandboxPath: sandboxFilePath,
        error: verified ? undefined :
          !hashMatches ? `Hash mismatch: expected ${expectedHash}, got ${actualHash}` :
          signatureValid === false ? 'Signature verification failed — file may be tampered' :
          undefined,
      };
    } catch (err: any) {
      return {
        verified: false,
        hash: '',
        hashMatches: false,
        sandboxPath: sandboxFilePath,
        error: err.message,
      };
    }
  }

  /**
   * Move a verified file from the sandbox to its target path.
   * Only call this AFTER verifyDownload() returned verified=true.
   */
  moveToTarget(sandboxFilePath: string, targetPath: string): boolean {
    try {
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      // Atomic move (if same filesystem) or copy+delete
      try {
        fs.renameSync(sandboxFilePath, targetPath);
      } catch {
        // Cross-device: copy then delete
        fs.copyFileSync(sandboxFilePath, targetPath);
        fs.unlinkSync(sandboxFilePath);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up the sandbox (remove all files).
   */
  cleanSandbox(): void {
    try {
      const files = fs.readdirSync(this.sandboxDir);
      for (const f of files) {
        try { fs.unlinkSync(path.join(this.sandboxDir, f)); } catch { /* */ }
      }
    } catch { /* */ }
  }

  get sandboxPath(): string {
    return this.sandboxDir;
  }
}
