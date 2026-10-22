import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
for(const dir of ['backend/src','backend/test','scripts'])for(const name of readdirSync(dir))if(/\.(js|mjs)$/.test(name))execFileSync(process.execPath,['--check',join(dir,name)],{stdio:'inherit'});
console.log('JavaScript syntax OK');
