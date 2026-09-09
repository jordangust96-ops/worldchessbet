// Retired provider callback. ChessBet now accepts account-verification state
// only from the authenticated seamlessAchWebhook funding-source lifecycle.
Deno.serve(() => Response.json({ error: 'identity_provider_retired' }, { status: 410 }));
