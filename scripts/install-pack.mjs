import { spawnSync } from 'node:child_process';
import { plugins, readJson, repository, validate } from './catalog.mjs';

validate();
const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('Usage: node scripts/install-pack.mjs all|essentials|agents|operations|<plugin> [--apply]');
  console.log('Default: print release sources only. --apply asks BB to confirm each installation.');
  process.exit(0);
}
if (args.filter(a => !a.startsWith('--')).length !== 1 || args.some(a => a.startsWith('--') && a !== '--apply')) throw new Error('Invalid arguments; use --help');
const selection = args.find(a => !a.startsWith('--'));
const packs = readJson('packs.json');
const selected = selection === 'all' ? plugins.map(p => p.name) : packs.presets[selection] ?? [selection];
const ordered = [], visiting = new Set(), done = new Set();
function visit(name) {
  if (!plugins.some(p => p.name === name)) throw new Error(`Unknown pack or plugin: ${name}`);
  if (visiting.has(name)) throw new Error(`Circular dependency: ${name}`);
  if (done.has(name)) return;
  visiting.add(name);
  for (const dep of packs.requires[name] ?? []) visit(dep);
  visiting.delete(name); done.add(name); ordered.push(name);
}
selected.forEach(visit);
const commands = ordered.map(name => {
  const { pkg } = plugins.find(p => p.name === name);
  return ['plugin', 'install', `git:${repository}@^${pkg.version}`, '--plugin', name, '--tag-prefix', `${name}/`];
});
console.log('Compatible release tags must already exist on GitHub. Existing installations must be updated with bb plugin update.');
for (const command of commands) console.log(['bb', ...command.map(a => `'${a}'`)].join(' '));
if (args.includes('--apply')) {
  const executable = process.env.BB_CLI || 'bb';
  for (const command of commands) {
    const result = spawnSync(executable, command, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
