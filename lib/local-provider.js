import {readFile, realpath, stat} from 'node:fs/promises';
import {resolve, relative, dirname, isAbsolute, sep} from 'node:path';
import {instructionBody, PROVIDER} from './provider.js';

// Runtime discovery/loading is deliberately filesystem-only. Downloading is an
// explicit maintenance command, never a side effect of selecting a skill.
export class LocalCatalogProvider {
  constructor(libraryDir, invalidate = () => {}) {
    this.name = PROVIDER;
    this.libraryDir = resolve(libraryDir);
    this.invalidate = invalidate;
    this.entries = new Map();
    this.revision = null;
    this.manifest = {entries: [], unavailable: []};
  }

  async refresh(signal) {
    signal?.throwIfAborted();
    const file = resolve(this.libraryDir, 'manifest.json');
    let info;
    try { info = await stat(file); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (this.revision !== null) {
        this.entries.clear(); this.manifest = {entries: [], unavailable: []};
        this.revision = null; this.invalidate();
      }
      return;
    }
    const revision = `${info.mtimeMs}:${info.size}`;
    if (revision === this.revision) return;
    const manifest = JSON.parse(await readFile(file, {encoding: 'utf8', signal}));
    if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries)) throw Error('Invalid local skill library manifest.');
    const entries = new Map();
    for (const row of manifest.entries) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.name) || typeof row.path !== 'string' || typeof row.description !== 'string') continue;
      const path = resolve(this.libraryDir, row.path);
      if (!this.contains(path)) continue;
      entries.set(row.name, {...row, path});
    }
    this.entries = entries;
    this.manifest = manifest;
    this.revision = revision;
  }

  contains(path) {
    const rel = relative(this.libraryDir, path);
    return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
  }

  summary(row) {
    return {name: row.name, description: `${row.title}: ${row.description}`,
      provider: this.name, source: 'bundled', path: row.path,
      invocation: {modelInvocable: true, userInvocable: true},
      resourceBase: {kind: 'directory', path: dirname(row.path)}};
  }

  async list({signal} = {}) {
    await this.refresh(signal);
    return [...this.entries.values()].map(row => ({...this.summary(row), rank: 600,
      locator: row.name, metadata: {source: row.source, local: true, repo: row.repo}}));
  }

  async get(candidate, {signal} = {}) {
    await this.refresh(signal);
    const row = this.entries.get(candidate.locator);
    if (!row || row.name !== candidate.name) return;
    let markdown;
    try {
      const path = await realpath(row.path);
      if (!this.contains(path)) throw Error('Local skill resolves outside its library.');
      if ((await stat(path)).size > 2 * 1024 * 1024) throw Error('Local skill exceeds 2 MiB.');
      markdown = await readFile(path, {encoding: 'utf8', signal});
    } catch (error) {
      signal?.throwIfAborted();
      if (error.code !== 'ENOENT') throw error;
      this.entries.delete(row.name);
      this.invalidate();
      return;
    }
    signal?.throwIfAborted();
    const cli = row.cli && resolve(this.libraryDir, row.cli);
    const cliNote = cli && this.contains(cli)
      ? `\nThe companion Story CLI is already installed locally. Run it through the normal workspace-authorized shell tool: node ${JSON.stringify(cli)} <arguments>. No npx download or GitHub install is needed.\n`
      : '';
    return {...this.summary(row), content: `Local instruction file: ${row.path}\nOriginal source (attribution only): ${row.source}\nResolve relative references and scripts against ${dirname(row.path)}.${cliNote}\n\n${instructionBody(markdown)}`,
      metadata: {source: row.source, local: true, repo: row.repo}};
  }

  async search(query = '', offset = 0, limit = 20, signal) {
    await this.refresh(signal);
    const words = [...new Set(query.toLowerCase().split(/\W+/).filter(Boolean))];
    const rows = [...this.entries.values()].map(row => ({row, score: words.reduce((n, word) =>
      n + (row.title + ' ' + row.description + ' ' + row.repo).toLowerCase().split(word).length - 1, 0)}))
      .filter(item => !words.length || item.score).sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));
    return {total: rows.length, entries: rows.slice(offset, offset + limit).map(item => item.row),
      nextOffset: offset + limit < rows.length ? offset + limit : null,
      localOnly: true, installedSkills: this.entries.size,
      unavailableCatalogEntries: this.manifest.unavailable?.length || 0, snapshot: this.manifest.createdAt};
  }
}
