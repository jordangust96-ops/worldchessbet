import React, {useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {challengeRequest,challengeErrorMessage} from '@/lib/challengeApi';
export default function MoneyPlayLocation(){
 const [result,setResult]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const pending=useRef(false);
 const check=async()=>{
  if(pending.current)return;pending.current=true;setBusy(true);setError('');
  try{setResult(await challengeRequest('money_location'));}catch(err){setError(challengeErrorMessage(err));}
  finally{pending.current=false;setBusy(false);}
 };
 return <div className="space-y-2 text-xs leading-relaxed text-white/60">
  <p>{result?.message || 'Free play needs no location, identity, bank, or wallet verification. Money play requires approved eligibility and cleared funds.'}</p>
  <button type="button" onClick={check} disabled={busy} className="font-semibold text-[#E5CA7A] disabled:opacity-50">{busy?'Checking location…':'Recheck Location'}</button>
  {result?.approved && <Link to="/wallet" className="ml-4 inline-block font-semibold text-[#E5CA7A]">Continue Wallet Setup</Link>}
  {error && <p role="alert" className="text-red-300">{error} Free play is still available.</p>}
 </div>;
}
