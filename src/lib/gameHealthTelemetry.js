// Bounded browser observations only. Never sends payloads, game IDs, moves,
// user identifiers, URLs, tokens, or raw errors. It never retries gameplay.
export function installGameHealthTelemetry(client) {
  const names = new Set(["submitMove", "getGameClock", "gameHeartbeat"]);
  const invoke = client.functions.invoke.bind(client.functions);
  let samples = new Map();
  let sending = false;
  let lastSentAt = Date.now();
  let firstFlushTimer = null;
  async function flush(force = false) {
    if (sending || !samples.size || (!force && Date.now() - lastSentAt < 120000)) return;
    sending = true;
    lastSentAt = Date.now();
    const batch = [...samples.values()];
    samples = new Map();
    try { await invoke("recordGameHealth", { samples: batch }); } catch { /* Drop this batch; never amplify an outage with retries. */ }
    finally { sending = false; }
  }
  function scheduleFirstFlush() {
    if (firstFlushTimer || !samples.size) return;
    firstFlushTimer = window.setTimeout(() => {
      firstFlushTimer = null;
      void flush(true);
    }, 15000);
  }
  client.functions.invoke = function(name, ...args) {
    if (!names.has(name)) return invoke(name, ...args);
    const started = performance.now();
    function record(error) {
      try {
        const s = samples.get(name) || { name, count: 0, server_errors: 0, network_errors: 0, rate_limits: 0, slow_count: 0 };
        if (s.count >= 1000) return;
        s.count++;
        const status = error?.response?.status;
        if (status === 429) s.rate_limits++;
        else if (status >= 500) s.server_errors++;
        else if (error && !status) s.network_errors++;
        if (performance.now() - started > 2000) s.slow_count++;
        samples.set(name, s);
        scheduleFirstFlush();
        void flush();
      } catch { /* Instrumentation must not affect the request result. */ }
    }
    return invoke(name, ...args).then(value => { record(null); return value; },
      error => { record(error); throw error; });
  };
}
