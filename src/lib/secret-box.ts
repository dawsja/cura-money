import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const PREFIX = 'cura-secret:v1:';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const AAD = Buffer.from('cura-money/secret-box:v1', 'utf8');
const KDF_SALT = Buffer.from('cura-money/at-rest-encryption', 'utf8');
const KDF_INFO = Buffer.from('secret-box:v1', 'utf8');

export class SecretBoxError extends Error {
  constructor() {
    super('Stored secret could not be decrypted.');
    this.name = 'SecretBoxError';
  }
}

function encryptionKey(rootSecret: string): Buffer {
  if (rootSecret.length < 32) throw new SecretBoxError();
  return Buffer.from(hkdfSync('sha256', rootSecret, KDF_SALT, KDF_INFO, 32));
}

function decryptionSecrets(override?: string): string[] {
  if (override !== undefined) return [override];

  const current = process.env.DATA_ENCRYPTION_KEY || process.env.BETTER_AUTH_SECRET;
  if (!current) throw new SecretBoxError();
  return [...new Set([
    current,
    ...(process.env.DATA_ENCRYPTION_KEY_PREVIOUS ?? '')
      .split(',')
      .map((secret) => secret.trim())
      .filter(Boolean),
    process.env.BETTER_AUTH_SECRET,
  ].filter((secret): secret is string => Boolean(secret)))];
}

function currentSecret(override?: string): string {
  const secret = override ?? process.env.DATA_ENCRYPTION_KEY ?? process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new SecretBoxError();
  return secret;
}

function decrypt(value: string, secret: string): string {
  const payload = Buffer.from(value.slice(PREFIX.length), 'base64url');
  if (payload.length < NONCE_BYTES + TAG_BYTES) throw new SecretBoxError();
  const nonce = payload.subarray(0, NONCE_BYTES);
  const ciphertext = payload.subarray(NONCE_BYTES, -TAG_BYTES);
  const tag = payload.subarray(-TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), nonce);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function isSealedSecret(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function sealSecret(plaintext: string, secret?: string): string {
  try {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(currentSecret(secret)), nonce);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return PREFIX + Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString('base64url');
  } catch {
    throw new SecretBoxError();
  }
}

export interface OpenedSecret {
  value: string;
  source: 'current' | 'fallback' | 'plaintext';
  needsReseal: boolean;
}

/** Opens a secret and reports whether it should be resealed with the current key. */
export function openSecretWithMetadata(value: string, secret?: string): OpenedSecret {
  if (!isSealedSecret(value)) {
    return { value, source: 'plaintext', needsReseal: true };
  }

  const secrets = decryptionSecrets(secret);
  for (let index = 0; index < secrets.length; index++) {
    try {
      return {
        value: decrypt(value, secrets[index]!),
        source: index === 0 ? 'current' : 'fallback',
        needsReseal: index !== 0,
      };
    } catch {
      // Authentication failures are expected while trying rotation keys.
    }
  }
  throw new SecretBoxError();
}

/** Opens versioned ciphertext and passes legacy plaintext through unchanged. */
export function openSecret(value: string, secret?: string): string {
  return openSecretWithMetadata(value, secret).value;
}
