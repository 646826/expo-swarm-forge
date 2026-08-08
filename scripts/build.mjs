import { projectFromArg, buildProject } from './project-lib.mjs';
const argIndex = process.argv.indexOf('--project');
const project = await projectFromArg(argIndex >= 0 ? process.argv[argIndex + 1] : process.argv[2]);
const report = await buildProject(project);
console.log(`Built ${report.slug}: ${report.totalBytes}/${report.budgetBytes} bytes -> ${report.outputDir}`);
