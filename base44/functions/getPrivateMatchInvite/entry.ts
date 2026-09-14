// Compatibility tombstone for the retired private-match controller.
// Shared invitation previews are now public, minimal, and resolved through
// manageChallenge. Do not expose old participant details or reactivate the
// old accept-then-fund pathway. Historical Match records remain unchanged.
Deno.serve(() => Response.json({
  error: 'This legacy invitation is no longer available. Ask the creator for a new challenge link.',
  action: 'challenge_link_required',
}, { status: 410, headers: { 'Cache-Control': 'no-store' } }));
