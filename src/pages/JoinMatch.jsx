import React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import SEO from '@/components/seo/SEO';

// Read-only compatibility route. The old UUID private-match flow no longer
// claims an opponent before funding. Never resurrect or silently convert a
// historical invitation into a newly authorized paid contest.
export default function JoinMatch() {
  const { inviteCode } = useParams();
  if (/^[a-f0-9]{32}$/.test(inviteCode || '')) return <Navigate to={`/challenge/${inviteCode}`} replace />;
  return <main className="flex min-h-screen items-center justify-center bg-[#0A0A0A] px-5 text-white">
    <SEO title="Challenge Invitation | ChessBet" description="Open or create a shared ChessBet challenge." noindex />
    <section className="max-w-md space-y-4 rounded-3xl border border-white/10 bg-white/[0.025] p-7 text-center">
      <h1 className="text-2xl font-bold">This invitation is no longer available</h1>
      <p className="text-sm leading-relaxed text-white/55">Ask the creator for a new challenge link. Your account and wallet remain available for other eligible matches.</p>
      <Link to="/play" className="inline-block rounded-xl gold-gradient px-5 py-3 font-semibold text-black">Challenge Someone</Link>
    </section>
  </main>;
}
