// Source-only wiring; no live matches, payments, or user records are created.
import fs from 'node:fs';
const pending = new Map();
function edit(path, edits) {
  let s = fs.readFileSync(path,'utf8');
  for (const [before, after, all = false] of edits) {
    if (!s.includes(before)) throw new Error(`Expected source not found in ${path}: ${before.slice(0,80)}`);
    s = all ? s.split(before).join(after) : s.replace(before,after);
  }
  pending.set(path,s);
}
edit('src/AuthenticatedApplication.jsx',[
  ['const JoinMatch = lazy(() => import("@/pages/JoinMatch"));','const JoinMatch = lazy(() => import("@/pages/JoinMatch"));\nconst ChallengePage = lazy(() => import("@/pages/ChallengePage"));'],
  ['<Route path="/join/:inviteCode" element={<JoinMatch />} />','<Route path="/join/:inviteCode" element={<JoinMatch />} />\n        <Route path="/challenge/:inviteCode" element={<ChallengePage />} />'],
]);
edit('src/components/play/MatchView.jsx',[
  ['import PreparingMatchScreen from "@/components/play/matchview/PreparingMatchScreen";','import PreparingMatchScreen from "@/components/play/matchview/PreparingMatchScreen";\nimport ChallengeReadyScreen from "@/components/play/matchview/ChallengeReadyScreen";\nimport { challengeRequest } from "@/lib/challengeApi";'],
  ['    await base44.functions.invoke("cancelMatch", { matchId: matchToCancel.id });','    if (Number(matchToCancel.challenge_version) === 1) await challengeRequest("cancel", { matchId: matchToCancel.id });\n    else await base44.functions.invoke("cancelMatch", { matchId: matchToCancel.id });'],
  ['        <PreparingMatchScreen\n          match={match}','        <PreparationScreen\n          match={match}'],
  ['      stateKey = "preparing";\n      content = (','      stateKey = "preparing";\n      const PreparationScreen = Number(match.challenge_version) === 1 ? ChallengeReadyScreen : PreparingMatchScreen;\n      content = ('],
]);
edit('src/pages/Home.jsx',[
  ['import React, { useState, useEffect, useRef, useCallback } from "react";','import React, { useState, useEffect, useRef, useCallback } from "react";\nimport { useLocation, useNavigate } from "react-router-dom";'],
  ['export default function Home() {','export default function Home() {\n  const location = useLocation();\n  const navigate = useNavigate();'],
  ['  const [activeMatch, setActiveMatch] = useState(null);',`  const [activeMatch, setActiveMatch] = useState(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get('resumeChallenge');
    if (/^[a-f0-9]{32}$/.test(code || '')) { navigate('/challenge/' + code, { replace:true }); return; }
    const id = params.get('match');
    if (!user?.id || !/^[a-zA-Z0-9_-]{1,100}$/.test(id || '')) return;
    base44.entities.Match.get(id).then(match => {
      if (Number(match?.launch_epoch) === 2 && [match.player1_id,match.player2_id].includes(user.id) &&
          ['preparing','both_ready','in_progress','settling','completed'].includes(match.status)) {
        setMyMatchId(match.id); setActiveMatch(match);
      }
    }).catch(() => {});
  }, [location.search,user?.id,navigate]);`],
  ['{ launch_epoch: 2, player1_id: user.id }, "-created_date", 5','{ launch_epoch: 2, player1_id: user.id, status: { $in: ["preparing","both_ready","in_progress"] } }, "-created_date", 10',true],
  ['{ launch_epoch: 2, player2_id: user.id }, "-created_date", 5','{ launch_epoch: 2, player2_id: user.id, status: { $in: ["preparing","both_ready","in_progress"] } }, "-created_date", 10',true],
  ['  const handleRefreshActiveMatch = async () => {\n    if (!myMatchId) return;\n    const m = await base44.entities.Match.get(myMatchId);\n    setActiveMatch(m);\n  };','  const handleRefreshActiveMatch = useCallback(async () => {\n    if (!myMatchId) return;\n    const m = await base44.entities.Match.get(myMatchId);\n    setActiveMatch(m);\n  }, [myMatchId]);'],
  ['className="w-full min-w-0 min-h-0 lg:h-full lg:flex-[62_1_0%] lg:flex lg:flex-col lg:items-center lg:justify-center lg:overflow-hidden gap-3"','className={`${gameActive || boardState === "countdown" ? "w-full" : "hidden lg:flex"} min-w-0 min-h-0 lg:h-full lg:flex-[62_1_0%] lg:flex lg:flex-col lg:items-center lg:justify-center lg:overflow-hidden gap-3`}'],
]);
for(const [path,source] of pending)fs.writeFileSync(path,source);
console.log(`Connected challenge route, current-match restoration, and explicit readiness in ${pending.size} files.`);
