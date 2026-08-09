import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const SOURCE_REPOSITORY = '646826/arkadium-game-factory';
export const EXPECTED_ARKADIUM_SDK_VERSION = '2.66.2';
export const SNAPSHOT_ROOTS = Object.freeze([
  'packages/platform-contract/src',
  'packages/platform-arkadium/src',
  'packages/platform-arkadium/sdk',
  'packages/platform-arkadium/package.json',
]);

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const MANIFEST_KEYS = new Set([
  'schemaVersion',
  'sourceRepository',
  'sourceCommit',
  'sdkVersion',
  'files',
]);

function fail(message) {
  throw new Error(`Arkadium snapshot: ${message}`);
}

function toPosix(path) {
  return path.split(sep).join('/');
}

function normalizeRelativePath(path, label = 'path') {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\\')) {
    fail(`${label} is invalid`);
  }
  const normalized = toPosix(path);
  const parts = normalized.split('/');
  if (
    normalized.startsWith('/')
    || !SAFE_PATH_PATTERN.test(normalized)
    || parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    fail(`${label} is invalid`);
  }
  return normalized;
}

function assertInside(root, candidate, label) {
  const rel = relative(root, candidate);
  if (rel === '' || (!rel.startsWith('..') && !rel.split(sep).includes('..'))) return;
  fail(`${label} escapes its root`);
}

