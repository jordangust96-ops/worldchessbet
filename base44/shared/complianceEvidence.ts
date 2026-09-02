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
export async function encryptComplianceJson(value: unknown) {
  const encodedKey = (Deno.env.get('KYC_AUDIT_ENCRYPTION_KEY') || '').trim();
  const keyBytes = base64UrlToBytes(encodedKey);
  if (keyBytes.length !== 32) throw new Error('KYC audit encryption is not configured');
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return {
    ciphertext: bytesToBase64(ciphertext),
    iv: bytesToBase64(iv),
    sha256: await sha256Text(new TextDecoder().decode(plaintext)),
  };
}

function retentionUntil(activityAt: string) {
  const date = new Date(activityAt);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid compliance activity timestamp');
  date.setUTCFullYear(date.getUTCFullYear() + 2);
  return date.toISOString();
}

// Extends required KYC and ACH evidence retention from each transaction. A
// deposit fails closed without the encrypted Socure report and its matching
// active debit authorization. Withdrawals still require KYC evidence but do not
// require debit authorization because they are outbound credits.
export async function extendComplianceEvidenceRetention(base44: any, {
  userId,
  fundingSourceId,
  activityAt = new Date().toISOString(),
  requireAchAuthorization = false,
}: {
  userId: string;
  fundingSourceId: string;
  activityAt?: string;
  requireAchAuthorization?: boolean;
}) {
  const deadline = retentionUntil(activityAt);
  const identities = await base44.asServiceRole.entities.SocureIdentityVerification.filter(
    { user_id: userId, status: 'verified', provider_decision: 'ACCEPT' },
    '-completed_at',
    10
  );
  const identity = identities.find((row: any) =>
    row.provider_evaluation_id && row.provider_report_ciphertext &&
    row.provider_report_iv && row.provider_report_sha256
  );
  if (!identity) throw new Error('retained Socure identity evidence is required');
  await base44.asServiceRole.entities.SocureIdentityVerification.update(identity.id, {
    retention_until: deadline,
  });

  const authorizations = await base44.asServiceRole.entities.AchDebitAuthorization.filter(
    { user_id: userId, funding_source_id: fundingSourceId, status: 'active' },
    '-accepted_at',
    10
  );
  const authorization = authorizations.find((row: any) =>
    row.bank_details_ciphertext && row.bank_details_iv && row.bank_details_sha256
  );
  if (requireAchAuthorization && !authorization) {
    throw new Error('active ACH debit authorization is required');
  }
  if (authorization) {
    await base44.asServiceRole.entities.AchDebitAuthorization.update(authorization.id, {
      last_transaction_at: activityAt,
      retention_until: deadline,
    });
  }
  return {
    identity_verification_id: identity.id,
    authorization_id: authorization?.id || '',
    retention_until: deadline,
  };
}
