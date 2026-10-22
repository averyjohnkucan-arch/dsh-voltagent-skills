#!/usr/bin/env python3
"""Explicit, resumable local snapshot download. Never runs repository scripts."""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request

HERE = Path(__file__).resolve().parents[1]
SOURCE_REPOSITORIES = json.loads((HERE / 'data/source-repositories.json').read_text())


def source_repo(source):
    u = urllib.parse.urlparse(source)
    p = u.path.strip('/').split('/')
    if u.scheme == 'https' and u.hostname == 'officialskills.sh' and len(p) >= 3:
        known = SOURCE_REPOSITORIES.get(p[0], {})
        return source_repo('https://github.com/' + known.get('skills', {}).get(p[-1], known.get('repo', '/'.join(p[:2]))))
    if u.scheme == 'https' and u.hostname in ('github.com', 'officialskills.sh') and len(p) >= 2:
        if all(re.fullmatch(r'[\w.-]+', s) and s not in ('.', '..') for s in p[:2]):
            return '/'.join(p[:2]).removesuffix('.git')


def atomic_json(path, value):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, indent=2) + '\n')
    temp.replace(path)


def download(repo, library):
    if source_repo('https://github.com/' + repo) != repo:
        return {'repo': repo, 'status': 'unavailable', 'error': 'Invalid GitHub repository name.'}
    dest = library / 'repos' / repo
    marker = dest / '.dsh-snapshot.json'
    if marker.exists():
        return json.loads(marker.read_text())
    url = f'https://codeload.github.com/{repo}/tar.gz/HEAD'
    result = {'repo': repo, 'source': f'https://github.com/{repo}', 'url': url}
    start = time.monotonic()
    staging = None
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix='.download-', dir=dest.parent))
        archive = staging / 'source.tar.gz'
        digest = hashlib.sha256()
        size = 0
        request = urllib.request.Request(url, headers={'User-Agent': 'dsh-local-skills/0.2'})
        with urllib.request.urlopen(request, timeout=40) as response, archive.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > 512 * 1024 * 1024 or time.monotonic() - start > 600:
                    raise ValueError('Repository snapshot exceeds download limit (512 MiB / 600s).')
                digest.update(chunk)
                output.write(chunk)
        unpack = staging / 'unpack'
        unpack.mkdir()
        with tarfile.open(archive) as tar:
            members = tar.getmembers()
            if sum(m.size for m in members) > 2 * 1024 * 1024 * 1024:
                raise ValueError('Repository snapshot exceeds 2 GiB extracted limit.')
            # Python's data filter rejects outside paths, unsafe links and device files.
            tar.extractall(unpack, filter='data')
        roots = list(unpack.iterdir())
        if len(roots) != 1 or not roots[0].is_dir():
            raise ValueError('Unexpected repository archive layout.')
        root = roots[0]
        skills = []
        for path in root.rglob('SKILL.md'):
            relative = path.relative_to(root)
            if not path.is_file() or any(p in ('node_modules', '.git', 'test', 'tests', 'fixtures') for p in relative.parts):
                continue
            if path.stat().st_size > 2 * 1024 * 1024:
                continue
            # Resolve only within the downloaded source, including safe internal symlinks.
            path.resolve().relative_to(root.resolve())
            skills.append(relative.as_posix())
        result.update(status='downloaded', archiveSha256=digest.hexdigest(), bytes=size,
                      files=sum(m.isfile() for m in members), skills=sorted(skills),
                      downloadedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
        atomic_json(root / '.dsh-snapshot.json', result)
        if dest.exists():
            raise ValueError('Destination exists without a snapshot marker; refusing to overwrite.')
        root.rename(dest)
        return result
    except Exception as error:
        return {**result, 'status': 'unavailable', 'error': str(error)}
    finally:
        if staging:
            shutil.rmtree(staging, ignore_errors=True)


def frontmatter(markdown):
    # Only metadata is read; downloaded instruction bodies are never executed here.
    if not markdown.startswith('---\n'):
        return {}
    head = markdown.split('\n---', 1)[0][4:]
    result = {}
    for key in ('name', 'description'):
        match = re.search(r'^' + key + r':\s*(.*?)(?=\n[^\s#]|\Z)', head, re.M | re.S)
        if match:
            value = match[1].strip().removeprefix('>-').removeprefix('>').removeprefix('|-').removeprefix('|').strip()
            result[key] = re.sub(r'\s+', ' ', value).strip('"\'')
    return result


def build_manifest(catalog, results, library):
    entries, unavailable = [], []
    by_repo = {r['repo']: r for r in results}
    aliases = {}
    covered = set()
    for row in catalog['entries']:
        repo = source_repo(row['source'])
        result = by_repo.get(repo, {})
        paths = result.get('skills', [])
        u = urllib.parse.urlparse(row['source'])
        parts = u.path.strip('/').split('/')
        selected = []
        if u.hostname == 'officialskills.sh' and len(parts) > 2:
            slug = parts[-1]
            selected = [p for p in paths if p.split('/')[-2:-1] == [slug]]
            if not selected:
                selected = [p for p in paths if frontmatter((library / 'repos' / repo / p).read_text(errors='replace')).get('name') == slug]
        elif len(parts) > 4 and parts[2] in ('tree', 'blob'):
            target = urllib.parse.unquote('/'.join(parts[4:])).rstrip('/')
            selected = [p for p in paths if p == target or p == target + '/SKILL.md']
        else:
            exact = [p for p in paths if p == 'SKILL.md' or p.split('/')[-2:-1] == [parts[1]]]
            selected = exact or paths
        if selected:
            covered.add(row['name'])
            if len(selected) == 1:
                aliases.setdefault((repo, selected[0]), []).append(row)
        else:
            unavailable.append({**row, 'reason': result.get('error', 'No matching local SKILL.md; this may be a collection or a service listing.')})
    for result in results:
        if result['status'] != 'downloaded':
            continue
        repo = result['repo']
        for relative in result['skills']:
            path = library / 'repos' / repo / relative
            metadata = frontmatter(path.read_text(errors='replace'))
            slug = re.sub(r'[^a-z0-9]+', '-', metadata.get('name', Path(relative).parent.name).lower()).strip('-')[:48].rstrip('-') or 'skill'
            canonical = f'https://github.com/{repo}/blob/HEAD/{relative}'
            names = aliases.get((repo, relative), [])
            if not names:
                names = [{'name': f'va-{slug}-{hashlib.sha256(canonical.encode()).hexdigest()[:8]}',
                          'title': f'{repo}: {slug}', 'description': metadata.get('description', slug), 'source': canonical}]
            # One advertised name per physical skill; preserve catalog aliases for explicit loads.
            row = names[0]
            entry = {**row, 'description': metadata.get('description') or row['description'],
                     'path': path.relative_to(library).as_posix(), 'repo': repo,
                     'aliases': [n['name'] for n in names[1:]]}
            if repo == 'danjdewhurst/story-skills':
                entry['cli'] = f'repos/{repo}/bin/story.js'
            entries.append(entry)
    return {'schemaVersion': 1, 'localOnly': True,
            'createdAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'catalogEntries': len(catalog['entries']), 'coveredCatalogEntries': len(covered),
            'entries': entries, 'unavailable': unavailable, 'repositories': results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--library', type=Path, default=Path(os.environ.get('DSH_HOME', str(Path.home() / '.dsh'))) / 'dsh-voltagent-skills' / 'library')
    parser.add_argument('--workers', type=int, default=6)
    parser.add_argument('--repo', action='append', help='Download only these repositories; existing snapshots are still indexed.')
    parser.add_argument('--index-only', action='store_true', help='Rebuild the manifest from existing snapshots without network access.')
    args = parser.parse_args()
    library = args.library.resolve()
    library.mkdir(parents=True, exist_ok=True)
    catalog = json.loads((HERE / 'data/catalog.json').read_text())
    repos = sorted({source_repo(r['source']) for r in catalog['entries']} - {None})
    priority = ['danjdewhurst/story-skills', 'Nanako0129/sepia', 'forjd/better-writing']
    repos = args.repo or priority + [r for r in repos if r not in priority]
    if args.index_only:
        repos = []
    results = {}
    if (library / 'download-status.json').exists():
        for result in json.loads((library / 'download-status.json').read_text()).get('repositories', []):
            results[result['repo']] = result
    for marker in (library / 'repos').glob('*/*/.dsh-snapshot.json'):
        result = json.loads(marker.read_text())
        results[result['repo']] = result
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.workers, 8))) as pool:
        pending = {pool.submit(download, repo, library): repo for repo in repos}
        for count, future in enumerate(concurrent.futures.as_completed(pending), 1):
            result = future.result()
            results[result['repo']] = result
            print(f'{count}/{len(repos)} {result["repo"]}: {result["status"]}, {len(result.get("skills", []))} skills' + (f' ({result["error"]})' if 'error' in result else ''), flush=True)
            atomic_json(library / 'download-status.json', {'completed': count, 'total': len(repos), 'repositories': list(results.values())})
    manifest = build_manifest(catalog, list(results.values()), library)
    atomic_json(library / 'manifest.json', manifest)
    print(json.dumps({'localSkills': len(manifest['entries']), 'coveredCatalogEntries': manifest['coveredCatalogEntries'], 'unavailableCatalogEntries': len(manifest['unavailable']), 'library': str(library)}), flush=True)


if __name__ == '__main__':
    main()
