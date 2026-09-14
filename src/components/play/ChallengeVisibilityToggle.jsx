import React from 'react';
import { Switch } from '@/components/ui/switch';

export default function ChallengeVisibilityToggle({ checked, onChange, disabled=false, rematch=false }) {
  return <div className="space-y-2 rounded-xl border border-white/10 p-3">
    <label className="flex items-center justify-between gap-4 text-sm font-semibold text-white">
      <span>Show in Find an Opponent</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled || rematch} aria-label="Show in Find an Opponent" />
    </label>
    <p className="text-xs leading-relaxed text-white/50">{rematch
      ? 'This rematch is only for your previous opponent.'
      : checked
        ? 'Anyone browsing Find an Opponent or using your link can accept. The first eligible player to accept gets the match.'
        : 'Only people with your link can find and accept this challenge.'}</p>
  </div>;
}
