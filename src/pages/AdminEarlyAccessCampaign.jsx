import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Mail, Send } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const ALLOWED_ADMIN_EMAIL = 'jordangust96@gmail.com';

export default function AdminEarlyAccessCampaign() {
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    base44.auth.me().then((user) => {
      setAuthorized(user?.role === 'admin' && user?.email === ALLOWED_ADMIN_EMAIL);
      setChecking(false);
    });
  }, []);

  const runCampaign = async () => {
    setRunning(true);
    setError('');
    try {
      const { data } = await base44.functions.invoke('early-access-500-campaign', {});
      setResult(data);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Campaign could not be completed.');
    } finally {
      setRunning(false);
    }
  };

  if (checking) return <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center"><Loader2 className="animate-spin text-[#C9A84C]" size={28} /></div>;
  if (!authorized) return <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center px-5 text-center text-white/70">Access restricted.</div>;

  return (
    <div className="min-h-screen bg-[#0A0A0A] px-5 py-10 text-white">
      <div className="max-w-xl mx-auto">
        <Link to="/profile" className="text-sm text-white/50 hover:text-white">← Back to profile</Link>
        <div className="mt-7 rounded-2xl border border-[#C9A84C]/30 bg-[#151310] p-6">
          <Mail className="text-[#C9A84C]" size={28} />
          <h1 className="mt-4 text-2xl font-extrabold">$500 Early Access campaign</h1>
          <p className="mt-2 text-sm leading-6 text-white/65">Sends the July 2026 campaign to the fixed snapshot of every current account, including the admin account. Each recipient is credited only if not already marked as credited.</p>
          <button onClick={runCampaign} disabled={running} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#C9A84C] px-5 py-3 font-bold text-[#0A0A0A] disabled:opacity-60">
            {running ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
            {running ? 'Sending campaign…' : 'Run campaign'}
          </button>
          {result && <pre className="mt-5 overflow-auto rounded-lg bg-black/30 p-4 text-xs text-emerald-300">{JSON.stringify(result, null, 2)}</pre>}
          {error && <p className="mt-5 text-sm text-red-300">{error}</p>}
        </div>
      </div>
    </div>
  );
}
