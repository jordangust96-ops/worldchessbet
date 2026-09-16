import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';
import { installGameHealthTelemetry } from '@/lib/gameHealthTelemetry';

const { appId, token } = appParams;

// Keep the production client on Base44's current function namespace. Passing a
// deployment-specific functionsVersion can strand a cached browser on a
// retired backend even while entity reads continue to work.
export const base44 = createClient({ appId, token });

installGameHealthTelemetry(base44);
