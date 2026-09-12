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
    {!choice.decided && !playing && !open && <section aria-label="Cookie choices" className="fixed bottom-4 left-3 right-3 z-[60] max-h-[80vh] overflow-y-auto rounded-2xl border border-white/20 bg-[#141414] p-6 text-white shadow-2xl sm:left-5 sm:right-auto sm:w-[460px]">
      <div className="flex flex-col gap-5">
        <div className="flex-1"><h2 className="text-xl font-semibold">Cookies & privacy</h2><p className="mt-1 text-sm text-white/75">We use essential cookies to keep ChessBet working. Choose Accept to allow optional cookies that measure site visits and advertising. You can change your choice anytime.</p>{choice.gpc && <p className="mt-2 text-sm text-[#C9A84C]">Your browser privacy signal keeps optional tracking off.</p>}<a href="/privacy-policy" className="mt-2 inline-block text-sm underline">Privacy policy</a></div>
        <div className="grid grid-cols-2 gap-3"><button className={button + " bg-[#C9A84C] text-black border-[#C9A84C] hover:bg-[#E8D48B]"} onClick={() => save(true,true)}>Accept</button><button className={button + " bg-[#C9A84C] text-black border-[#C9A84C] hover:bg-[#E8D48B]"} onClick={() => save(false,false)}>Reject</button><button className={button + " col-span-2"} onClick={openCookieSettings}>Preferences</button></div>
      </div>
    </section>}
    {choice.decided && !playing && !open && <section aria-label="Cookie shortcuts" className="fixed bottom-20 left-3 z-40 flex items-center gap-1 rounded-xl border border-white/20 bg-[#141414] p-2 text-xs text-white shadow-lg"><span className="px-2 text-white/70">Cookies</span><button className="rounded-lg px-3 py-2 font-semibold hover:bg-white/10" onClick={()=>save(true,true)}>Accept</button><button className="rounded-lg px-3 py-2 font-semibold hover:bg-white/10" onClick={()=>save(false,false)}>Reject</button><button className="rounded-lg px-3 py-2 underline hover:bg-white/10" onClick={openCookieSettings}>Preferences</button></section>}
    {message && <p role="status" className="fixed bottom-32 left-3 z-[70] max-w-xs bg-[#141414] p-3 text-sm text-white">{message}</p>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-y-auto border-white/20 bg-[#141414] text-white">
      <DialogHeader><DialogTitle>Cookie preferences</DialogTitle><DialogDescription className="text-white/70">Choose optional cookies for this browser. Essential account, security, and game storage stays enabled. Optional tracking is limited to public pages.</DialogDescription></DialogHeader>
      <div className="space-y-5 py-3">
        <div><p className="font-semibold">Essential — always on</p><p className="text-sm text-white/65">Login, MFA, security, requested game features, and remembering this choice.</p></div>
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5" checked={analytics && !choice.gpc} disabled={choice.gpc} onChange={e=>setAnalytics(e.target.checked)}/><span><strong>Analytics</strong><span className="block text-sm text-white/65">Helps us understand visits to public pages.</span></span></label>
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5" checked={marketing && !choice.gpc} disabled={choice.gpc} onChange={e=>setMarketing(e.target.checked)}/><span><strong>Advertising</strong><span className="block text-sm text-white/65">Helps measure advertising performance on public pages.</span></span></label>
        {choice.gpc && <p className="text-sm text-[#C9A84C]">Global Privacy Control is enabled. Optional tracking stays off.</p>}
        <p className="text-sm text-white/65">Your choice is remembered for 180 days. You can change it anytime.</p><details className="text-sm text-white/65"><summary className="cursor-pointer py-2 font-semibold text-white">More details</summary><div className="space-y-3 pt-2"><p>Google Analytics measures public-page visits using cookies lasting up to 180 days. Meta measures eligible public-page visits; its browser cookie typically lasts 90 days. Identity and contest details are not sent.</p><p>Session recording and HeyCatch tracking are disabled. Withdrawing consent stops future optional collection; it does not erase information already received by a provider.</p><a href="/privacy-policy" className="underline">Read our privacy policy</a></div></details>
      </div>
      <div className="sticky bottom-0 flex flex-wrap gap-2 bg-[#141414] py-2"><button className={button} onClick={()=>save(false,false)}>Reject</button><button className={button} onClick={()=>save(true,true)}>Accept</button><button className={button} onClick={()=>save(analytics,marketing)}>Save preferences</button></div>
    </DialogContent></Dialog>
  </>;
}
