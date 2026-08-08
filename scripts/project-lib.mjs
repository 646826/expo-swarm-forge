import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = /^[a-z][a-z0-9-]{1,39}$/;

export function safeSlug(value) {
  const slug = String(value ?? '');
  if (!SLUG.test(slug) || slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
    throw new TypeError('Slug must match /^[a-z][a-z0-9-]{1,39}$/');
  }
  return slug;
}

export function replaceTokens(value, { title, slug }) {
  return value.replaceAll('__GAME_TITLE__', title).replaceAll('__GAME_SLUG__', slug);
}

export function validateProjectConfig(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Project config must be an object');
  const config = {
    slug: safeSlug(input.slug),
    title: String(input.title ?? '').trim(),
    entry: String(input.entry ?? ''),
    output: String(input.output ?? ''),
    buildBudgetBytes: Number(input.buildBudgetBytes),
  };
  if (!config.title || !/^[A-Za-z0-9._ -]+$/.test(config.entry) || config.entry.includes('..')) throw new TypeError('Invalid project title or entry');
  if (!/^[A-Za-z0-9._/-]+$/.test(config.output) || config.output.startsWith('/') || config.output.includes('..')) throw new TypeError('Invalid project output');
  if (!Number.isInteger(config.buildBudgetBytes) || config.buildBudgetBytes < 1024 || config.buildBudgetBytes > 10_000_000) throw new RangeError('Invalid build budget');
  return config;
}

export async function readProjectConfig(projectDir) {
  const raw = await readFile(join(projectDir, 'game.config.json'), 'utf8');
  return validateProjectConfig(JSON.parse(raw));
}

export async function pathExists(path) {
  try { await access(path); return true; } catch { return false; }
}

export async function walkFiles(root) {
  const files = [];
  if (!(await pathExists(root))) return files;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

export async function discoverProjects() {
  const candidates = [join(ROOT, 'template', 'browser-game'), join(ROOT, 'example', 'canyon-charms')];
  const games = join(ROOT, 'games');
  if (await pathExists(games)) {
    for (const entry of await readdir(games, { withFileTypes: true })) if (entry.isDirectory()) candidates.push(join(games, entry.name));
  }
  const projects = [];
  for (const candidate of candidates) if (await pathExists(join(candidate, 'game.config.json'))) projects.push(candidate);
  return projects;
}

function assertInside(root, path) {
  const rel = relative(root, path);
  if (rel.startsWith('..') || rel.split(sep).includes('..')) throw new Error(`Path escapes project: ${path}`);
}

export async function copyStarter(source, destination, tokens) {
  if (await pathExists(destination)) throw new Error(`Destination already exists: ${destination}`);
  await mkdir(destination, { recursive: true });
  for (const sourceFile of await walkFiles(source)) {
    const rel = relative(source, sourceFile);
    const destinationFile = join(destination, rel);
    assertInside(destination, destinationFile);
    await mkdir(dirname(destinationFile), { recursive: true });
    const extension = extname(sourceFile).toLowerCase();
    if (['.js', '.mjs', '.json', '.html', '.css', '.md', '.txt'].includes(extension)) {
      const text = await readFile(sourceFile, 'utf8');
      await writeFile(destinationFile, replaceTokens(text, tokens), 'utf8');
    } else {
      await cp(sourceFile, destinationFile);
    }
  }
  const configPath = join(destination, 'game.config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.slug = safeSlug(tokens.slug);
  config.title = String(tokens.title).trim();
  await writeFile(configPath, `${JSON.stringify(validateProjectConfig(config), null, 2)}\n`, 'utf8');
}

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function buildProject(projectDir) {
  const config = await readProjectConfig(projectDir);
  const outputDir = join(projectDir, config.output);
  assertInside(projectDir, outputDir);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  const sourceFiles = (await walkFiles(projectDir)).filter((file) => {
    const rel = relative(projectDir, file);
    return !rel.startsWith(`${config.output}${sep}`) && !rel.startsWith(`test${sep}`) && rel !== 'game.config.json';
  });
  const report = [];
  let totalBytes = 0;
  for (const sourceFile of sourceFiles) {
    const rel = relative(projectDir, sourceFile);
    const destination = join(outputDir, rel);
    assertInside(outputDir, destination);
    await mkdir(dirname(destination), { recursive: true });
    const bytes = await readFile(sourceFile);
    await writeFile(destination, bytes);
    totalBytes += bytes.length;
    report.push({ path: rel.replaceAll(sep, '/'), bytes: bytes.length, sha256: hash(bytes) });
  }
  if (!(await pathExists(join(outputDir, config.entry)))) throw new Error(`Missing entrypoint: ${config.entry}`);
  if (totalBytes > config.buildBudgetBytes) throw new Error(`Build budget exceeded: ${totalBytes} > ${config.buildBudgetBytes}`);
  const buildReport = { slug: config.slug, title: config.title, totalBytes, budgetBytes: config.buildBudgetBytes, files: report };
  await writeFile(join(outputDir, 'build-report.json'), `${JSON.stringify(buildReport, null, 2)}\n`);
  return { ...buildReport, outputDir };
}

export async function projectFromArg(arg) {
  if (!arg) return join(ROOT, 'example', 'canyon-charms');
  const candidate = resolve(ROOT, arg);
  assertInside(ROOT, candidate);
  return candidate;
}

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const dosDateTime = () => ({ time: 0, date: 33 });
const u16 = (value) => { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b; };
const u32 = (value) => { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b; };

export async function writeStoredZip(sourceDir, outputFile) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of await walkFiles(sourceDir)) {
    const name = relative(sourceDir, file).replaceAll(sep, '/');
    const nameBytes = Buffer.from(name);
    const data = await readFile(file);
    const crc = crc32(data);
    const { time, date } = dosDateTime();
    const local = Buffer.concat([Buffer.from('504b0304', 'hex'), u16(20), u16(0), u16(0), u16(time), u16(date), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, data]);
    localParts.push(local);
    const central = Buffer.concat([Buffer.from('504b0102', 'hex'), u16(20), u16(20), u16(0), u16(0), u16(time), u16(date), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes]);
    centralParts.push(central);
    offset += local.length;
  }
  const central = Buffer.concat(centralParts);
  const local = Buffer.concat(localParts);
  const end = Buffer.concat([Buffer.from('504b0506', 'hex'), u16(0), u16(0), u16(centralParts.length), u16(centralParts.length), u32(central.length), u32(local.length), u16(0)]);
  await mkdir(dirname(outputFile), { recursive: true });
  await writeFile(outputFile, Buffer.concat([local, central, end]));
  return { outputFile, bytes: (await stat(outputFile)).size };
}
