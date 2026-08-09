import { relative, resolve, sep } from 'node:path';

import {
  EXPECTED_ARKADIUM_SDK_VERSION,
  syncSnapshot,
} from './arkadium-snapshot-lib.mjs';
import { ROOT } from './project-lib.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new TypeError(`${name} requires a value.`);
  }
  return value;
}

const sourceArg = option('--source');
if (!sourceArg) {
  throw new TypeError(
    'Usage: npm run arkadium:sync -- --source ../arkadium-game-factory [--destination vendor/arkadium-platform]',
  );
}

const destinationArg = option('--destination') ?? 'vendor/arkadium-platform';
const source = resolve(process.cwd(), sourceArg);
const destination = resolve(ROOT, destinationArg);
const repositoryRelative = relative(ROOT, destination);
const escapesRepository = repositoryRelative === ''
  || repositoryRelative.startsWith('..')
  || repositoryRelative.split(sep).includes('..');
if (escapesRepository) {
  throw new TypeError('Snapshot destination must stay inside the repository.');
}

const manifest = await syncSnapshot({ source, destination });
console.log(
  `Synchronized Arkadium adapter ${manifest.sourceCommit} with SDK ${EXPECTED_ARKADIUM_SDK_VERSION} (${Object.keys(manifest.files).length} files).`,
);
