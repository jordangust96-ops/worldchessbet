import { runContestEligibility } from '../../shared/runContestEligibility.ts';
Deno.serve(req => runContestEligibility(req));
