// Applies reviewed source changes only. Does not query or mutate application data.
import fs from 'node:fs';
const files=new Map();
function edit(path,changes){let source=fs.readFileSync(path,'utf8');for(const [before,after] of changes){if(!source.includes(before))throw Error(`Expected source missing: ${path}: ${before.slice(0,60)}`);source=source.replace(before,after);}files.set(path,source);}
edit('src/pages/WalletPage.jsx',[
  ['import SeamlessFundingPanel from "@/components/wallet/SeamlessFundingPanel";','import SeamlessFundingPanel from "@/components/wallet/SeamlessFundingPanel";\nimport ChallengeFundingContext from "@/components/wallet/ChallengeFundingContext";'],
  ['        <SeamlessFundingPanel','        <ChallengeFundingContext userId={userId} availableBalance={wallet?.available_balance || 0} />\n\n        <SeamlessFundingPanel'],
]);
edit('src/components/play/HostMatchSection.jsx',[
  ['import { Loader2, Wallet, Lock } from "lucide-react";','import { Loader2, Wallet } from "lucide-react";'],
  ['  const handleHost = async (isPrivate) => {','  const handleHost = async () => {'],
  ['        isPrivate,','        isPrivate: false,'],
  ['        if (isPrivate) {\n          base44.analytics.track({ eventName: "private_game_link_created", properties: { wager_amount: wagerValue, time_control: timeControl } });\n          trackPixelEvent("Private Game Link Created", { value: wagerValue, currency: "USD", time_control: timeControl });\n        }\n',''],
  ['          <Button\n            onClick={() => handleHost(true)}\n            disabled={!wagerValue || hosting || disabled || launchClosed || noFunds || !canAffordTotal}\n            variant="outline"\n            className="w-full h-12 lg:h-9 lg:text-sm rounded-2xl font-bold border-white/10 text-white/70 hover:bg-white/5 hover:text-white disabled:opacity-30 transition-colors"\n          >\n            {hosting ? <Loader2 className="animate-spin mr-2" size={16} /> : <Lock size={14} className="mr-2" />}\n            Create a Private Challenge\n          </Button>\n',''],
  ['onClick={() => handleHost(false)}','onClick={handleHost}'],
  ['// A single wager/time-control configuration, published either publicly (to\n// the marketplace) or privately (via an invite link) — same Match, same\n// escrow/gameplay/settlement flow either way. Only the publish button differs.','// Public marketplace creation only. Shareable invitations use the separate\n// challenge-first invitation controller and the same underlying match engine.'],
  ['Create a Challenge</h3>','Post a Public Match</h3>'],
  ['Fund your wallet to host or accept a challenge.','Available funds are required to post or accept a public match.'],
]);
edit('src/components/play/AvailableMatchSection.jsx',[
  ['  const insufficientFunds = current ? (balance || 0) < current.wager_amount : false;','  const insufficientFunds = current ? (balance || 0) < Number(current.wager_amount) + Number(current.platform_service_fee || 0) : false;'],
]);
edit('src/AuthenticatedApplication.jsx',[
  ['const AdminSiteHealth = lazy(() => import("@/pages/AdminSiteHealth"));','const AdminSiteHealth = lazy(() => import("@/pages/AdminSiteHealth"));\nconst AdminChallenges = lazy(() => import("@/pages/AdminChallenges"));'],
  ['<Route path="/admin/health" element={<AdminSiteHealth />} />','<Route path="/admin/health" element={<AdminSiteHealth />} />\n                  <Route path="/admin/challenges" element={<AdminChallenges />} />'],
]);
edit('src/components/profile/AdminToolsSection.jsx',[
  ['          <ToolCard to="/admin/health" icon={BarChart3} label="Site Health" description="Review connection health, alerts, and capacity warnings." />','          <ToolCard to="/admin/health" icon={BarChart3} label="Site Health" description="Review connection health, alerts, and capacity warnings." />\n          <ToolCard to="/admin/challenges" icon={BellRing} label="Challenge Operations" description="Inspect invitations, acceptance, dual reservations, no-show releases and recovery." />'],
]);
edit('src/components/play/matchview/SettlementState.jsx',[
  ['import ReportContestButton from "@/components/disputes/ReportContestButton";','import ReportContestButton from "@/components/disputes/ReportContestButton";\nimport CreateChallengeForm from "@/components/play/CreateChallengeForm";'],
  ['  const [returning, setReturning] = useState(false);','  const [returning, setReturning] = useState(false);\n  const [rematch, setRematch] = useState(false);'],
  ['  return (\n    <div className="space-y-5 lg:space-y-3 text-center py-4">','  if (rematch) return <div className="py-3"><CreateChallengeForm initialAmount={match.wager_amount} rematchOf={match.id} onCancel={() => setRematch(false)} /></div>;\n\n  return (\n    <div className="space-y-5 lg:space-y-3 text-center py-4">'],
  ['      <p className="text-xs text-white/30">Wallet Updated</p>','      <p className="text-xs text-white/40">{won && !draw ? "Winner awards follow the standard report-window hold before becoming available. A rematch needs a separate available balance." : "Wallet updated"}</p>'],
  ['      <div className="space-y-2">\n        <Button','      <div className="space-y-2">\n        <Button onClick={() => setRematch(true)} className="w-full h-12 rounded-2xl font-bold gold-gradient text-black">Run It Back</Button>\n        <Button'],
  ['"Return to Marketplace"','"Challenge Someone Else"'],
]);
// Legacy endpoints must not leak service-role operation data or bypass the
// MFA-aware controller for new invitation cancellation and start actions.
edit('base44/functions/cancelMatch/entry.ts',[
  ["import { cancelChallenge } from '../../shared/challengeLifecycle.ts';\n",''],
  ["    if (Number(match.challenge_version) === 1) return Response.json(await cancelChallenge(base44, user, match.id));","    if (Number(match.challenge_version) === 1) return Response.json({ error: 'Use the challenge screen to cancel this invitation.', action: 'challenge_link_required' }, { status: 409 });"],
]);
edit('base44/functions/finalizeMatchStart/entry.ts',[
  ["import { finalizeChallengeStart } from '../../shared/challengeLifecycle.ts';\n",''],
  ["    if (Number(match.challenge_version) === 1) return Response.json(await finalizeChallengeStart(base44, user, match.id));","    if (Number(match.challenge_version) === 1) return Response.json({ error: 'Use the challenge readiness screen to start this match.', action: 'challenge_link_required' }, { status: 409 });"],
]);
for(const [path,source] of files)fs.writeFileSync(path,source);
console.log(`Wired ${files.size} frontend and compatibility files; public matchmaking preserved, old private submission removed.`);
