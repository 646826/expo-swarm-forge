import { relative, resolve, sep } from 'node:path';

import { verifySnapshot } from './arkadium-snapshot-lib.mjs';
import { ROOT } from './project-lib.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new TypeError(`${name} requires a value.`);
  return value;
}

const destination = resolve(ROOT, option('--destination') ?? 'vendor/arkadium-platform');
const rel = relative(ROOT, destination);
if (rel === '' || rel.startsWith('..') || rel.split(sep).includes('..')) {
  throw new TypeError('Snapshot destination must stay inside the repository.');
}

const report = await verifySnapshot(destination);
console.log(
  `Verified Arkadium adapter ${report.sourceCommit} with SDK ${report.sdkVersion} (${report.files} files).`,
);
