import { getRequestJurisdiction } from '../../shared/requestJurisdiction.ts';
// Reuse the same policy in-process for paid actions, preserving the trusted edge IP.
Deno.serve(req => getRequestJurisdiction(req));
