import { CHALLENGE_TIME_CONTROLS } from '../../../base44/shared/challengePolicy.js';

const STATUS_TEXT = { provisional: 'Provisional', updating: 'Updating' };

export default function HostRating({ timeControl, status, rating }) {
  const control = CHALLENGE_TIME_CONTROLS.find(item => item.value === timeControl);
  if (!control) return null;

  const value = status === 'established' && Number.isFinite(rating)
    ? rating.toLocaleString()
    : STATUS_TEXT[status] ?? 'Unavailable';

  return <p className="text-xs text-white/50">
    {control.label} rating:{' '}<span className="font-semibold text-white/70">{value}</span>
  </p>;
}
