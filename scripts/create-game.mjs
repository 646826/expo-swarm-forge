import { join } from 'node:path';
import { ROOT, copyStarter, safeSlug } from './project-lib.mjs';

const slug = safeSlug(process.argv[2]);
const title = process.argv.slice(3).join(' ').trim() || slug.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
const destination = join(ROOT, 'games', slug);
await copyStarter(join(ROOT, 'template', 'browser-game'), destination, { slug, title });
console.log(`Created ${destination}`);
