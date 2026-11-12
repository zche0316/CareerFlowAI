"""Source delivery regression: include source and configuration, exclude credentials/runtime files."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location('source_package', Path(__file__).resolve().parents[1] / 'scripts/package-source.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class SourcePackageTest(unittest.TestCase):
    def test_source_archive_includes_infrastructure_and_excludes_private_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            included = ['package-lock.json', '.env.example', 'compose.yaml', 'prisma/schema.prisma',
                        'scripts/local-run.mjs', 'packages/matching/jobs.json']
            excluded = ['.env', 'infra/aws/private.key', 'scripts/__pycache__/cached.pyc',
                        '.runtime/database/private.json', 'output/private.json']
            for name in included + excluded:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('synthetic fixture\n')
            output = root / 'candidate.zip'
            with patch.object(packager, 'ROOT', root), patch('sys.argv', ['package-source.py', '--output', str(output)]), patch.object(packager.subprocess, 'check_output', return_value='fixture-revision\n'), contextlib.redirect_stdout(io.StringIO()):
                packager.main()
            with zipfile.ZipFile(output) as archive:
                names = set(archive.namelist())
                self.assertTrue({'CareerFlowAI/' + name for name in included}.issubset(names))
                self.assertFalse({'CareerFlowAI/' + name for name in excluded} & names)
                manifest = json.loads(archive.read('CareerFlowAI/RELEASE_MANIFEST.json'))
                self.assertEqual({entry['path'] for entry in manifest['files']}, set(included))


if __name__ == '__main__':
    unittest.main()
