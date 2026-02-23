import crypto from "node:crypto";

function getKey(): Buffer {
  const raw = process.env.API_TOKEN_ENCRYPTION_KEY || "";
  // 32 bytes hex (64 chars)
  if (!/^[a-fA-F0-9]{64}$/.test(raw)) {
    throw new Error("API_TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes)");
  }
  return Buffer.from(raw, "hex");
}

export function encryptString(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, ciphertext]).toString("base64");
  return `v1:${packed}`;
}

export function decryptString(ciphertextEnc: string): string {
  if (!ciphertextEnc.startsWith("v1:")) throw new Error("Unsupported ciphertext format");
  const packed = Buffer.from(ciphertextEnc.slice(3), "base64");
  if (packed.length < 12 + 16 + 1) throw new Error("Invalid ciphertext");
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const key = getKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

