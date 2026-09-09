# ChessBet health monitoring

Implemented September 7, 2026. Alert recipient: hello@worldchessbet.com.

## What runs

Site Health Monitoring is an active one-step Base44 workflow, every 15 minutes at minutes 03, 18, 33 and 48 UTC. It reads operational records, checks the public homepage, sends read-only PING to the two configured Upstash stores, and reads the analyzer health endpoint without submitting an analysis job. Incident/recovery notifications have a one-hour cooldown; a daily digest is sent in the 9 AM America/Detroit hour. Email status “accepted” means the Base44 mail service accepted the request, not proof of mailbox receipt.

The existing chessbet_operations agent now has the read-only getSiteHealth tool. Its existing restrictions remain. The daily operations brief includes the health snapshot and cannot claim there are no exceptions when monitoring coverage is unknown.

The admin dashboard is implemented at /admin/health, linked from Profile → Admin Tools → Site Health. Browser telemetry for submitMove, getGameClock and gameHeartbeat is buffered and submitted at most once per two minutes of request activity. It carries aggregate counts only, not moves, game identifiers, credentials, URLs or raw errors. It never retries gameplay. The frontend awaits publication and visual verification behind the app's MFA screen.

## Coverage and limits

- Workspace credit figures must be copied from Base44 Usage; the connected SDK has no automated credit balance feed. Readings become unknown after 24 hours. Forecasts warn about current depletion and a scheduled lower allowance.
- No tested simultaneous-player capacity is assumed. Set a capacity baseline only after a controlled load test; warnings begin at 70% of that baseline.
- Reads are bounded to 501 records per check. Saturated scans are lower bounds. Browser data is a recent, incomplete, client-reported sample and cannot support player enforcement.
- The collector retains 24 snapshots (about six hours) in one current record. Missing or older-than-35-minute observations are unknown.
- An unauthenticated publicSiteHealth function returns only coarse availability and 503 for stale/missing/critical monitoring state. This endpoint is ready for a separate dead-man monitor; no independent heartbeat alert is configured yet.
- Base44 cannot report its own complete outage by email. DigitalOcean's independent homepage check continues outside Base44, but its notification delivery is awaiting mailbox verification.
- No financial, gameplay, account, provider configuration or infrastructure resource state is changed by health collection. Seamless checks read saved records; they do not prove end-to-end provider transaction or webhook delivery.

## DigitalOcean

One included Uptime check, “ChessBet website availability,” was created for https://worldchessbet.com. Check ID: 2c7e5da7-faed-4124-81ca-58982da0dafe. It checks every 60 seconds in USA East, USA West, Europe and Asia East. DigitalOcean provides one free monthly check allowance; additional checks cost $1/month each: https://docs.digitalocean.com/products/uptime/details/pricing/

DigitalOcean's Uptime and resource alert forms permit only verified account emails. hello@worldchessbet.com was not offered as a verified destination. No alerts were saved to the account's Gmail address as a substitute. After the desired address is verified, finish:

1. Uptime: downtime for 2 minutes, latency over 2500 ms for 5 minutes, and SSL expiry within 14 days, all to hello@worldchessbet.com.
2. Droplet ubuntu-s-1vcpu-2gb-nyc3-01: CPU >70% for 10 minutes; memory >80% for 10 minutes; disk >80% for 10 minutes. These are early warning thresholds, not demonstrated failure points.
3. App Platform analyzer resource and deployment alerts using the same verified destination; live metrics are not ingested by Base44.

## Validation

npm run build passed. npm run test:site-health passed with mocked providers and email, covering stale/unknown data, credit forecasting, gameplay thresholds, admin authorization, persistence, cooldown/recovery, bounded telemetry and unchanged gameplay response/error behavior. Relevant frontend lint and git diff --check passed.

Full typecheck reports three existing errors in src/pages/Blog.jsx (Element.name/content typing), also present at the pre-change checkpoint. No monitoring-related type errors were reported.

The first live run at 19:44 UTC exposed incompatible fetch options in the Base44 runtime and sent an incorrect connection-failure alert. The fetch bridge compatibility was corrected. The subsequent read-only live run at 19:48 UTC confirmed healthy website, both Redis stores and analyzer responses (154–266 ms); no email was sent by that verification. Four legacy verification sessions still marked pending were observed and left as historical records.

## Operating controls

Pause collection in Base44 Dashboard → Workflows → Site Health Monitoring → Active toggle. The operations agent cannot invoke collection or send email. The admin backend updateSiteHealthSettings accepts alert enable/disable, manually observed credit readings and tested capacity only; it cannot change recipients or external provider settings.

At 15-minute cadence this is approximately 2,880 workflow executions per 30 days. This is a run count, not a fixed credit charge. Base44 bills a fraction of an integration credit per workflow function step, with additional charges for built-in email; confirm actual consumption in Usage: https://docs.base44.com/Building-your-app/Creating-workflows

Pre-change checkpoint: 6a9f0f4b9e7c6399d8634a67 (commit 9a0d8939b76737b9ce35dc3fbb014f90935786ee).

## Final persisted verification

At 20:04:07 UTC (4:04 PM Detroit), a real workflow run persisted status warning, with healthy website (262 ms), financial Redis (176 ms), rating Redis (175 ms), and analyzer (244 ms). The only measured warnings were the projected next-cycle credit shortfall and four overdue legacy verification records. No active games or analyzer backlog were observed. This supersedes the incorrect initial connection alert. DigitalOcean separately reported UP in all four regions; its email alerts are still not enabled. Anonymous requests to each protected monitoring API returned HTTP 401. The coarse public endpoint subsequently returned HTTP 200 with status ok.

Final code checkpoint: 6a9f182271a7ec06353f17c9 (commit 2bff05b370f078da80cf0543e3e0fea3f113854c). Preview visual verification is blocked by MFA/code-request rate limiting. No frontend publication was performed.
