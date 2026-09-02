Deno.serve(() =>
  Response.json(
    { error: "reset_endpoint_disabled" },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  )
);
