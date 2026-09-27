Deno.serve(() => Response.json({ error: "Migration complete" }, { status: 410, headers: { "Cache-Control": "no-store" } }));
