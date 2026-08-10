import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

const ACTIVE_STATUSES = ['open', 'under_review'];
const PRIORITY_WEIGHT = { high: 3, medium: 2, low: 1 };
const BAND_LABEL = {
  cleared: 'Cleared',
  monitor: 'Monitor',
  review: 'Review',
  insufficient_data: 'Insufficient data',
};

function sideEvidence(analysis, match, userId) {
  if (!analysis || analysis.status !== 'completed' || !match || !userId) return null;
  const side = match.player1_id === userId ? 'white' : match.player2_id === userId ? 'black' : null;
  if (!side) return null;

  return {
    status: analysis.status,
    band: analysis[`${side}_risk_band`] || 'insufficient_data',
    score: analysis[`${side}_risk_score`] ?? null,
    reasons: analysis[`${side}_screening_reasons`] || [],
    eligibleMoves: analysis[`${side}_eligible_moves`] ?? 0,
    timingSamples: analysis[`${side}_timing_sample_count`] ?? 0,
    centipawnLossSamples: analysis[`${side}_centipawn_loss_sample_count`] ?? 0,
    rankedSamples: analysis[`${side}_ranked_engine_move_sample_count`] ?? 0,
    criticalPositions: analysis[`${side}_critical_position_count`] ?? 0,
    analyzedAt: analysis.analyzed_at || analysis.updated_date || analysis.created_date || null,
  };
}

function fairPlayRecommendation(evidence) {
  if (!evidence) {
    return {
      recommendation: 'Run or retry automated screening, then perform a manual evidence review.',
      rationale: 'No completed screening result is available for the reported player in this contest.',
    };
  }

  if (evidence.band === 'cleared') {
    return {
      recommendation: 'Review the report, then resolve as no violation if no contradictory evidence is present.',
      rationale: 'Automated fair-play screening did not identify a review-level signal. This supports closure without action, but the report and any attachments still require administrator confirmation.',
    };
  }

  if (evidence.band === 'review') {
    return {
      recommendation: 'Continue an integrity investigation before resolving the case.',
      rationale: 'Automated screening produced a review-level signal. Examine the screening reasons, match replay, timing, and related history before deciding whether action is warranted.',
    };
  }

  if (evidence.band === 'monitor') {
    return {
      recommendation: 'Compare related contests and seek corroborating evidence before deciding.',
      rationale: 'Automated screening found a signal worth monitoring, but it is not sufficient by itself to support enforcement.',
    };
  }

  return {
    recommendation: 'Complete a manual review; automated evidence is inconclusive.',
    rationale: 'The screening did not have enough usable positions or samples to reach a reliable fair-play assessment.',
  };
}

function disputeRecommendation(dispute, evidence) {
  if (dispute.report_category === 'fair_play' || dispute.fair_play_review_flag) {
    return fairPlayRecommendation(evidence);
  }

  if (dispute.report_category === 'technical_issue') {
    return {
      recommendation: 'Inspect the authoritative game, clock, reconnect, and settlement records before resolving.',
      rationale: 'Technical reports require comparison against server-side game evidence. Player descriptions alone should not determine a contest or financial outcome.',
    };
  }

  if (dispute.report_category === 'collusion') {
    return {
      recommendation: 'Compare opponent history, contest patterns, and related accounts before deciding.',
      rationale: 'Collusion requires corroborating behavior across contests or accounts; a single report is not enough for enforcement.',
    };
  }

  if (dispute.report_category === 'harassment') {
    return {
      recommendation: 'Review the report and attachments, then document whether the conduct policy was violated.',
      rationale: 'This decision depends on the reported communications or conduct rather than chess-engine analysis.',
    };
  }

  if (dispute.report_category === 'rules_violation') {
    return {
      recommendation: 'Compare the reported conduct with the Official Rules and record the supporting evidence.',
      rationale: 'A rules decision should cite the applicable rule and verified contest facts.',
    };
  }

  return {
    recommendation: 'Review the report, attachments, and contest record before selecting a resolution.',
    rationale: 'The available category does not support a narrower automated recommendation.',
  };
}

