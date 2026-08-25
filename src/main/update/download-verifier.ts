/**
 * NEX AI — Download Verifier (Phase 43)
 *
 * Verifies downloaded files using SHA-256 hash verification + digital signature
 * architecture. Downloads go to a sandbox (temp directory) — never directly
 * to the target path until verified.
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

export class DownloadVerifier {
  private sandboxDir: string;

  constructor() {
    this.sandboxDir = path.join(os.tmpdir(), 'nex-update-sandbox');
    if (!fs.existsSync(this.sandboxDir)) {
      fs.mkdirSync(this.sandboxDir, { recursive: true });
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
   * Verify a downloaded file against an expected hash.
   *
   * The file must already be in the sandbox. This computes its hash and
   * compares to the expected hash.
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

      // Signature verification architecture (not fully implemented — requires
      // a public key infrastructure). For now, we verify the hash only.
      // A future Phase can add RSA/Ed25519 signature verification.
      let signatureValid: boolean | undefined;
      if (expectedSignature) {
        // Architecture: verify signature using the app's embedded public key.
        // For now, we log that signature verification was requested but not
        // implemented (hash verification is the primary check).
        signatureValid = undefined; // not implemented
      }

      return {
        verified: hashMatches,
        hash: actualHash,
        hashMatches,
        signatureValid,
        sandboxPath: sandboxFilePath,
        error: hashMatches ? undefined : `Hash mismatch: expected ${expectedHash}, got ${actualHash}`,
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
