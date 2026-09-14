// Five US banking days from original initiation; never from Processed.
// Saturday Federal Reserve holidays are not observed on the preceding Friday.
function holiday(date) {
  const y=date.getUTCFullYear(), m=date.getUTCMonth()+1, d=date.getUTCDate(), w=date.getUTCDay();
  const fixed=[[1,1],[6,19],[7,4],[11,11],[12,25]];
  if(fixed.some(([month,day])=>m===month && (d===day || (d===day+1 && w===1 && new Date(Date.UTC(y,month-1,day)).getUTCDay()===0))))return true;
  return (m===1 && w===1 && d>=15 && d<=21) || (m===2 && w===1 && d>=15 && d<=21) ||
    (m===5 && w===1 && d+7>31) || (m===9 && w===1 && d<=7) ||
    (m===10 && w===1 && d>=8 && d<=14) || (m===11 && w===4 && d>=22 && d<=28);
}
export function bankWithdrawalAt(value) {
  if(!value)throw new Error('invalid_deposit_timestamp');
  // Base44 timestamps without an offset are UTC.
  const text=String(value), parsed=new Date(/[zZ]|[+-]\\d\\d:\\d\\d$/.test(text)?text:text+'Z');
  if(!Number.isFinite(parsed.getTime()))throw new Error('invalid_deposit_timestamp');
  let days=5;
  while(days){parsed.setUTCDate(parsed.getUTCDate()+1);if(![0,6].includes(parsed.getUTCDay())&&!holiday(parsed))days--;}
  return parsed.toISOString();
}
