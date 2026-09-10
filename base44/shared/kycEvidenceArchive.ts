function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Provider evidence is encrypted before persistence. The key must be a
// Base64URL-encoded 32-byte secret stored only in Base44 Secrets.
export async function encryptComplianceJson(value: unknown, options: { compress?: boolean } = {}) {
  const encodedKey = (Deno.env.get('KYC_AUDIT_ENCRYPTION_KEY') || '').trim();
  const keyBytes = base64UrlToBytes(encodedKey);
  if (keyBytes.length !== 32) throw new Error('KYC audit encryption is not configured');
  const original = new TextEncoder().encode(JSON.stringify(value));
  // Lossless compression happens BEFORE encryption. Keep the original hash and
  // self-describe the ciphertext format so historical uncompressed archives remain readable.
  const plaintext = options.compress
    ? new Uint8Array(await new Response(new Blob([original]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
    : original;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return {
    ciphertext: (options.compress ? 'gzip-aesgcm-v1:' : '') + bytesToBase64(ciphertext),
    iv: bytesToBase64(iv),
    sha256: await sha256Text(new TextDecoder().decode(original)),
  };
}
