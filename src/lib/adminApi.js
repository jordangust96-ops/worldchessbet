import { base44 } from "@/api/base44Client";
import { getMfaSessionToken } from "@/lib/mfaSession";

export function invokeAdminFunction(functionName, payload = {}) {
  return base44.functions.invoke(functionName, {
    ...payload,
    mfaSessionToken: getMfaSessionToken(),
  });
}