function flagRecommendation(flag, evidence) {
  if (flag.flag_type === 'engine_assistance_suspected') {
    const result = fairPlayRecommendation(evidence);
    if (evidence?.band === 'cleared') {
      return {
        recommendation: 'Consider clearing this flag if no contradictory evidence is present.',
        rationale: result.rationale,
      };
    }
    return result;
  }

  if (flag.flag_type === 'duplicate_identity_document' || flag.flag_type === 'same_device_fingerprint' || flag.flag_type === 'same_ip_multiple_accounts') {
    return {
      recommendation: 'Compare the linked accounts and identity evidence before clearing or taking action.',
      rationale: 'A shared identifier is an investigative lead, not proof by itself. Confirm whether a legitimate shared household or device explanation exists.',
    };
  }

  if (flag.flag_type === 'chargeback' || flag.flag_type === 'rapid_deposit_contest_withdrawal' || flag.flag_type === 'repeated_payment_failures') {
    return {
      recommendation: 'Review the account ledger and payment history before deciding.',
      rationale: 'Financial integrity flags require verified transaction evidence and should not be resolved from behavioral inference alone.',
    };
  }

  if (flag.flag_type === 'vpn_detected' || flag.flag_type === 'geolocation_mismatch') {
    return {
      recommendation: 'Compare recent jurisdiction and verification history before deciding.',
      rationale: 'Location signals can have benign explanations and require corroboration before account action.',
    };
  }

  return {
    recommendation: 'Review related contests and user history; clear isolated signals that lack corroboration.',
    rationale: 'This behavioral flag is a review indicator and is not, by itself, proof of a violation.',
  };
}

function evidenceFacts(evidence) {
  if (!evidence) return ['No completed automated screening is available for this player and contest.'];
  const facts = [
    `Automated screening: ${BAND_LABEL[evidence.band] || evidence.band}${evidence.score == null ? '' : ` (risk score ${evidence.score})`}.`,
    `Coverage: ${evidence.eligibleMoves} eligible moves, ${evidence.centipawnLossSamples} CPL samples, ${evidence.rankedSamples} ranked samples, ${evidence.criticalPositions} critical positions.`,
  ];
  if (evidence.reasons?.length) facts.push(`Screening reasons: ${evidence.reasons.join('; ')}`);
  return facts;
}

function priorityForDispute(dispute, evidence) {
  if (dispute.escalated || dispute.priority === 'high' || evidence?.band === 'review') return 'high';
  if (dispute.priority === 'low' && !dispute.fair_play_review_flag) return 'low';
  return 'medium';
}

