"""Build a deterministic, source-only connector download from an explicit allowlist."""
from pathlib import Path
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = {
    'scripts/campus-driver.mjs': 'scripts/campus-driver.mjs',
    'scripts/campus-relay.mjs': 'scripts/campus-relay.mjs',
    'lib/world-decision.ts': 'lib/world-decision.ts',
    'README.md': 'scripts/CONNECTOR_README.md',
}
package = {
    'name': 'nju-campus-personal-connector', 'version': '0.2.0',
    'private': True, 'type': 'module', 'engines': {'node': '>=24.0.0'},
    'scripts': {'start': 'node scripts/campus-driver.mjs --relay'},
    'dependencies': {'zod': '4.3.6'},
}
archive = ROOT / 'public/downloads/campus-connector.zip'
archive.parent.mkdir(parents=True, exist_ok=True)
contents = {name: (ROOT / source).read_bytes() for name, source in FILES.items()}
contents['package.json'] = (json.dumps(package, indent=2) + '\n').encode()
contents['.gitignore'] = b'node_modules/\n.campus-local/\n'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
    for name, data in sorted(contents.items()):
        info = zipfile.ZipInfo(name, (2026, 9, 11, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        bundle.writestr(info, data)
with zipfile.ZipFile(archive) as bundle:
    assert set(bundle.namelist()) == set(contents)
    assert bundle.testzip() is None
    for name, data in contents.items():
        assert bundle.read(name) == data
print(f'Personal connector: {len(contents)} reviewed files, {archive.stat().st_size} bytes; no credentials or local state.')
