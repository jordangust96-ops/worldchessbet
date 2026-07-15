// Shared display labels/colors for integrity flags — kept in one place so the
// Review Queue, user detail page, and contest badge stay consistent.

export const FLAG_TYPE_LABELS = {
  repeated_opponent_pairing: "Repeated Opponent Pairing",
  unusual_resignation_pattern: "Unusual Resignation Pattern",
  unusual_timeout_pattern: "Unusual Timeout Pattern",
  high_number_short_contests: "High Number of Short Contests",
  multiple_accounts_same_email_domain: "Multiple Accounts, Same Email Domain",
  same_ip_multiple_accounts: "Same IP, Multiple Accounts",
  same_device_fingerprint: "Same Device Fingerprint",
  rapid_deposit_contest_withdrawal: "Rapid Deposit → Contest → Withdrawal",
  repeated_payment_failures: "Repeated Payment Failures",
  chargeback: "Chargeback",
  vpn_detected: "VPN Detected",
  geolocation_mismatch: "Geolocation Mismatch",
  manual: "Manually Flagged",
};

export const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

export const SEVERITY_STYLES = {
  high: "bg-red-500/10 text-red-400 border-red-500/20",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  low: "bg-white/5 text-white/50 border-white/10",
};

export const STATUS_STYLES = {
  open: "bg-[#C9A84C]/10 text-[#C9A84C] border-[#C9A84C]/20",
  under_review: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  cleared: "bg-green-500/10 text-green-400 border-green-500/20",
  action_taken: "bg-white/10 text-white/70 border-white/15",
};

export const STATUS_LABELS = {
  open: "Open",
  under_review: "Under Review",
  cleared: "Cleared",
  action_taken: "Action Taken",
};