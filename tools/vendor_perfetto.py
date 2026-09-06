"""Reproduce the pinned offline viewer: python3 tools/vendor_perfetto.py [--archive ZIP]."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import urllib.request
import zipfile
import io

VERSION = "v58.2"
BUILD = "v58.2-add693d8b"
URL = f"https://github.com/google/perfetto/releases/download/{VERSION}/perfetto-ui.zip"
SHA256 = "e9e35351ef95c42ae5c053f6d755ffb3369235a107c532cdd0e1da79cd48db97"
DEST = Path(__file__).resolve().parents[1] / "public" / "perfetto"


def replace_once(text: str, before: str, after: str) -> str:
    if text.count(before) != 1:
        raise ValueError(f"Pinned upstream patch context changed: {before[:100]}")
    return text.replace(before, after)


def install(archive: bytes) -> None:
    if hashlib.sha256(archive).hexdigest() != SHA256:
        raise ValueError("Perfetto archive SHA-256 does not match v58.2 pin")
    DEST.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        for member in bundle.infolist():
            if not (DEST / member.filename).resolve().is_relative_to(DEST.resolve()):
                raise ValueError("Unsafe archive path")
        bundle.extractall(DEST)
    path = DEST / BUILD / "frontend_bundle.js"
    text = path.read_text()
    # Official localhost embedder enables internal Google extensions. Use the
    # upstream third-party embedder and omit the remote extension plugin entirely.
    text = replace_once(text,
        'if (origin.endsWith(".perfetto.dev") || origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) return new PerfettoUiEmbedder();',
        '// Atlas offline patch: always use the upstream third-party embedder.')
    text = replace_once(text,
        'corePlugins.forEach((p) => pluginManager.registerPlugin(p, true));',
        'corePlugins.filter((p) => p.id !== "dev.perfetto.ExtensionServers").forEach((p) => pluginManager.registerPlugin(p, true));')
    text = replace_once(text, 'newEngineMode: "USE_HTTP_RPC_IF_AVAILABLE",', 'newEngineMode: "FORCE_BUILTIN_WASM",')
    text = replace_once(text, 'const state = await HttpRpcEngine.checkConnection();', 'const state = {connected: false}; // Atlas offline: no native RPC probe.')
    text = replace_once(text, 'meta.content = policyStr;', '''// Atlas offline: local assets only, including user-initiated tool actions.
        meta.content = "default-src 'self'; script-src 'self' 'unsafe-eval'; connect-src 'self' blob: data:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none';";''')
    path.write_text(text)
    # Maintain the upstream asset manifest's integrity entries after patching.
    manifest_path = DEST / BUILD / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["resources"]["frontend_bundle.js"] = "sha256-" + base64.b64encode(hashlib.sha256(path.read_bytes()).digest()).decode()
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    files = {str(p.relative_to(DEST)): hashlib.sha256(p.read_bytes()).hexdigest()
             for p in sorted(DEST.rglob("*")) if p.is_file() and p.name != "atlas-manifest.json" and p.name not in {"README.md"} and "licenses" not in p.parts}
    (DEST / "atlas-manifest.json").write_text(json.dumps({"version": VERSION, "build": BUILD,
        "upstream_archive": URL, "upstream_sha256": SHA256, "offline_patch": 1, "files": files}, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, help="Use a previously downloaded pinned ZIP")
    args = parser.parse_args()
    payload = args.archive.read_bytes() if args.archive else urllib.request.urlopen(URL).read()
    install(payload)
    print(f"Installed {BUILD} with offline patch 1 at {DEST}")
