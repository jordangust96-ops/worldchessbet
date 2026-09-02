import { createClientFromRequest } from "npm:@base44/sdk";

const EXPECTED_TOKEN_SHA256 = "6eb022a359ab6f2e171d65010fdb7892aab9dd334078eac1400ec52e3e907f93";
const EXPIRES_AT = Date.parse("2026-09-02T01:45:42.590Z");
const CONFIRMATION = "RESET_ALL_EARLY_ACCESS_DATA_PRESERVE_USERS_AND_CONFIG";
const DELETE_ORDER = [
  "CaseEvidence", "CaseResolution", "CaseAppeal", "DisputeCaseNote",
  "ContestRecordAnnotation", "IntegrityAuditLog", "FairPlayAnalysis",
  "MatchDeclineLog", "SettlementReconciliation", "OperationsFinding",
  "DailyOperationsBrief", "CampaignDelivery", "CampaignEmailLog",
  "CampaignRun", "EmailLog", "LaunchNotification", "SiteVisit", "MfaSession",
  "MfaCode", "MfaAuditLog", "PrivacyPolicyAcceptance", "JurisdictionInterest",
  "IntegrationReference", "integration-reference", "IntegrationEvent",
  "LedgerEntry", "LedgerOperation", "WalletTransaction", "Game", "Match",
  "ContestRecord", "IntegrityFlag", "DisputeCase", "SeamlessOperation",
  "SeamlessPaymentProfile", "SeamlessBankAccount",
  "SocureIdentityVerification", "SocureBankVerification", "PlaidBankAccount",
  "seamless-merchant-balance-snapshot",
  "seamless-pooled-funds-reconciliation", "JurisdictionVerificationLog",
  "Wallet", "SystemLedgerAccount"
] as const;

function respond(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}
async function countAll(entity: any) {
  let total = 0;
  for (let skip = 0; ; skip += 5000) {
    const page = await entity.list("created_date", 5000, skip, ["id"]);
    total += page.length;
    if (page.length < 5000) return total;
  }
}
async function deleteAll(entity: any) {
  let deleted = 0;
  for (;;) {
    const page = await entity.list("created_date", 500, 0, ["id"]);
    if (page.length === 0) return deleted;
    for (const record of page) {
      await entity.delete(record.id);
      deleted += 1;
    }
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);
    if (Date.now() > EXPIRES_AT) return respond({ error: "reset_window_expired" }, 410);
    if ((Deno.env.get("SEAMLESS_ACH_ENV") || "").toLowerCase() !== "sandbox") {
      return respond({ error: "sandbox_required" }, 409);
    }
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
    if (!constantTimeEqual(await sha256(token), EXPECTED_TOKEN_SHA256)) {
      return respond({ error: "unauthorized" }, 401);
    }
    const body = await req.json().catch(() => ({}));
    if (body.confirmation !== CONFIRMATION) {
      return respond({ error: "confirmation_required" }, 400);
    }
    if (body.mode !== "dry_run" && body.mode !== "execute") {
      return respond({ error: "invalid_mode" }, 400);
    }

    const base44 = createClientFromRequest(req);
    const service = base44.asServiceRole.entities as Record<string, any>;
    const results: Record<string, number> = {};
    for (const entityName of DELETE_ORDER) {
      const entity = service[entityName];
      results[entityName] = !entity ? 0 : body.mode === "dry_run"
        ? await countAll(entity)
        : await deleteAll(entity);
    }

    const users = await service.User.list("created_date", 5000, 0, ["id"]);
    let usersUpdated = 0;
    if (body.mode === "execute") {
      const updateResult = await service.User.updateMany({}, {
        $set: {
          identity_verification_status: "not_started",
          last_geolocation_status: "not_checked",
          jurisdiction_status: "unknown",
          jurisdiction_vpn_detected: false,
          games_played: 0, games_won: 0, games_lost: 0, win_percentage: 0,
          withdrawal_hold: false, account_state: "provisional"
        },
        $unset: {
          identity_verified_at: "", identity_verification_provider: "",
          identity_provider_reference: "", verified_id_hash: "",
          last_geolocation_checked_at: "", current_jurisdiction_state: "",
          current_jurisdiction_country: "", jurisdiction_last_verified_at: "",
          jurisdiction_verification_provider: ""
        }
      });
      usersUpdated = Number(updateResult?.updated || 0);
    }
    return respond({
      success: true, mode: body.mode, users_preserved: users.length,
      users_updated: usersUpdated, record_counts: results,
      preserved_entities: ["User", "PrivacyPolicyConfig", "GameSettings"],
      provider_calls: 0, published: false
    });
  } catch (error) {
    console.error("launch reset failed", error);
    return respond({
      success: false, error: "launch_reset_failed",
      message: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});
