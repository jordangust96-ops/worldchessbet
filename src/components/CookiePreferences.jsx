import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { privacy, openCookieSettings } from "@/lib/privacy";
const button = "rounded-lg border border-white/30 px-4 py-3 text-sm font-semibold hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C9A84C]";
export default function CookiePreferences() {
  const { pathname } = useLocation();
  const [choice, setChoice] = useState(() => privacy()?.choice() || {});
  const [open, setOpen] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const update = () => setChoice(privacy()?.choice() || {});
    const show = () => { const c = privacy()?.choice() || {}; setAnalytics(!!c.analytics); setMarketing(!!c.marketing); setOpen(true); };
    window.addEventListener("chessbet:privacy-change", update);
    window.addEventListener("chessbet:open-privacy", show);
    return () => { window.removeEventListener("chessbet:privacy-change", update); window.removeEventListener("chessbet:open-privacy", show); };
  }, []);
  function save(a, m) {
    const before = privacy()?.choice() || {};
    const persisted = privacy()?.save({ analytics:a, marketing:m });
    setOpen(false);
    if (persisted === false) setMessage("Your choice applies to this visit. Browser settings prevented us from saving it.");
    if (window.__chessbetTrackingLoaded && ((before.analytics && !a) || (before.marketing && !m))) location.reload();
  }
  const playing = pathname === "/play";
  return <>
    {!choice.decided && !playing && <section aria-label="Cookie choices" className="fixed bottom-0 inset-x-0 z-[60] border-t border-white/20 bg-[#141414] p-5 text-white shadow-2xl">
      <div className="mx-auto max-w-5xl flex flex-col gap-4 md:flex-row md:items-center">
        <div className="flex-1"><h2 className="font-semibold">Your privacy choices</h2><p className="mt-1 text-sm text-white/75">Essential storage keeps ChessBet working. With your permission, we use analytics and advertising cookies on public pages. You can change your choice anytime.</p>{choice.gpc && <p className="mt-2 text-sm text-[#C9A84C]">Your browser privacy signal keeps optional tracking off.</p>}<a href="/privacy-policy" className="mt-2 inline-block text-sm underline">Privacy policy</a></div>
        <div className="flex flex-wrap gap-2"><button className={button} onClick={() => save(false,false)}>Reject optional</button><button className={button} onClick={() => save(true,true)}>Accept optional</button><button className={button} onClick={openCookieSettings}>Manage preferences</button></div>
      </div>
    </section>}
    {!playing && <button onClick={openCookieSettings} className="fixed bottom-20 left-3 z-40 rounded-lg border border-white/20 bg-[#141414] px-3 py-2 text-xs text-white/80">Cookie settings</button>}
    {message && <p role="status" className="fixed bottom-32 left-3 z-[70] max-w-xs bg-[#141414] p-3 text-sm text-white">{message}</p>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-y-auto border-white/20 bg-[#141414] text-white">
      <DialogHeader><DialogTitle>Cookie preferences</DialogTitle><DialogDescription className="text-white/70">Choose optional cookies for this browser. Essential account, security, and game storage stays enabled. Optional tracking is limited to public pages.</DialogDescription></DialogHeader>
      <div className="space-y-5 py-3">
        <div><p className="font-semibold">Essential — always on</p><p className="text-sm text-white/65">Login, MFA, security, requested game features, and remembering this choice.</p></div>
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5" checked={analytics && !choice.gpc} disabled={choice.gpc} onChange={e=>setAnalytics(e.target.checked)}/><span><strong>Analytics</strong><span className="block text-sm text-white/65">Google Analytics measures public-page visits. Cookies last up to 180 days.</span></span></label>
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5" checked={marketing && !choice.gpc} disabled={choice.gpc} onChange={e=>setMarketing(e.target.checked)}/><span><strong>Advertising</strong><span className="block text-sm text-white/65">Meta measures visits to public pages without URL parameters. Its browser cookie typically lasts 90 days. Identity and contest details are not sent.</span></span></label>
        {choice.gpc && <p className="text-sm text-[#C9A84C]">Global Privacy Control is enabled. Optional tracking stays off.</p>}
        <p className="text-sm text-white/65">Session recording and HeyCatch tracking are disabled. Your choice is remembered for 180 days. Withdrawing consent stops future optional collection; it does not erase information already received by a provider.</p>
      </div>
      <div className="flex flex-wrap gap-2"><button className={button} onClick={()=>save(false,false)}>Reject optional</button><button className={button} onClick={()=>save(true,true)}>Accept optional</button><button className={button} onClick={()=>save(analytics,marketing)}>Save preferences</button></div>
    </DialogContent></Dialog>
  </>;
}
