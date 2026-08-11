import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';

import { validateRuntimeManifest } from '../packages/integration-config/src/index.js';
import { ROOT, pathExists, walkFiles } from './project-lib.mjs';

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
    throw new Error('Telemetry candidate project index.html is unavailable.');
  }
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (htmlAttribute(tag, 'name')?.toLowerCase() === 'version') {
      const version = htmlAttribute(tag, 'content');
      if (version) return version;
    }
  }
  throw new Error('Telemetry candidate project must expose one meta version.');
}

function stableJson(value) {
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
      throw new Error(`Telemetry candidate output contains an external module URL in ${path}.`);
    }
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
      throw new Error(`Telemetry candidate output contains a bare import in ${path}.`);
    }
  }
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function finalizeTelemetryCandidateManifest(
  input,
  { buildSha, gameVersion } = {},
) {
  let configured;
  try {
    configured = validateRuntimeManifest(input);
  } catch {
    throw new Error('Telemetry candidate runtime configuration is invalid.');
  }
  if (configured.mode !== 'standalone') {
    throw new Error('Telemetry candidate requires standalone mode.');
  }
  if (!configured.gameEyeEndpoint) {
    throw new Error('Telemetry candidate requires one local Game Eye endpoint.');
  }
  if (configured.gameVersion !== gameVersion) {
    throw new Error('Telemetry candidate game version does not match the project game version.');
  }
  if (typeof buildSha !== 'string' || !BUILD_SHA.test(buildSha)) {
    throw new Error('Telemetry candidate build SHA must be an exact lowercase commit SHA.');
  }

  try {
    return validateRuntimeManifest({
      ...configured,
      gameVersion,
      buildSha,
    });
  } catch {
    throw new Error('Telemetry candidate runtime manifest could not be finalized.');
  }
}

export async function verifyTelemetryCandidateOutput(outputDir, { manifest } = {}) {
  let expectedManifest;
  try {
    expectedManifest = validateRuntimeManifest(manifest);
  } catch {
    throw new Error('Telemetry candidate verification requires a valid runtime manifest.');
  }
  if (expectedManifest.mode !== 'standalone' || !expectedManifest.gameEyeEndpoint) {
    throw new Error('Telemetry candidate verification requires standalone telemetry mode.');
  }

  const emittedManifest = await readJson(
    join(outputDir, 'runtime-manifest.json'),
    'Telemetry candidate runtime manifest',
  );
  if (JSON.stringify(emittedManifest) !== JSON.stringify(expectedManifest)) {
    throw new Error('Telemetry candidate runtime manifest does not match the exact build configuration.');
  }

  const files = await walkFiles(outputDir);
  if (files.length === 0) throw new Error('Telemetry candidate output is empty.');
  const paths = files.map((file) => outputPath(outputDir, file));
  if (!paths.includes('index.html')) {
    throw new Error('Telemetry candidate output is missing index.html.');
  }
  if (!paths.some((path) => SCRIPT_OUTPUT_EXTENSIONS.has(extname(path).toLowerCase()))) {
    throw new Error('Telemetry candidate output is missing a bundled JavaScript module.');
  }

  const report = [];
  for (const file of files) {
    const path = outputPath(outputDir, file);
    const extension = extname(path).toLowerCase();
    if (extension === '.map' || /(?:^|\/)sourcemaps?(?:\/|$)/i.test(path)) {
      throw new Error(`Telemetry candidate output contains a source map: ${path}.`);
    }
    if (['.ts', '.tsx', '.mts', '.cts'].includes(extension)) {
      throw new Error(`Telemetry candidate output contains uncompiled TypeScript: ${path}.`);
    }
    if (path.split('/').includes('node_modules')) {
      throw new Error(`Telemetry candidate output contains a raw node_modules tree: ${path}.`);
    }

    const bytes = await readFile(file);
    if (TEXT_OUTPUT_EXTENSIONS.has(extension)) {
      const source = bytes.toString('utf8');
      if (/sourceMappingURL\s*=/.test(source)) {
        throw new Error(`Telemetry candidate output contains a source map reference in ${path}.`);
      }
      if (SCRIPT_OUTPUT_EXTENSIONS.has(extension)) {
        validateOutputModuleSpecifiers(source, path);
      }
      if (extension === '.html'
        && /<(?:script|link)\b[^>]+(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(source)) {
        throw new Error(`Telemetry candidate output contains an external runtime asset in ${path}.`);
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

export async function buildTelemetryCandidate({
  rootDir = ROOT,
  projectDir = join(rootDir, 'example', 'canyon-charms'),
  configPath = join(rootDir, 'config', 'runtime.telemetry.example.json'),
  buildSha,
  runViteBuild = defaultRunViteBuild,
} = {}) {
  if (typeof runViteBuild !== 'function') {
    throw new TypeError('Telemetry candidate build requires a Vite build function.');
  }

  const resolvedRoot = resolve(rootDir);
  const resolvedProject = resolve(projectDir);
  const resolvedConfig = resolve(configPath);
  assertInside(resolvedRoot, resolvedProject, 'Telemetry candidate project');
  assertInside(resolvedRoot, resolvedConfig, 'Telemetry candidate configuration');

  const configured = await readJson(
    resolvedConfig,
    'Telemetry candidate runtime configuration',
  );
  const gameVersion = await readProjectGameVersion(resolvedProject);
  const manifest = finalizeTelemetryCandidateManifest(configured, {
    buildSha,
    gameVersion,
  });
  const outputDir = join(resolvedProject, 'telemetry-dist');
  assertInside(resolvedProject, outputDir, 'Telemetry candidate output');

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
    throw new Error('Vite did not create the telemetry candidate output directory.');
  }
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'runtime-manifest.json'), stableJson(manifest));
  const files = await verifyTelemetryCandidateOutput(outputDir, { manifest });
  const report = Object.freeze({
    schemaVersion: 1,
    source: 'standalone-local-telemetry',
    buildSha: manifest.buildSha,
    gameVersion: manifest.gameVersion,
    runtimeMode: manifest.mode,
    sdkVersion: null,
    files,
  });
  await writeFile(
    join(outputDir, 'telemetry-candidate-report.json'),
    stableJson(report),
  );

  return Object.freeze({ outputDir, manifest, report });
}
