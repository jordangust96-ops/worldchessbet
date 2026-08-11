export const PLAID_ENV = Deno.env.get('PLAID_ENV') || 'production';
const baseUrl = () => PLAID_ENV === 'sandbox' ? 'https://sandbox.plaid.com' : PLAID_ENV === 'development' ? 'https://development.plaid.com' : 'https://production.plaid.com';

export async function plaid(path: string, payload: Record<string, unknown>) {
  const client_id = Deno.env.get('PLAID_CLIENT_ID');
  const secret = Deno.env.get('PLAID_SECRET');
  if (!client_id || !secret) throw new Error('Plaid is not configured');
  const response = await fetch(`${baseUrl()}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id, secret, ...payload }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error_message || data?.error_code || 'Plaid request failed');
  return data;
}