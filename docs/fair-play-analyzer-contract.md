# Fair Play Analyzer API contract

ChessBet creates one `FairPlayAnalysis` record after each settled contest and invokes the external analyzer only when all three Base44 environment variables are configured:

- `FAIR_PLAY_SCREENING_ENABLED=true`
- `FAIR_PLAY_ANALYZER_URL`
- `FAIR_PLAY_ANALYZER_SECRET`

## Request

`POST $FAIR_PLAY_ANALYZER_URL/v1/analyze`

Headers:

```
Authorization: Bearer $FAIR_PLAY_ANALYZER_SECRET
Content-Type: application/json
```

The request contains the authoritative PGN, move log with server timestamps and remaining clock time, time control, and browser-focus aggregates. It intentionally does not include player names, emails, payment data, or other unnecessary personal information.

## Response

```json
{
  "analyzer_version": "1.0.0",
  "stockfish_version": "17",
  "analysis_depth": 18,
  "summary": "Short internal summary",
  "white": {
    "eligible_moves": 14,
    "average_centipawn_loss": 22.4,
    "median_centipawn_loss": 16.0,
    "top_1_match_rate": 0.57,
    "top_3_match_rate": 0.79,
    "critical_move_match_rate": 0.50,
    "move_time_consistency": 0.28,
    "risk_score": 18,
    "risk_band": "cleared",
    "reasons": []
  },
  "black": {
    "eligible_moves": 14,
    "average_centipawn_loss": 14.1,
    "median_centipawn_loss": 9.0,
    "top_1_match_rate": 0.79,
    "top_3_match_rate": 0.93,
    "critical_move_match_rate": 0.80,
    "move_time_consistency": 0.81,
    "risk_score": 72,
    "risk_band": "review",
    "reasons": ["Unusually high engine agreement across difficult positions."]
  }
}
```

A `review` result creates an admin-only `engine_assistance_suspected` IntegrityFlag. It never changes a game outcome, balance, withdrawal hold, or account state automatically.
