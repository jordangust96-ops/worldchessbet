import { lockWager } from '../../shared/lockWager.ts';
Deno.serve(req => lockWager(req));
