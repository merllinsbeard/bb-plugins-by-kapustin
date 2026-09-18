import { spawnSync } from 'node:child_process';
import { plugins, validate } from './catalog.mjs';

const [action, ...names] = process.argv.slice(2);
if (!['deps', 'check', 'test', 'build'].includes(action)) throw new Error('Usage: node scripts/run.mjs deps|check|test|build [plugin ...]');
validate();
for (const name of names) if (!plugins.some(p => p.name === name)) throw new Error(`Unknown plugin: ${name}`);
for (const plugin of plugins.filter(p => !names.length || names.includes(p.name))) {
  if (action === 'test' && !plugin.pkg.scripts?.test) {
    console.log(`${plugin.name}: no test suite declared`);
    continue;
  }
  console.log(`\n${plugin.name}: ${action}`);
  const args = action === 'deps' ? ['ci', '--include=dev', '--no-audit', '--no-fund'] : ['run', action];
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: plugin.directory, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
