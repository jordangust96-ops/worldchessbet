import React, { useState, useEffect, useRef } from "react";
import { Switch } from "@/components/ui/switch";
import { base44 } from "@/api/base44Client";

export default function NotifyOnAcceptToggle({ match, onChanged }) {
  const [enabled,setEnabled]=useState(match?.notify_on_accept!==false);
  const [saving,setSaving]=useState(false),[error,setError]=useState('');
  const busy=useRef(false);
  useEffect(()=>{if(!busy.current)setEnabled(match?.notify_on_accept!==false);},[match?.id,match?.notify_on_accept]);
  const toggle=async checked=>{
    if(busy.current)return;
    const previous=enabled;
    busy.current=true;setSaving(true);setError('');setEnabled(checked);
    try{
      const {data}=await base44.functions.invoke('updateMatchPreference',{matchId:match.id,notifyOnAccept:checked});
      setEnabled(data.notifyOnAccept);
      await onChanged?.();
    }catch{
      setEnabled(previous);setError('Could not save your email preference. Please try again.');
    }finally{busy.current=false;setSaving(false);}
  };
  return <div className="space-y-2 border-t border-white/[0.06] pt-3">
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="text-sm text-white/65">Email me when accepted</span>
      <Switch aria-label="Email me when accepted" checked={enabled} disabled={saving} onCheckedChange={toggle} />
    </label>
    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
  </div>;
}
