import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';

import { validateRuntimeManifest } from '../packages/integration-config/src/index.js';
import { ROOT, pathExists, walkFiles } from './project-lib.mjs';

export const EXPECTED_OFFICIAL_SDK_VERSION = '2.66.2';

const BUILD_SHA = /^[0-9a-f]{40}$/;
const TEXT_OUTPUT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.mjs']);
const SCRIPT_OUTPUT_EXTENSIONS = new Set(['.js', '.mjs']);

function assertInside(root, path, label) {
  const rel = relative(root, path);
  if (rel === '' || (!rel.startsWith('..') && !rel.split(sep).includes('..'))) return;
  throw new Error(`${label} must remain inside the repository root.`);
}

async function readJson(path, label) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new Error(`${label} is unavailable.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function htmlAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match?.[1] ?? null;
}

async function readProjectGameVersion(projectDir) {
  let html;
  try {
    html = await readFile(join(projectDir, 'index.html'), 'utf8');
  } catch {
    throw new Error('Candidate project index.html is unavailable.');
  }
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (htmlAttribute(tag, 'name')?.toLowerCase() === 'version') {
      const version = htmlAttribute(tag, 'content');
      if (version) return version;
    }
  }
  throw new Error('Candidate project must expose one meta version.');
}

function stableManifestText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function outputPath(root, file) {
  return relative(root, file).replaceAll(sep, '/');
}

function extractModuleSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[^"'()]*?\bfrom\s*)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

function validateOutputModuleSpecifiers(source, path) {
  for (const specifier of extractModuleSpecifiers(source)) {
    if (/^(?:https?:)?\/\//i.test(specifier)) {
      throw new Error(`Candidate output contains an external module URL in ${path}.`);
    }
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
      throw new Error(`Candidate output contains a bare import in ${path}.`);
    }
  }
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readReviewedSdkVersion(rootDir) {
  const installed = await readJson(
    join(rootDir, 'node_modules', '@arkadiuminc', 'sdk', 'package.json'),
    'Installed Arkadium SDK package metadata',
  );
  const snapshot = await readJson(
    join(rootDir, 'vendor', 'arkadium-platform', 'manifest.json'),
    'Reviewed Arkadium adapter snapshot',
  );

  if (installed.name !== '@arkadiuminc/sdk'
    || installed.version !== EXPECTED_OFFICIAL_SDK_VERSION
    || snapshot.sdkVersion !== EXPECTED_OFFICIAL_SDK_VERSION) {
    throw new Error('Official Arkadium SDK inventory does not match the reviewed release.');
  }
  return EXPECTED_OFFICIAL_SDK_VERSION;
}

export function finalizeCandidateManifest(input, { buildSha, gameVersion } = {}) {
  let configured;
  try {
    configured = validateRuntimeManifest(input);
  } catch {
    throw new Error('Candidate runtime configuration is invalid.');
  }

  if (configured.mode === 'standalone') {
    throw new Error('Arkadium candidate build requires a publisher mode.');
  }
  if (configured.gameVersion !== gameVersion) {
    throw new Error('Candidate game version does not match the project game version.');
  }
  if (typeof buildSha !== 'string' || !BUILD_SHA.test(buildSha)) {
    throw new Error('Candidate build SHA must be an exact lowercase commit SHA.');
  }

  try {
    return validateRuntimeManifest({
      ...configured,
      gameVersion,
      buildSha,
    });
  } catch {
    throw new Error('Candidate runtime manifest could not be finalized.');
  }
}

export async function verifyCandidateOutput(outputDir, { manifest, sdkVersion } = {}) {
  let expectedManifest;
  try {
    expectedManifest = validateRuntimeManifest(manifest);
  } catch {
    throw new Error('Candidate output verification requires a valid runtime manifest.');
  }
  if (expectedManifest.mode === 'standalone') {
    throw new Error('Candidate output verification requires a publisher mode.');
  }
  if (sdkVersion !== EXPECTED_OFFICIAL_SDK_VERSION) {
    throw new Error('Candidate output SDK version does not match the reviewed release.');
  }

  const emittedManifest = await readJson(
    join(outputDir, 'runtime-manifest.json'),
    'Candidate runtime manifest',
  );
  if (JSON.stringify(emittedManifest) !== JSON.stringify(expectedManifest)) {
    throw new Error('Candidate runtime manifest does not match the exact build configuration.');
  }

  const files = await walkFiles(outputDir);
  if (files.length === 0) throw new Error('Candidate output is empty.');
  const paths = files.map((file) => outputPath(outputDir, file));
  if (!paths.includes('index.html')) throw new Error('Candidate output is missing index.html.');
  if (!paths.some((path) => SCRIPT_OUTPUT_EXTENSIONS.has(extname(path).toLowerCase()))) {
    throw new Error('Candidate output is missing a bundled JavaScript module.');
  }

  const report = [];
  for (const file of files) {
    const path = outputPath(outputDir, file);
    const extension = extname(path).toLowerCase();
    if (extension === '.map' || /(?:^|\/)sourcemaps?(?:\/|$)/i.test(path)) {
      throw new Error(`Candidate output contains a source map: ${path}.`);
    }
    if (['.ts', '.tsx', '.mts', '.cts'].includes(extension)) {
      throw new Error(`Candidate output contains uncompiled TypeScript: ${path}.`);
    }
    if (path.split('/').includes('node_modules')) {
      throw new Error(`Candidate output contains a raw node_modules tree: ${path}.`);
    }

    const bytes = await readFile(file);
    if (TEXT_OUTPUT_EXTENSIONS.has(extension)) {
      const source = bytes.toString('utf8');
      if (/sourceMappingURL\s*=/.test(source)) {
        throw new Error(`Candidate output contains a source map reference in ${path}.`);
      }
      if (SCRIPT_OUTPUT_EXTENSIONS.has(extension)) {
        validateOutputModuleSpecifiers(source, path);
      }
      if (extension === '.html'
        && /<(?:script|link)\b[^>]+(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(source)) {
        throw new Error(`Candidate output contains an external runtime asset in ${path}.`);
      }
    }

    report.push(Object.freeze({
      path,
      bytes: bytes.length,
      sha256: hash(bytes),
    }));
  }

  report.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  return Object.freeze(report);
}

async function defaultRunViteBuild(options) {
  const { build } = await import('vite');
  await build(options);
}

export async function buildArkadiumCandidate({
  rootDir = ROOT,
  projectDir = join(rootDir, 'example', 'canyon-charms'),
  configPath = join(rootDir, 'config', 'runtime.sandbox.example.json'),
  buildSha,
  runViteBuild = defaultRunViteBuild,
} = {}) {
  if (typeof runViteBuild !== 'function') {
    throw new TypeError('Candidate build requires a Vite build function.');
  }

  const resolvedRoot = resolve(rootDir);
  const resolvedProject = resolve(projectDir);
  const resolvedConfig = resolve(configPath);
  assertInside(resolvedRoot, resolvedProject, 'Candidate project');
  assertInside(resolvedRoot, resolvedConfig, 'Candidate configuration');

  const configured = await readJson(resolvedConfig, 'Candidate runtime configuration');
  const gameVersion = await readProjectGameVersion(resolvedProject);
  const manifest = finalizeCandidateManifest(configured, { buildSha, gameVersion });
  const sdkVersion = await readReviewedSdkVersion(resolvedRoot);
  const outputDir = join(resolvedProject, 'arkadium-dist');
  assertInside(resolvedProject, outputDir, 'Candidate output');

  await rm(outputDir, { recursive: true, force: true });
  await runViteBuild({
    root: resolvedProject,
    configFile: join(resolvedProject, 'vite.config.ts'),
    base: './',
    define: {
      'globalThis.__CANYON_RUNTIME_MANIFEST__': JSON.stringify(manifest),
    },
    build: {
      outDir: outputDir,
      emptyOutDir: true,
      sourcemap: false,
      target: 'es2022',
    },
  });

  if (!(await pathExists(outputDir))) {
    throw new Error('Vite did not create the Arkadium candidate output directory.');
  }
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'runtime-manifest.json'), stableManifestText(manifest));
  const files = await verifyCandidateOutput(outputDir, { manifest, sdkVersion });
  const report = Object.freeze({
    schemaVersion: 1,
    buildSha: manifest.buildSha,
    gameVersion: manifest.gameVersion,
    sdkVersion,
    runtimeMode: manifest.mode,
    files,
  });
  await writeFile(join(outputDir, 'candidate-report.json'), stableManifestText(report));

  return Object.freeze({
    outputDir,
    manifest,
    report,
  });
}
