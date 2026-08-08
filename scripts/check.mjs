import { spawnSync } from 'node:child_process';
import { extname, relative } from 'node:path';
import { ROOT, buildProject, discoverProjects, readProjectConfig, walkFiles } from './project-lib.mjs';

const projectArgIndex = process.argv.indexOf('--project');
const projects = projectArgIndex >= 0 ? [await import('./project-lib.mjs').then(({ projectFromArg }) => projectFromArg(process.argv[projectArgIndex + 1]))] : await discoverProjects();
const forbidden = [/(?:src|href)=["']https?:\/\//i, /@font-face[^}]*url\(https?:/i, /\beval\s*\(/, /(?:api[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}/i];
for (const project of projects) {
  const config = await readProjectConfig(project);
  const files = (await walkFiles(project)).filter((file) => !file.includes('/dist/'));
  for (const file of files) {
    if (['.js', '.mjs'].includes(extname(file))) {
      const checked = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
      if (checked.status !== 0) process.exit(checked.status ?? 1);
    }
    if (['.js', '.mjs', '.html', '.css', '.json'].includes(extname(file))) {
      const text = await import('node:fs/promises').then(({ readFile }) => readFile(file, 'utf8'));
      for (const pattern of forbidden) if (pattern.test(text)) throw new Error(`${relative(ROOT, file)} violates ${pattern}`);
    }
  }
  await buildProject(project);
  console.log(`Checked ${config.slug}`);
}
