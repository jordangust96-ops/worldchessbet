import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const scripts=JSON.parse(fs.readFileSync('package.json','utf8')).scripts;
const names=Object.keys(scripts).filter(name=>name.startsWith('test:'));
const results=[];
const logPath='/tmp/chessbet-challenge-regressions.log';
fs.writeFileSync(logPath,'ChessBet isolated regression checks\n');
for(const name of names){
  const result=spawnSync('npm',['run',name],{encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024});
  const passed=result.status===0;
  const output=String(result.stdout||'')+String(result.stderr||'');
  fs.appendFileSync(logPath,`\n=== ${name} (${passed?'PASS':'FAIL'}) ===\n${output}\n`);
  results.push({name,passed,status:result.status});
  console.log(`${passed?'PASS':'FAIL'} ${name}`);
  if(!passed)console.log(output.split('\n').filter(line=>/AssertionError|Error:|Unexpected| at file:|^\s*actual:|^\s*expected:/.test(line)).slice(0,5).join('\n'));
}
console.log(JSON.stringify({passed:results.filter(r=>r.passed).length,total:results.length,failed:results.filter(r=>!r.passed).map(r=>r.name),logPath},null,2));
process.exitCode=results.every(r=>r.passed)?0:1;
