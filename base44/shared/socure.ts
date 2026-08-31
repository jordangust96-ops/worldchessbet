// Server-only Socure RiskOS client. Secrets are read only from Base44
// environment configuration; callers must never import this into frontend code.
export const SOCURE_PROVIDER_KEY = 'socure';
const DEFAULT_BASE_URL = 'https://riskos.socure.com';
const DEFAULT_WORKFLOW = 'account_intelligence_screening';
const DEFAULT_API_VERSION = '2025-01-01.orion';

export function socureConfig() {
  const enabled = Deno.env.get('SOCURE_ENABLED') === 'true';
  if (!enabled) return { enabled: false };

  const apiKey = (Deno.env.get('SOCURE_API_KEY') || '').trim();
  const environment = (Deno.env.get('SOCURE_ENV') || 'production').trim().toLowerCase();
  const baseUrl = (Deno.env.get('SOCURE_BASE_URL') || DEFAULT_BASE_URL).trim().replace(/\/$/, '');
  const workflow = (Deno.env.get('SOCURE_WORKFLOW') || DEFAULT_WORKFLOW).trim();
  const apiVersion = (Deno.env.get('SOCURE_API_VERSION') || DEFAULT_API_VERSION).trim();

  // This launch integration is deliberately production-only. Sandbox testing
  // belongs in Socure's test environment and is never silently substituted.
  if (environment !== 'production' || baseUrl !== DEFAULT_BASE_URL) {
    throw new Error('Socure must be explicitly configured for the production RiskOS endpoint');
  }
  if (!apiKey || !workflow) {
    throw new Error('Socure configuration is incomplete');
  }

  return { enabled: true, apiKey, baseUrl, workflow, apiVersion };
}

export async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function responseError(category: string, status?: number) {
  const error = new Error(category);
  (error as any).socureCategory = category;
  (error as any).socureStatus = status;
  return error;
}

// Executes exactly one RiskOS evaluation. The request body and raw provider
// response are intentionally not logged or persisted by this helper.
export async function evaluateSocureBankAccount({
  config,
  evaluationId,
  givenName,
  familyName,
  accountNumber,
  routingNumber,
}: {
  config: ReturnType<typeof socureConfig> & { enabled: true };
  evaluationId: string;
  givenName: string;
  familyName: string;
  accountNumber: string;
  routingNumber: string;
}) {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/api/evaluation`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-API-Version': config.apiVersion,
      },
      body: JSON.stringify({
        id: evaluationId,
        timestamp: new Date().toISOString(),
        workflow: config.workflow,
        data: {
          individual: {
            given_name: givenName,
            family_name: familyName,
            account: {
              account_number: accountNumber,
              routing_number: routingNumber,
              account_inquiries: ['AVAILABILITY', 'OWNERSHIP'],
            },
          },
        },
      }),
      signal: AbortSignal.timeout(12000),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') throw responseError('timeout_unknown_outcome');
    throw responseError('network_unknown_outcome');
  }

  const bodyText = await response.text();
  let body: any = null;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    throw responseError('invalid_response', response.status);
  }
  if (!response.ok) throw responseError(`http_${response.status}`, response.status);
  if (!body || typeof body !== 'object') throw responseError('invalid_response', response.status);
  return body;
}
