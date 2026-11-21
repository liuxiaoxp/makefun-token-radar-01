import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInput, buildModel } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
function option(flag: string, fallback: string): string {
  const args = process.argv.slice(2);
  const equals = args.find(arg => arg.startsWith(flag + '='));
  if (equals) return equals.slice(flag.length + 1);
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return args[index + 1];
}
function publishDirectory(name: string, destination: string) {
  fs.mkdirSync(path.join(destination, name), { recursive: true });
  for (const file of fs.readdirSync(path.join(root, name)).sort()) {
    if (!fs.statSync(path.join(root, name, file)).isFile()) throw new Error(`Expected a plain entry file: ${name}/${file}`);
    fs.copyFileSync(path.join(root, name, file), path.join(destination, name, file));
  }
}
function run() {
  let input = option('--input', '/input/snapshot.json');
  if (fs.statSync(input).isDirectory()) input = path.join(input, 'snapshot.json');
  const output = path.resolve(option('--output', process.env.MAKEFUN_OUTPUT_DIR || '/output'));
  if (output === path.resolve(root)) throw new Error('Output must be separate from source');
  const snapshot = parseInput(fs.readFileSync(input, 'utf8'));
  const { board, data } = buildModel(snapshot);
  // The same row objects go to board.json and the dashboard's embedded data.
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'board.json'), JSON.stringify(board) + '\n');
  fs.writeFileSync(path.join(output, 'data.js'), 'window.RADAR = ' + JSON.stringify(data).replace(/</g, '\\u003c') + ';\n');
  publishDirectory('dashboard', output);
  publishDirectory('screenshots', output);
  fs.writeFileSync(path.join(output, 'dossier.json'), buildDossier(output, {
    text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 }
  }));
  console.log(`radar-2: ${board.rows.length} ranked; ${snapshot.watchlist.length} watchlist; output ${output}`);
}
try { run(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
