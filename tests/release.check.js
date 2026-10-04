import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
const binary=process.env.OPENRAILS_BACKEND_BIN;
assert(binary,'Set OPENRAILS_BACKEND_BIN to the updated OpenRails backend executable.');
const directory=mkdtempSync(join(tmpdir(),'bliza-release-'));
const port=process.env.OPENRAILS_TEST_PORT||'8799';
const env={...process.env,OPENRAILS_URL:`http://127.0.0.1:${port}`,OPENRAILS_TOKEN:randomBytes(32).toString('hex'),SEED_DEMO:'false'};
const config=join(directory,'config.json'); await Bun.write(config,'{}');
const backend=Bun.spawn([binary],{env:{...env,OPENRAILS_BIND:`127.0.0.1:${port}`,OPENRAILS_DB_PATH:join(directory,'backend.sqlite3'),OPENRAILS_FILES_DIR:join(directory,'files'),OPENRAILS_CONFIG:config,OPENRAILS_PUBLIC_URL:env.OPENRAILS_URL},stdout:'ignore',stderr:'inherit'});
async function command(args,extra={}) { const child=Bun.spawn(args,{env:{...env,...extra},stdout:'inherit',stderr:'inherit'});assert.equal(await child.exited,0,`Command failed: ${args.join(' ')}`); }
try {
	let ready=false;for(let i=0;i<100;i++){try{if((await fetch(`${env.OPENRAILS_URL}/health`)).ok){ready=true;break;}}catch{}await Bun.sleep(100);}
	assert(ready,'Temporary backend starts');
	await command([process.execPath,'test','src/lib/server/db.test.js']);
	await command([process.execPath,'run','build'],{ORIGIN:'http://127.0.0.1:4189'});
	await command([process.execPath,'tests/portal.check.js']);
	console.log(`PASS: isolated release checks. Temporary backend data: ${directory}`);
} finally { backend.kill();await backend.exited; }
