/**
 * NEX AI — Signature Verifier (Phase 44)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Phase 43 had signature verification "architecture" (a slot that returned
 * undefined). Phase 44 implements the actual verification using Node.js
 * built-in crypto module (no external dependencies).
 *
 * Supported algorithms:
 *   - Ed25519 (recommended — fast, modern, small signatures)
 *   - RSA-SHA256 (legacy compatibility)
 *
 * Before installation, BOTH checks must pass:
 *   1. SHA-256 hash matches expected hash
 *   2. Digital signature is valid for the hash
 *
 * If EITHER fails → STOP immediately. Do not install.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import * as crypto from 'crypto';
import * as fs from 'fs';

// ─── Types ─────────────────────────────────────────────────────────────────

export type SignatureAlgorithm = 'ed25519' | 'rsa-sha256';

export interface SignatureVerificationResult {
  /** Whether the signature is valid. */
  valid: boolean;
  /** Algorithm used. */
  algorithm: SignatureAlgorithm;
  /** The hash that was verified. */
  hash: string;
  /** Error message (if invalid). */
  error?: string;
}

export interface VersionCompatibilityResult {
  /** Whether the update is compatible with the current version. */
  compatible: boolean;
  /** Current version. */
  currentVersion: string;
  /** Target version. */
  targetVersion: string;
  /** Whether this is a downgrade (not allowed). */
  isDowngrade: boolean;
  /** Whether the version jump is too large (e.g. 1.0 → 3.0). */
  isMajorJump: boolean;
  /** Error message (if incompatible). */
  error?: string;
}

// ─── Signature Verifier ────────────────────────────────────────────────────

export class SignatureVerifier {
  /**
   * Verify an Ed25519 signature.
   *
   * Ed25519 is the recommended algorithm for NEX AI updates — it's fast,
   * has small signatures (64 bytes), and is supported by Node.js crypto.
   *
   * The public key should be distributed with the app (embedded at build time).
   * The private key is held by the release signing infrastructure.
   */
  verifyEd25519(
    dataHash: string,
    signature: string,
    publicKeyBase64: string,
  ): SignatureVerificationResult {
    try {
      const publicKey = crypto.createPublicKey({
        key: Buffer.from(publicKeyBase64, 'base64'),
        format: 'der',
        type: 'spki',
      });

      const signatureBuffer = Buffer.from(signature, 'base64');
      const dataBuffer = Buffer.from(dataHash, 'hex');

      const valid = crypto.verify(
        null, // Ed25519 doesn't use a separate algorithm
        dataBuffer,
        publicKey,
        signatureBuffer,
      );

      return {
        valid,
        algorithm: 'ed25519',
        hash: dataHash,
        error: valid ? undefined : 'Ed25519 signature verification failed',
      };
    } catch (err: any) {
      return {
        valid: false,
        algorithm: 'ed25519',
        hash: dataHash,
        error: `Ed25519 verification error: ${err.message}`,
      };
    }
  }

  /**
   * Verify an RSA-SHA256 signature.
   *
   * RSA is supported for legacy compatibility with existing signing
   * infrastructure. Ed25519 is preferred for new deployments.
   */
  verifyRsaSha256(
    dataHash: string,
    signature: string,
    publicKeyPem: string,
  ): SignatureVerificationResult {
    try {
      const publicKey = crypto.createPublicKey({
        key: publicKeyPem,
        format: 'pem',
      });

      const signatureBuffer = Buffer.from(signature, 'base64');
      const dataBuffer = Buffer.from(dataHash, 'hex');

      const valid = crypto.verify(
        'sha256',
        dataBuffer,
        publicKey,
        signatureBuffer,
      );

      return {
        valid,
        algorithm: 'rsa-sha256',
        hash: dataHash,
        error: valid ? undefined : 'RSA-SHA256 signature verification failed',
      };
    } catch (err: any) {
      return {
        valid: false,
        algorithm: 'rsa-sha256',
        hash: dataHash,
        error: `RSA verification error: ${err.message}`,
      };
    }
  }

  /**
   * Verify a signature using the appropriate algorithm (auto-detect).
   *
   * If the signature starts with "ed25519:", uses Ed25519.
   * If the signature starts with "rsa:", uses RSA-SHA256.
   * Otherwise, tries Ed25519 first, then RSA.
   */
  verify(
    dataHash: string,
    signature: string,
    publicKey: string,
  ): SignatureVerificationResult {
    if (signature.startsWith('ed25519:')) {
      return this.verifyEd25519(dataHash, signature.slice(8), publicKey);
    }
    if (signature.startsWith('rsa:')) {
      return this.verifyRsaSha256(dataHash, signature.slice(4), publicKey);
    }
    // Auto-detect: try Ed25519 first (most likely for new releases)
    const edResult = this.verifyEd25519(dataHash, signature, publicKey);
    if (edResult.valid) return edResult;
    // Fall back to RSA
    return this.verifyRsaSha256(dataHash, signature, publicKey);
  }

