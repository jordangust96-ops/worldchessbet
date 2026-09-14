import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { Copy, Share2, Loader2, ArrowLeft, Clock, Check } from 'lucide-react';
import { Helmet } from 'react-helmet-async';
import ChallengeVisibilityToggle from '@/components/play/ChallengeVisibilityToggle';
import Logo from '@/components/Logo';
import SEO from '@/components/seo/SEO';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { setPostAuthRedirect } from '@/lib/postAuthRedirect';
import { challengeRequest, challengeLocationContext, challengeErrorMessage, handleChallengeGate,
  saveChallengeContext, CHALLENGE_TERMS, CHALLENGE_NOT_RESERVED, VALID_INVITE } from '@/lib/challengeApi';

const usd = value => `$${Number(value || 0).toFixed(2)}`;
const walletCodes = ['identity_required','bank_required','funds_required'];

export default function ChallengePanel({ inviteCode:providedInviteCode, embedded=false, onClose, onChanged }) {
  const params = useParams();
  const inviteCode = providedInviteCode || params.inviteCode;
  const location = useLocation();
  const marketplaceReview = new URLSearchParams(location.search).get("accept") === "1";
  const { user } = useAuth();
  const navigate = useNavigate();
  const path = `/challenge/${inviteCode}`;
  const returnPath = embedded ? `/play?challenge=${inviteCode}` : path;
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [stage, setStage] = useState('preview');
  const [readiness, setReadiness] = useState(null);
  const [creatorChecking, setCreatorChecking] = useState(false);
  const [agree, setAgree] = useState(false);
  const [now, setNow] = useState(Date.now());
  const card = view?.challenge;
  const creator = view?.role === 'player1';
  const open = card?.status === 'open';
  const creatorReady = card?.creatorReady && Date.parse(card.creatorReadyUntil || '') > now;
  const seconds = Math.max(0, Math.ceil((Date.parse(card?.creatorReadyUntil || '')-now)/1000));
  const shareUrl = `${window.location.origin}${path}`;

  const refresh = useCallback(async () => {
    if (!VALID_INVITE.test(inviteCode || '')) { setError('This challenge link is not valid.'); setLoading(false); return; }
    try {
      const data = await challengeRequest('view', { inviteCode });
      setView(data);
    } catch (err) { setError(challengeErrorMessage(err)); }
    finally { setLoading(false); }
  }, [inviteCode]);
  useEffect(() => {
    refresh();
    const update = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = setInterval(update, 15000);
    const clock = setInterval(() => setNow(Date.now()),1000);
    window.addEventListener('focus',update);
    window.addEventListener('online',update);
    return () => { clearInterval(timer); clearInterval(clock); window.removeEventListener('focus',update); window.removeEventListener('online',update); };
  }, [refresh,user?.id]);
  useEffect(() => {
    if (view?.participant && card?.status === 'claimed') navigate(`/play?match=${card.id}`, { replace:true });
  }, [view?.participant,card?.status,card?.id,navigate]);
  useEffect(() => {
    if (card?.status !== 'processing' || (!view?.participant && !view?.ownOperation)) return;
    let running = false;
    const recover = async () => {
      if (running || document.visibilityState !== 'visible') return;
      running = true;
      try { await challengeRequest('recover',{ inviteCode }); await refresh(); }
      catch { /* A lost response is recovered by the existing timeout sweep too. */ }
      finally { running = false; }
    };
    recover(); const timer = setInterval(recover,5000);
    return () => clearInterval(timer);
  }, [card?.status,view?.participant,view?.ownOperation,inviteCode,refresh]);

  // Show the creator's setup or explicit authorization directly; checking
  // eligibility here neither requests location nor authorizes any funds.
  useEffect(() => {
    if (!open || !user || (creator ? creatorReady : !marketplaceReview)) return;
    let cancelled = false;
    setCreatorChecking(true); setError('');
    challengeRequest('readiness', { inviteCode }).then(state => {
      if (cancelled) return;
      setReadiness(state);
      setStage(state.ready ? 'confirm' : 'setup');
    }).catch(err => {
      if (!cancelled) {
        setReadiness({ ready:false, reason:challengeErrorMessage(err) });
        setStage('setup');
        setError(challengeErrorMessage(err));
      }
    }).finally(() => { if (!cancelled) setCreatorChecking(false); });
    return () => { cancelled = true; setCreatorChecking(false); };
  }, [creator,open,creatorReady,inviteCode,marketplaceReview,user?.id]);

  useEffect(() => {
    if (!embedded && creator && open) navigate(`/play?challenge=${inviteCode}`, { replace:true });
  }, [embedded,creator,open,inviteCode,navigate]);

  const signedIn = () => {
    if (user) return true;
    setPostAuthRedirect(returnPath);
    navigate(`/register?returnTo=${encodeURIComponent(returnPath)}`);
    return false;
  };
  const withAction = async (name, callback) => {
    if (busy) return;
    setBusy(name); setError(''); setMessage('');
    try { await callback(); }
    catch (err) {
      if (!handleChallengeGate(err,navigate,returnPath)) {
        setError(challengeErrorMessage(err));
        const detail = err?.response?.data;
        if (walletCodes.includes(detail?.code)) setReadiness({ ...detail, ready:false });
      }
    } finally { setBusy(''); }
  };
  const begin = () => {
    if (!signedIn()) return;
    withAction('check',async () => {
      const state = await challengeRequest('readiness',{ inviteCode });
      setReadiness(state);
      setStage(state.ready ? 'confirm' : 'setup');
    });
  };
  const fund = () => {
    if (!signedIn()) return;
    withAction('wallet',async () => {
      saveChallengeContext(user.id,inviteCode);
      await challengeRequest('remember',{ inviteCode });
      navigate(`/wallet?challenge=${inviteCode}`);
    });
  };
  const commit = () => withAction(creator ? 'authorize' : 'accept',async () => {
    const context = await challengeLocationContext();
    const data = await challengeRequest(creator ? 'authorize' : 'accept',{
      inviteCode, agree, entryAmount:card.entryAmount, serviceFee:card.serviceFee, ...context,
    });
    if (data.accepted) navigate(`/play?match=${data.match.id}`);
    else if (data.processing) { setMessage(data.message); await refresh(); }
    else { setStage('preview'); setAgree(false); await refresh(); }
  });
  const copy = async () => {
    try { await navigator.clipboard.writeText(shareUrl); setMessage('Challenge link copied.'); }
    catch { setMessage('Select the link below and copy it.'); }
  };
  const share = async () => {
    if (!navigator.share) { await copy(); return; }
    try { await navigator.share({ title:`A ${usd(card.entryAmount)} ChessBet challenge`,
      text:`Think you can beat me? ${usd(card.entryAmount)} entry, separate service fee. First eligible, funded player to accept while I’m ready gets the match.`,url:shareUrl }); }
    catch (err) { if (err?.name !== 'AbortError') await copy(); }
  };

  const Container = embedded ? "div" : "main";
  return <Container className={embedded ? "space-y-4 text-white" : "min-h-screen bg-[#0A0A0A] px-5 py-7 text-white sm:py-12"}>
    {!embedded && <SEO title={card ? `${usd(card.entryAmount)} Chess Challenge | ChessBet` : 'Chess Challenge | ChessBet'} description="Open a ChessBet challenge, review the entry amount, and play someone you know. Eligibility and available funds are required." noindex />}
    {!embedded && <Helmet><meta name="referrer" content="no-referrer" /></Helmet>}
    <div className={embedded ? "space-y-4" : "mx-auto max-w-lg space-y-6"}>
      {embedded ? <button onClick={onClose} className="inline-flex items-center gap-1 text-sm text-white/50"><ArrowLeft size={15} />Challenges</button> : <div className="flex items-center justify-between gap-4"><Link to="/" aria-label="ChessBet"><Logo size="sm" /></Link>
        <Link to="/play" className="inline-flex items-center gap-1 text-sm text-white/50"><ArrowLeft size={15} />Play</Link></div>}
      {loading ? <div className="py-16 text-center"><Loader2 className="mx-auto animate-spin text-[#C9A84C]" /></div> : card ? <>
        <section className={embedded ? "space-y-4" : "space-y-5 rounded-3xl border border-[#C9A84C]/20 bg-gradient-to-br from-[#191610] to-[#111] p-5 sm:p-7"}>
          <div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-widest text-[#C9A84C]">{card.isRematch ? 'Rematch invitation' : 'Chess for money'}</p>
            <h1 className="text-2xl font-extrabold sm:text-3xl">{creator ? 'Your challenge is ready' : `${card.creatorName}’s challenge`}</h1>
            <p className="flex items-center gap-2 text-sm text-white/55"><Clock size={15} />{card.displayName} · No increment</p></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs text-white/55">Entry per player</p><p className="mt-1 text-3xl font-bold">{usd(card.entryAmount)}</p></div>
            <div className="rounded-2xl border border-[#C9A84C]/20 bg-[#C9A84C]/5 p-4"><p className="text-xs text-white/55">Winner award</p><p className="mt-1 text-3xl font-bold text-[#C9A84C]">{usd(card.winnerAward)}</p></div>
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-white/55">Your Entry Amount</dt><dd>{usd(card.entryAmount)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-white/55">Your Platform Service Fee</dt><dd>{usd(card.serviceFee)}</dd></div>
            <div className="flex justify-between gap-3 border-t border-white/10 pt-2 font-semibold"><dt>Total required per player</dt><dd>{usd(card.totalRequired)}</dd></div>
          </dl>
          <p className="text-xs leading-relaxed text-white/45">The winner award includes both players’ entry amounts. The fee is separate and returned if there is no decisive result. Standard settlement and winnings-release rules apply.</p>

          {open && creator && <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2"><Button onClick={share} className="h-11 rounded-xl gold-gradient font-bold text-black"><Share2 size={16} className="mr-2" />Share</Button>
              <Button onClick={copy} variant="outline" className="h-11 rounded-xl border-white/15 text-white"><Copy size={16} className="mr-2" />Copy Link</Button></div>
            <input aria-label="Your shareable challenge link" value={shareUrl} readOnly onFocus={e=>e.target.select()} className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-white/55" />
            <p className="text-sm leading-relaxed text-white/55">No funds are reserved yet. Share the link, keep playing elsewhere, or cancel it. An unfunded recipient cannot claim it.</p>
            <ChallengeVisibilityToggle checked={Boolean(card.publiclyListed)} disabled={Boolean(busy)} rematch={Boolean(card.isRematch)}
              onChange={publiclyListed=>withAction('visibility',async()=>{ await challengeRequest('visibility',{inviteCode,publiclyListed}); await refresh(); })} />
            {creatorReady && <div className="rounded-xl border border-[#C9A84C]/20 bg-[#C9A84C]/10 p-3 text-sm text-[#E5CA7A]">Acceptance enabled for {seconds} seconds. You are not locked into an opponent.</div>}
          </div>}
          {open && !creator && (!marketplaceReview || !user) && stage === 'preview' && <Button disabled={Boolean(busy)} onClick={begin} className="h-12 w-full rounded-2xl gold-gradient font-bold text-black">
            {busy === 'check' && <Loader2 size={16} className="mr-2 animate-spin" />}Accept Challenge
          </Button>}
          {open && (creatorChecking || busy === 'check') && <p role="status" className="flex items-center gap-2 text-sm text-white/55"><Loader2 size={16} className="animate-spin" />Checking your eligibility…</p>}
          {open && stage === 'setup' && <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
            <h2 className="font-bold">{readiness?.code === 'funds_required' ? 'Available funds required' : 'Complete your setup'}</h2>
            <p className="text-sm text-white/60">{readiness?.reason}</p>
            {readiness?.availableBalance != null && <p className="text-sm text-white/60">Available: {usd(readiness.availableBalance)} · Required: {usd(card.totalRequired)}</p>}
            <p className="text-xs leading-relaxed text-white/45">{CHALLENGE_NOT_RESERVED}</p>
            {walletCodes.includes(readiness?.code) ? <Button onClick={fund} disabled={Boolean(busy)} className="h-11 w-full rounded-xl gold-gradient text-black font-semibold">Open Wallet Setup</Button> : <Link to="/play" className="text-[#C9A84C]">Return to Play</Link>}
            <button onClick={begin} className="w-full py-1 text-sm text-white/50">Check again</button>
          </div>}
          {open && stage === 'confirm' && <div className="space-y-3">
            {!creator && !creatorReady && <div className="rounded-xl bg-white/5 p-3 text-sm text-white/60">The creator needs to confirm readiness. No opponent or funds are reserved.
              <button disabled={Boolean(busy)} onClick={()=>withAction('ping',async()=>{ const data=await challengeRequest('ping',{inviteCode}); setMessage(data.notified ? 'The creator was notified. The challenge is still open.' : 'A notification could not be sent. Share the link with the creator.'); })} className="mt-2 block font-semibold text-[#C9A84C]">Notify Creator</button></div>}
            <label className="flex items-start gap-3 rounded-xl border border-white/10 p-3 text-xs leading-relaxed text-white/65"><input type="checkbox" checked={agree} onChange={e=>setAgree(e.target.checked)} className="mt-1 h-4 w-4 shrink-0" />
              <span>{creator ? CHALLENGE_TERMS : `I agree to the Official Rules and Fair Play requirements and authorize ${usd(card.totalRequired)} (${usd(card.entryAmount)} entry plus ${usd(card.serviceFee)} fee) to be reserved only if both players qualify and the challenge is successfully claimed.`}</span></label>
            <Button disabled={!agree || Boolean(busy) || (!creator && !creatorReady)} onClick={commit} className="h-12 w-full rounded-2xl gold-gradient font-bold text-black disabled:opacity-40">
              {busy && <Loader2 size={16} className="mr-2 animate-spin" />}{creator ? 'Enable Acceptance for 2 Minutes' : `Accept & Reserve ${usd(card.totalRequired)}`}</Button>
            {creator && <p className="text-xs text-white/45">Enabling acceptance reserves nothing. Both players are checked again at final acceptance.</p>}
          </div>}
          {card.status === 'processing' && <div className="rounded-xl bg-white/5 p-4 text-sm text-white/65"><Loader2 size={16} className="mb-2 animate-spin" />Confirming the reservation result. Do not submit another payment.</div>}
          {!open && card.status !== 'processing' && <div className="space-y-3 rounded-2xl bg-white/5 p-4"><h2 className="font-bold">{card.status === 'expired' ? 'This challenge expired' : card.status === 'cancelled' ? 'This challenge was cancelled' : 'This challenge is no longer open'}</h2>
            <p className="text-sm text-white/55">Your wallet setup still counts. Create your own challenge or find another opponent.</p>
            <Link to="/play" className="block font-semibold text-[#C9A84C]">Create a Challenge →</Link><Link to="/play?mode=public" className="block text-sm text-white/55">Find an Opponent</Link></div>}
          {open && creator && <button disabled={Boolean(busy)} onClick={()=>withAction('cancel',async()=>{ await challengeRequest('cancel',{inviteCode}); await refresh(); await onChanged?.(); })} className="w-full py-2 text-sm text-white/45 hover:text-red-300">Cancel Open Challenge</button>}
          {open && <p className="text-center text-xs text-white/35">Expires {new Date(card.expiresAt).toLocaleString()}</p>}
        </section>
        <p className="text-center text-xs leading-relaxed text-white/40">Money play requires account, identity and location eligibility, a verified bank connection, and sufficient available funds. Pending deposits cannot be used to accept a challenge.</p>
      </> : <div className="rounded-2xl border border-white/10 p-6"><h1 className="text-xl font-bold">Challenge unavailable</h1><Link to="/play" className="mt-4 inline-block text-[#C9A84C]">Create your own challenge</Link></div>}
      {error && <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-300">{error}</p>}
      {message && <p role="status" className="flex items-start gap-2 rounded-xl bg-white/5 p-3 text-sm text-[#E5CA7A]"><Check size={16} className="mt-0.5 shrink-0" />{message}</p>}
      <div className="flex justify-center gap-5 text-xs text-white/40"><Link to="/official-rules">Official Rules</Link><Link to="/fair-play-integrity">Fair Play</Link><Link to="/terms-of-service">Terms</Link></div>
    </div>
  </Container>;
}
