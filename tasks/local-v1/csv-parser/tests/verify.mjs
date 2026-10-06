import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const result=spawnSync(process.execPath,['/tests/checks.mjs'],{encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
console.log(result.stdout||''); console.error(result.stderr||'');
const passed=!result.error&&result.status===0;
writeFileSync('/logs/verifier/reward.txt',passed?'1':'0');
console.log(passed?'VERIFIED PASS':'VERIFIED FAIL');