function assertSeparateTrees(source, destination) {
  const sourceToDestination = relative(source, destination);
  const destinationToSource = relative(destination, source);
  const destinationInsideSource = sourceToDestination === ''
    || (!sourceToDestination.startsWith('..') && !sourceToDestination.split(sep).includes('..'));
  const sourceInsideDestination = destinationToSource === ''
    || (!destinationToSource.startsWith('..') && !destinationToSource.split(sep).includes('..'));
  if (destinationInsideSource || sourceInsideDestination) {
    fail('source and destination must be separate directory trees');
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseJson(bytes, label) {
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail(`${label} is not valid JSON`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must contain a JSON object`);
  }
  return value;
}

async function readJson(path, label) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    fail(`${label} is missing`);
  }
  return parseJson(bytes, label);
}

async function collectFiles(root, path = root) {
  let info;
  try {
    info = await lstat(path);
  } catch {
    fail(`required source path is missing: ${toPosix(relative(root, path))}`);
  }
  if (info.isSymbolicLink()) fail(`symbolic links are not allowed: ${toPosix(relative(root, path))}`);
  if (info.isFile()) return [path];
  if (!info.isDirectory()) fail(`unsupported filesystem entry: ${toPosix(relative(root, path))}`);

  const files = [];
  const entries = await readdir(path, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isSymbolicLink()) fail(`symbolic links are not allowed: ${toPosix(relative(root, child))}`);
    if (entry.isDirectory()) files.push(...await collectFiles(root, child));
    else if (entry.isFile()) files.push(child);
    else fail(`unsupported filesystem entry: ${toPosix(relative(root, child))}`);
  }
  return files;
}

async function validateSdkVersion(sourceRoot) {
  const packageJson = await readJson(
    join(sourceRoot, 'packages/platform-arkadium/package.json'),
    'platform-arkadium package.json',
  );
  const dependency = packageJson.dependencies?.['@arkadiuminc/sdk'];
  if (dependency !== EXPECTED_ARKADIUM_SDK_VERSION) {
    fail(`@arkadiuminc/sdk dependency must be exactly ${EXPECTED_ARKADIUM_SDK_VERSION}`);
  }

  const sdkManifest = await readJson(
    join(sourceRoot, 'packages/platform-arkadium/sdk/manifest.json'),
    'Arkadium SDK snapshot manifest',
  );
  if (sdkManifest.package?.version !== EXPECTED_ARKADIUM_SDK_VERSION) {
    fail(`SDK snapshot version must be exactly ${EXPECTED_ARKADIUM_SDK_VERSION}`);
  }
}

function runGit(source, args, label) {
  const result = spawnSync('git', ['-C', source, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    fail(`${label} failed`);
  }
  return result.stdout.trim();
}

export async function resolveGitSourceCommit(source) {
  const sourceRoot = resolve(source);
  const status = runGit(
    sourceRoot,
    ['status', '--porcelain=v1', '--untracked-files=all'],
    'git status',
  );
  if (status !== '') fail('source checkout must be clean');
  const commit = runGit(sourceRoot, ['rev-parse', 'HEAD'], 'git rev-parse');
  if (!COMMIT_PATTERN.test(commit)) fail('source commit is invalid');
  return commit;
}

function validateCommit(commit) {
  if (typeof commit !== 'string' || !COMMIT_PATTERN.test(commit)) {
    fail('source commit is invalid');
  }
  return commit;
}

function validateRoots(roots) {
  if (!Array.isArray(roots) || roots.length === 0) fail('snapshot roots are required');
  const normalized = [...new Set(roots.map((root) => normalizeRelativePath(root, 'snapshot root')))];
  normalized.sort((left, right) => left.localeCompare(right, 'en'));
  return normalized;
}

async function enumerateSourceFiles(sourceRoot, roots) {
  const files = new Map();
  for (const root of roots) {
    const sourcePath = resolve(sourceRoot, root);
    assertInside(sourceRoot, sourcePath, 'snapshot root');
    for (const file of await collectFiles(sourceRoot, sourcePath)) {
      const rel = normalizeRelativePath(toPosix(relative(sourceRoot, file)), 'source file');
      files.set(rel, file);
    }
  }
  return [...files.entries()].sort(([left], [right]) => left.localeCompare(right, 'en'));
}

function canonicalManifest(manifest) {
  const sortedFiles = Object.fromEntries(
    Object.entries(manifest.files).sort(([left], [right]) => left.localeCompare(right, 'en')),
  );
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    sourceRepository: SOURCE_REPOSITORY,
    sourceCommit: manifest.sourceCommit,
    sdkVersion: EXPECTED_ARKADIUM_SDK_VERSION,
    files: sortedFiles,
  };
}

export async function syncSnapshot({
  source,
  destination,
  sourceCommit,
  roots = SNAPSHOT_ROOTS,
} = {}) {
  if (typeof source !== 'string' || typeof destination !== 'string') {
    fail('source and destination are required');
  }
  const sourceRoot = resolve(source);
  const destinationRoot = resolve(destination);
  assertSeparateTrees(sourceRoot, destinationRoot);
  const commit = validateCommit(sourceCommit ?? await resolveGitSourceCommit(sourceRoot));
  const normalizedRoots = validateRoots(roots);
  await validateSdkVersion(sourceRoot);
  const sourceFiles = await enumerateSourceFiles(sourceRoot, normalizedRoots);
  if (sourceFiles.length === 0) fail('snapshot contains no files');

  const snapshotSource = join(destinationRoot, 'source');
  await rm(snapshotSource, { recursive: true, force: true });
  await mkdir(snapshotSource, { recursive: true });

  const fileHashes = {};
  for (const [sourceRelative, sourceFile] of sourceFiles) {
    const destinationRelative = normalizeRelativePath(`source/${sourceRelative}`, 'snapshot file');
    const destinationFile = resolve(destinationRoot, destinationRelative);
    assertInside(destinationRoot, destinationFile, 'snapshot file');
    const bytes = await readFile(sourceFile);
    await mkdir(dirname(destinationFile), { recursive: true });
    await writeFile(destinationFile, bytes);
    fileHashes[destinationRelative] = sha256(bytes);
  }

  const manifest = canonicalManifest({ sourceCommit: commit, files: fileHashes });
  await mkdir(destinationRoot, { recursive: true });
  await writeFile(
    join(destinationRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return manifest;
}

function validateManifest(manifest) {
  const keys = Object.keys(manifest);
  for (const key of keys) if (!MANIFEST_KEYS.has(key)) fail(`unknown manifest field: ${key}`);
  if (keys.length !== MANIFEST_KEYS.size) fail('manifest fields are incomplete');
  if (manifest.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) fail('manifest schema version is invalid');
  if (manifest.sourceRepository !== SOURCE_REPOSITORY) fail('source repository is invalid');
  validateCommit(manifest.sourceCommit);
  if (manifest.sdkVersion !== EXPECTED_ARKADIUM_SDK_VERSION) {
    fail(`manifest SDK version must be exactly ${EXPECTED_ARKADIUM_SDK_VERSION}`);
  }
  if (!manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    fail('manifest files must be an object');
  }

  const files = new Map();
  for (const [path, digest] of Object.entries(manifest.files)) {
    const normalized = normalizeRelativePath(path, 'manifest file');
    if (!normalized.startsWith('source/')) fail('manifest file must be inside source/');
    if (normalized !== path) fail('manifest file path is not canonical');
    if (typeof digest !== 'string' || !DIGEST_PATTERN.test(digest)) {
      fail(`manifest digest is invalid: ${normalized}`);
    }
    files.set(normalized, digest);
  }
  if (files.size === 0) fail('manifest contains no files');
  return files;
}

export async function verifySnapshot(destination) {
  if (typeof destination !== 'string') fail('destination is required');
  const destinationRoot = resolve(destination);
  const manifest = await readJson(join(destinationRoot, 'manifest.json'), 'snapshot manifest');
  const expectedFiles = validateManifest(manifest);
  const snapshotSource = join(destinationRoot, 'source');
  const actualFiles = await collectFiles(destinationRoot, snapshotSource);
  const seen = new Set();

  for (const file of actualFiles) {
    const rel = normalizeRelativePath(toPosix(relative(destinationRoot, file)), 'snapshot file');
    const expectedDigest = expectedFiles.get(rel);
    if (!expectedDigest) fail(`untracked snapshot file: ${rel}`);
    const actualDigest = sha256(await readFile(file));
    if (actualDigest !== expectedDigest) fail(`hash mismatch: ${rel}`);
    seen.add(rel);
  }

  for (const path of expectedFiles.keys()) {
    if (!seen.has(path)) fail(`snapshot file is missing: ${path}`);
  }

  await validateSdkVersion(snapshotSource);
  return Object.freeze({
    ok: true,
    sourceCommit: manifest.sourceCommit,
    sdkVersion: manifest.sdkVersion,
    files: expectedFiles.size,
  });
}
