import { join } from 'node:path';
import { ROOT, buildProject, projectFromArg, writeStoredZip } from './project-lib.mjs';
const argIndex = process.argv.indexOf('--project');
const project = await projectFromArg(argIndex >= 0 ? process.argv[argIndex + 1] : process.argv[2]);
const report = await buildProject(project);
const result = await writeStoredZip(report.outputDir, join(ROOT, 'release', `${report.slug}.zip`));
console.log(`Packaged ${result.outputFile} (${result.bytes} bytes)`);