function priorityForFlag(flag, evidence) {
  if (flag.severity === 'high' || evidence?.band === 'review') return 'high';
  return flag.severity || 'medium';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const admin = await base44.auth.me();
    if (!admin) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (admin.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const service = base44.asServiceRole.entities;
    const [openCases, reviewCases, openFlags, reviewFlags] = await Promise.all([
      service.DisputeCase.filter({ status: 'open' }, '-created_date'),
      service.DisputeCase.filter({ status: 'under_review' }, '-created_date'),
      service.IntegrityFlag.filter({ status: 'open' }, '-created_date'),
      service.IntegrityFlag.filter({ status: 'under_review' }, '-created_date'),
    ]);

    const cases = [...openCases, ...reviewCases]
      .filter((item) => !item.assigned_admin_id || item.assigned_admin_id === admin.id)
      .slice(0, 100);
    const flags = [...openFlags, ...reviewFlags]
      .filter((item) => !item.assigned_admin_id || item.assigned_admin_id === admin.id)
      .slice(0, 100);

    const matchIds = [...new Set([...cases, ...flags].map((item) => item.match_id).filter(Boolean))];
    const userIds = [...new Set(flags.map((item) => item.user_id).filter(Boolean))];

    const [matchEntries, analysisEntries, userEntries] = await Promise.all([
      Promise.all(matchIds.map(async (id) => [id, await service.Match.get(id).catch(() => null)])),
      Promise.all(matchIds.map(async (id) => {
        const rows = await service.FairPlayAnalysis.filter({ match_id: id }, '-created_date').catch(() => []);
        return [id, rows.find((row) => row.status === 'completed') || rows[0] || null];
      })),
      Promise.all(userIds.map(async (id) => [id, await service.User.get(id).catch(() => null)])),
    ]);

    const matches = new Map(matchEntries);
    const analyses = new Map(analysisEntries);
    const users = new Map(userEntries);
    const items = [];

    for (const dispute of cases) {
      const match = matches.get(dispute.match_id) || null;
      const analysis = analyses.get(dispute.match_id) || null;
      const evidence = sideEvidence(analysis, match, dispute.reported_user_id);
      const guidance = disputeRecommendation(dispute, evidence);
      const priority = priorityForDispute(dispute, evidence);
      const facts = [
        `Player report: ${(dispute.report_category || 'other').replaceAll('_', ' ')}.`,
        dispute.reported_user_username ? `Reported player: ${dispute.reported_user_username}.` : 'No opposing player was identified in the report.',
        ...evidenceFacts(evidence),
      ];

      items.push({
        id: `dispute:${dispute.id}`,
        record_id: dispute.id,
        type: 'dispute',
        priority,
        urgent: priority === 'high',
        title: `Case #CB-${String(dispute.case_number || '').padStart(6, '0')}`,
        subtitle: dispute.report_subcategory || (dispute.report_category || 'Player report').replaceAll('_', ' '),
        status: dispute.status,
        assigned_to_me: dispute.assigned_admin_id === admin.id,
        created_at: dispute.created_date,
        route: `/admin/disputes/${dispute.id}`,
        recommendation: guidance.recommendation,
        rationale: guidance.rationale,
        facts,
        evidence,
      });
    }

    for (const flag of flags) {
      const match = matches.get(flag.match_id) || null;
      const analysis = analyses.get(flag.match_id) || null;
      const evidence = sideEvidence(analysis, match, flag.user_id);
      const guidance = flagRecommendation(flag, evidence);
      const priority = priorityForFlag(flag, evidence);
      const user = users.get(flag.user_id);

      items.push({
        id: `flag:${flag.id}`,
        record_id: flag.id,
        type: 'integrity_flag',
        priority,
        urgent: priority === 'high',
        title: user?.full_name || user?.username || user?.email || 'Player integrity review',
        subtitle: (flag.flag_type || 'Integrity flag').replaceAll('_', ' '),
        status: flag.status,
        assigned_to_me: flag.assigned_admin_id === admin.id,
        created_at: flag.created_date,
        route: `/admin/integrity/${flag.user_id}`,
        recommendation: guidance.recommendation,
        rationale: guidance.rationale,
        facts: [
          `Integrity flag: ${(flag.flag_type || 'manual').replaceAll('_', ' ')} (${flag.severity || 'low'} severity).`,
          ...evidenceFacts(evidence),
        ],
        evidence,
      });
    }

    items.sort((a, b) => {
      const priorityDelta = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
      if (priorityDelta) return priorityDelta;
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });

    return Response.json({
      generated_at: new Date().toISOString(),
      count: items.length,
      urgent_count: items.filter((item) => item.urgent).length,
      assigned_to_me_count: items.filter((item) => item.assigned_to_me).length,
      dispute_count: items.filter((item) => item.type === 'dispute').length,
      integrity_flag_count: items.filter((item) => item.type === 'integrity_flag').length,
      items,
      notice: 'Recommendations are decision support only. An administrator must verify the evidence and take every case, flag, account, enforcement, and financial action manually.',
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unable to load admin actions' }, { status: 500 });
  }
});
