import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const repository = 'https://github.com/dmitriikapustin/bb-plugins-by-kapustin.git';
export const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
export const collection = readJson('.bb/plugins.json');
export const plugins = collection.plugins.map(entry => ({
  ...entry, directory: resolve(root, entry.source),
  pkg: readJson(`${entry.source}/package.json`),
}));

export function validate() {
  assert.equal(collection.schemaVersion, 1);
  assert.equal(collection.name, 'bb-plugins-by-kapustin');
  assert.equal(new Set(plugins.map(p => p.name)).size, plugins.length);
  assert.deepEqual(readdirSync(resolve(root, 'plugins')).sort(), plugins.map(p => p.name).sort());
  for (const plugin of plugins) {
    const { name, source, pkg } = plugin;
    assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(source, `./plugins/${name}`);
    const id = pkg.name.replace(/^@[^/]+\//, '').replace(/^bb-plugin-/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
    assert.equal(id, name, `${name}: changing the package ID breaks existing installs`);
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
    assert.equal(pkg.repository.url, repository);
    assert.equal(pkg.repository.directory, `plugins/${name}`);
    assert.equal(pkg.author.url, 'https://github.com/dmitriikapustin');
    for (const file of ['README.md', 'PLUGIN_OVERVIEW.md', 'LICENSE', 'package-lock.json', pkg.bb.server, pkg.bb.app, pkg.bb.host].filter(Boolean)) {
      assert.ok(existsSync(resolve(plugin.directory, file)), `${name}: missing ${file}`);
    }
    const lock = readJson(`${source}/package-lock.json`);
    assert.equal(lock.packages[''].version, pkg.version);
    for (const field of ['dependencies', 'devDependencies']) assert.deepEqual(lock.packages[''][field], pkg[field]);
    for (const [path, dependency] of Object.entries(lock.packages)) {
      assert.ok(!path.startsWith('../') && !dependency.link, `${name}: local dependency ${path}`);
      if (dependency.resolved) assert.ok(dependency.resolved.startsWith('https://registry.npmjs.org/'), `${name}: dependency outside public npm: ${path}`);
    }
    const entry = readJson(`marketplace/entries/${name}.json`);
    assert.equal(entry.id, name);
    assert.equal(entry.author.github, 'dmitriikapustin');
    assert.deepEqual(entry.source.git, { url: repository, subdir: `plugins/${name}`, range: `^${pkg.version}`, tagPrefix: `${name}/` });
    const overview = readFileSync(resolve(plugin.directory, 'PLUGIN_OVERVIEW.md'), 'utf8');
    assert.ok(overview.length <= 4000, `${name}: overview exceeds marketplace limit`);
    assert.equal(readFileSync(resolve(root, 'marketplace', entry.overview), 'utf8'), overview);
    for (const file of [entry.icon.url, ...entry.screenshots]) assert.ok(existsSync(resolve(root, 'marketplace', file)), `${name}: missing ${file}`);
  }
  const packs = readJson('packs.json');
  for (const [name, ids] of Object.entries(packs.presets)) {
    assert.equal(new Set(ids).size, ids.length, `${name}: duplicate selection`);
    for (const id of ids) assert.ok(plugins.some(p => p.name === id), `${name}: unknown plugin ${id}`);
  }
  for (const [id, deps] of Object.entries(packs.requires)) {
    assert.ok(plugins.some(p => p.name === id));
    for (const dep of deps) assert.ok(plugins.some(p => p.name === dep));
  }
  return plugins;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validate();
  console.log(`Catalog OK: ${plugins.length} independent plugins, IDs and sources consistent.`);
}
