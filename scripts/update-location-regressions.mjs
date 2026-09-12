import fs from 'node:fs';
function change(p,fn){fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8')));}
change('scripts/validate-jurisdiction-gates.mjs',s=>s.replace('  user_id: UID,','  country_confidence:99, subdivision_confidence:99, accuracy_radius_km:5, vpn_or_proxy_detected:false,\n  user_id: UID,').replace("CONFIDENCE', 10)","CONFIDENCE', 90)"));
change('scripts/validate-match-location.mjs',s=>s.replace("  trigger_event:'match_readiness', verification_result", "  country_confidence:99, subdivision_confidence:99, accuracy_radius_km:5,\n  trigger_event:'match_readiness', verification_result").replace("confidence:99}],traits:{}", "confidence:99}],location:{accuracy_radius:5},traits:{}")
.replaceAll('stateConfidence:10','stateConfidence:90').replaceAll('stateConfidence:9,','stateConfidence:89,').replace("override:'30'","override:'95'")
.replace("subdivisions:[{iso_code:c.state||'GA',confidence:c.stateConfidence}],traits:", "subdivisions:[{iso_code:c.state||'GA',confidence:c.stateConfidence}],location:{accuracy_radius:c.radius??5},traits:")
.replace("  {stateConfidence:90,countryConfidence:99,expected:'approved'},", "  {stateConfidence:10,countryConfidence:99,radius:1000,expected:'verification_failed'},\n  {stateConfidence:99,countryConfidence:99,radius:1000,expected:'verification_failed'},\n  {stateConfidence:90,countryConfidence:99,expected:'approved'},")
.replace("State confidence: 9 boundary cases passed, including 10% acceptance, country floor, VPN and region restrictions.","State confidence: 11 boundary cases passed, including false GA approval, radius, country, VPN and region restrictions."));
change('scripts/validate-wallet-onboarding-location.mjs',s=>s.replace("const {exports:location} = await loadBackend('base44/shared/walletOnboardingLocation.ts');","import * as gates from '../base44/shared/jurisdictionGates.js';\nimport * as regions from '../base44/shared/jurisdictionRegions.js';\nconst {exports:location} = await loadBackend('base44/shared/walletOnboardingLocation.ts',{'./jurisdictionGates.js':gates,'./jurisdictionRegions.js':regions});")
.replace("const evidence = (patch={}) => ({","const evidence = (patch={}) => ({country_confidence:99,subdivision_confidence:99,accuracy_radius_km:5,")
.replace("for(const patch of [{user_id:'other'},","for(const patch of [{subdivision_confidence:10,accuracy_radius_km:1000},{subdivision_confidence:89},{accuracy_radius_km:101},{geo_mismatch_flag:true},{detected_state:'MI'},{user_id:'other'},"));
change('scripts/validate-site-activity.mjs',s=>s.replace("const locationSource =", "import {hasReliableLocationEvidence} from '../base44/shared/jurisdictionGates.js';\nimport {isLocationApproved} from '../base44/shared/jurisdictionRegions.js';\nconst locationSource =")
.replace(".replaceAll('export ', '');",".replaceAll('export ', '').replace(/^import .*;$/gm,'');")
.replace('vm.createContext({Date})','vm.createContext({Date,hasReliableLocationEvidence,isLocationApproved})')
.replace("const loc={id:'loc'","const loc={country_confidence:99,subdivision_confidence:99,accuracy_radius_km:5,id:'loc'")
.replace("detected_state:'MI'","detected_state:'GA'"));
console.log('Regression fixtures updated with genuine high-quality evidence.');
