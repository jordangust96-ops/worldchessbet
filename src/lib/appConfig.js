// Player-facing mirror of the backend Early Access switch. Keep this false
// for production-like sandbox testing; server-side eligibility remains
// authoritative regardless of this display value.
export const DEMO_MODE = false;

// Historical campaign amount, retained only for interpreting old records.
export const EARLY_ACCESS_STARTING_BALANCE = 500;