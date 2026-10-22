import importlib.util
import re
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('mirror', Path(__file__).resolve().parents[1] / 'scripts/download-library.py')
mirror = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mirror)


class LibraryTest(unittest.TestCase):
    def test_directory_sources_resolve_to_verified_repositories(self):
        self.assertEqual(mirror.source_repo('https://officialskills.sh/WordPress/skills/wp-plugin-development'), 'WordPress/agent-skills')
        self.assertEqual(mirror.source_repo('https://officialskills.sh/google-labs-code/skills/stitch-loop'), 'google-labs-code/stitch-loop')
        self.assertIsNone(mirror.source_repo('https://github.com/../outside'))
        self.assertIsNone(mirror.source_repo('http://github.com/a/b'))

    def test_collection_expansion_preserves_files_and_valid_names(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = ['skills/first/SKILL.md', 'skills/second/SKILL.md']
            for index, relative in enumerate(files):
                path = root / 'repos/writer/collection' / relative
                path.parent.mkdir(parents=True)
                path.write_text('---\nname: ' + ('a' * 47 + '-long-name' if index else 'first') + '\ndescription: Local workflow\n---\n# Body\n')
            catalog = {'entries': [{'name': 'va-collection', 'title': 'Collection', 'description': 'Workflows', 'source': 'https://github.com/writer/collection'}, {'name': 'missing', 'source': 'https://github.com/missing/repository'}]}
            results = [{'repo': 'writer/collection', 'status': 'downloaded', 'skills': files}]
            manifest = mirror.build_manifest(catalog, results, root)
            self.assertEqual(len(manifest['entries']), 2)
            self.assertEqual(manifest['coveredCatalogEntries'], 1)
            self.assertEqual([row['name'] for row in manifest['unavailable']], ['missing'])
            for row in manifest['entries']:
                self.assertRegex(row['name'], r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
                self.assertTrue((root / row['path']).is_file())


if __name__ == '__main__':
    unittest.main()