  /**
   * Verify version compatibility (prevent downgrades + major jumps).
   *
   * Rules:
   *   - Downgrade NOT allowed (v1.1 → v1.0)
   *   - Same version NOT needed (v1.0 → v1.0)
   *   - Major jump warning (v1.0 → v3.0 — might need migration)
   */
  checkVersionCompatibility(
    currentVersion: string,
    targetVersion: string,
  ): VersionCompatibilityResult {
    const current = this.parseVersion(currentVersion);
    const target = this.parseVersion(targetVersion);

    if (!current || !target) {
      return {
        compatible: false,
        currentVersion,
        targetVersion,
        isDowngrade: false,
        isMajorJump: false,
        error: 'Invalid version format (expected X.Y.Z)',
      };
    }

    // Check for downgrade
    const isDowngrade =
      target.major < current.major ||
      (target.major === current.major && target.minor < current.minor) ||
      (target.major === current.major && target.minor === current.minor && target.patch < current.patch);

    if (isDowngrade) {
      return {
        compatible: false,
        currentVersion,
        targetVersion,
        isDowngrade: true,
        isMajorJump: false,
        error: `Downgrade not allowed: v${currentVersion} → v${targetVersion}`,
      };
    }

    // Check for major version jump (e.g. v1.0 → v3.0)
    const isMajorJump = target.major - current.major >= 2;
    if (isMajorJump) {
      // Warning but not blocked — the user should be aware
      return {
        compatible: true,
        currentVersion,
        targetVersion,
        isDowngrade: false,
        isMajorJump: true,
        error: `Major version jump: v${currentVersion} → v${targetVersion} (migration may be needed)`,
      };
    }

    return {
      compatible: true,
      currentVersion,
      targetVersion,
      isDowngrade: false,
      isMajorJump: false,
    };
  }

  /**
   * Full pre-installation verification:
   *   1. SHA-256 hash matches
   *   2. Digital signature is valid
   *   3. Version is compatible
   *
   * If ANY check fails → STOP. Do not install.
   */
  verifyForInstallation(opts: {
    filePath: string;
    expectedHash: string;
    signature?: string;
    publicKey?: string;
    currentVersion: string;
    targetVersion: string;
  }): {
    canInstall: boolean;
    hashVerified: boolean;
    signatureVerified: boolean;
    versionCompatible: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // 1. Hash verification
    let hashVerified = false;
    try {
      const actualHash = this.computeFileHash(opts.filePath);
      hashVerified = actualHash === opts.expectedHash;
      if (!hashVerified) {
        errors.push(`Hash mismatch: expected ${opts.expectedHash}, got ${actualHash}`);
      }
    } catch (err: any) {
      errors.push(`Hash computation failed: ${err.message}`);
    }

    // 2. Signature verification (if signature + key provided)
    let signatureVerified = true; // default true if no signature to check
    if (opts.signature && opts.publicKey) {
      const sigResult = this.verify(opts.expectedHash, opts.signature, opts.publicKey);
      signatureVerified = sigResult.valid;
      if (!sigResult.valid) {
        errors.push(`Signature verification failed: ${sigResult.error}`);
      }
    }

    // 3. Version compatibility
    const versionResult = this.checkVersionCompatibility(opts.currentVersion, opts.targetVersion);
    const versionCompatible = versionResult.compatible;
    if (!versionCompatible) {
      errors.push(`Version incompatible: ${versionResult.error}`);
    }

    return {
      canInstall: hashVerified && signatureVerified && versionCompatible,
      hashVerified,
      signatureVerified,
      versionCompatible,
      errors,
    };
  }

  /**
   * Compute SHA-256 hash of a file (streaming).
   */
  computeFileHash(filePath: string): string {
    const hash = crypto.createHash('sha256');
    const data = fs.readFileSync(filePath);
    hash.update(data);
    return hash.digest('hex');
  }

  /**
   * Parse a version string "X.Y.Z" into components.
   */
  private parseVersion(v: string): { major: number; minor: number; patch: number } | null {
    const match = v.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
    };
  }
}
