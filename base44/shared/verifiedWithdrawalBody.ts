import { seamlessRequest, PATH_ACCOUNT, buildWithdrawalBody } from './seamlessAch.ts';

// The API's account field is the SENDER. Recipient's linked primary bank is
// selected by recipient ID; verify it still matches the request's saved bank.
export async function buildVerifiedWithdrawalBody(input) {
  const fail = (code) => { throw Object.assign(new Error(code), {status:409, withdrawalReason:code}); };
  const account = await seamlessRequest('GET', PATH_ACCOUNT);
  const merchantId = account?.user_id || account?.account?.user_id || account?.data?.user_id ||
    account?.data?.account?.user_id || account?.user?.user_id || account?.id;
  if (!merchantId || merchantId === input.providerUserId) fail('withdrawal_merchant_unavailable');
  const sources = async (id) => {
    const response = await seamlessRequest('GET', '/funding-source/user/:' + encodeURIComponent(id));
    if (response?.success !== true || !Array.isArray(response.list)) fail('withdrawal_sources_unavailable');
    return response.list;
  };
  const [merchant, recipient] = await Promise.all([sources(merchantId), sources(input.providerUserId)]);
  const primary = recipient.filter(row => row.is_primary === true && row.user_id === input.providerUserId);
  if (primary.length !== 1 || primary[0].source_id !== input.sourceId ||
      String(primary[0].status).toLowerCase() !== 'verified') fail('withdrawal_destination_changed');
  const balances = merchant.filter(row => row.user_id === merchantId &&
    String(row.bank).toLowerCase() === 'balance' && String(row.status).toLowerCase() === 'verified' && row.source_id);
  if (balances.length !== 1) fail('withdrawal_merchant_balance_unavailable');
  return buildWithdrawalBody({...input, senderSourceId:balances[0].source_id});
}
