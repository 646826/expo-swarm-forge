import { spawnSync } from 'node:child_process';
import { relative } from 'node:path';
import { ROOT, walkFiles } from './project-lib.mjs';

const tests = (await walkFiles(ROOT)).filter((path) => /[/\\]test[/\\].+\.test\.(?:js|mjs)$/.test(path) && !path.includes('/dist/')).map((path) => relative(ROOT, path));
if (tests.length === 0) throw new Error('No tests discovered');
const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: ROOT, stdio: 'inherit' });
process.exit(result.status ?? 1);
