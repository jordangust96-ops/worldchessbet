const PROD = 'https://riskos.socure.com';
export function identityConfig() {
  const enabled = Deno.env.get('SOCURE_IDENTITY_ENABLED') === 'true';
  const environment = (Deno.env.get('SOCURE_IDENTITY_ENV') || 'production').trim().toLowerCase();
  const apiKey = (Deno.env.get('SOCURE_IDENTITY_API_KEY') || '').trim();
  const workflow = (Deno.env.get('SOCURE_IDENTITY_WORKFLOW') || 'consumer_onboarding').trim();
  const redirectUri = (Deno.env.get('SOCURE_IDENTITY_RETURN_URL') || 'https://worldchessbet.com/wallet').trim();
  const webhookToken = (Deno.env.get('SOCURE_IDENTITY_WEBHOOK_TOKEN') || '').trim();
  if (!enabled) return { enabled: false };
  const redirect = new URL(redirectUri);
  if (environment !== 'production' || workflow !== 'consumer_onboarding' || !apiKey || webhookToken.length < 20 ||
      redirect.protocol !== 'https:' || redirect.hostname !== 'worldchessbet.com')
    throw new Error('Socure KYC configuration is incomplete');
  return { enabled: true, environment, apiKey, workflow, redirectUri: 'https://worldchessbet.com/wallet?verification=returned', webhookToken, baseUrl: PROD };
}
export function safeHostedUrl(value) {
  try { const url = new URL(value); return url.origin === PROD && url.pathname.startsWith('/hosted/') && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
export async function startIdentityEvaluation(config, requestId, userId) {
  const res = await fetch(config.baseUrl + '/api/evaluation', {
    method: 'POST', headers: { Authorization: 'Bearer ' + config.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ id: requestId, timestamp: new Date().toISOString(), workflow: 'consumer_onboarding',
      data: { individual: { id: userId }, custom: { redirect_uri: config.redirectUri } } }),
    signal: AbortSignal.timeout(12000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.eval_id || !safeHostedUrl(body.redirect_uri) || body.decision !== 'REVIEW' || body.eval_status !== 'evaluation_paused')
    throw new Error('socure_identity_start_failed');
  return { eval_id: body.eval_id, redirect_uri: safeHostedUrl(body.redirect_uri) };
}
export function constantTimeEqual(a, b) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}

