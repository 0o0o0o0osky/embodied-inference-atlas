from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from tools.lib.contracts import Issue, load_manifest
from tools.lib.jsonio import load_json
from tools.lib.privacy import perfetto_asset_paths, scan_site_tree
from tools.validate import format_issue, validate_repository


FRONTEND_DATA_VERSION = "1.0.0"
FRONTEND_DATA_PATH = Path("assets/data/atlas-data.json")


@dataclass(frozen=True)
class BuildResult:
    pages: tuple[str, ...]
    checked: bool


class BuildError(RuntimeError):
    """Raised when canonical data or a generated release tree is unsafe."""


def build_site(repo_root: Path, output_dir: Path, check: bool = False) -> BuildResult:
    """Build the offline React application from validated canonical documents."""
    repo_root = repo_root.resolve()
    output_dir = output_dir.resolve()
    datasets = load_validated_datasets(repo_root / "data", repo_root)

    output_dir.parent.mkdir(parents=True, exist_ok=True)
    candidate = Path(tempfile.mkdtemp(prefix="atlas-site-", dir=output_dir.parent))
    try:
        _build_frontend(repo_root, candidate)
        _write_frontend_data(candidate / FRONTEND_DATA_PATH, datasets)

        issues = scan_site_tree(candidate)
        if issues:
            raise BuildError(format_issues(issues))

        pages = tuple(
            sorted(
                path.relative_to(candidate).as_posix()
                for path in candidate.rglob("*.html")
                if path.is_file()
            )
        )
        expected_pages = {"index.html"}
        if (candidate / "perfetto").is_dir():
            expected_pages.update(name for name in perfetto_asset_paths() if name.endswith(".html"))
        if set(pages) != expected_pages:
            raise BuildError("frontend build must emit one application entry and only pinned Perfetto HTML pages")
        if not check:
            replace_tree(candidate, output_dir)
        return BuildResult(pages=pages, checked=check)
    finally:
        if candidate.exists():
            shutil.rmtree(candidate)


def load_validated_datasets(
    data_root: Path, repo_root: Path
) -> dict[str, list[dict[str, object]]]:
    """Load manifest datasets after the repository's closed-boundary validation."""
    issues = validate_repository(repo_root)
    if issues:
        raise BuildError(format_issues(issues))

    manifest = load_manifest(repo_root)
    entries = manifest.get("datasets")
    if not isinstance(entries, Mapping):
        raise BuildError("schema/manifest.json: invalid_manifest: datasets are not configured")

    datasets: dict[str, list[dict[str, object]]] = {}
    for name in sorted(entries):
        entry = entries[name]
        if not isinstance(entry, Mapping):
            raise BuildError(f"schema/manifest.json: invalid_manifest: {name} is invalid")
        primary_key = entry.get("primary_key")
        if not isinstance(primary_key, str):
            raise BuildError(f"schema/manifest.json: invalid_manifest: {name} has no primary key")
        records: list[dict[str, object]] = []
        for path in _canonical_document_paths(data_root, entry):
            document = load_json(path)
            values = document.get("records")
            if not isinstance(values, list):
                raise BuildError(f"{path.name}: invalid_document: records are not configured")
            records.extend(dict(record) for record in values if isinstance(record, Mapping))
        datasets[name] = sorted(records, key=lambda record: str(record[primary_key]))
    return datasets


def replace_tree(candidate: Path, output_dir: Path) -> None:
    backup = output_dir.with_name(f".{output_dir.name}.previous")
    if backup.exists():
        shutil.rmtree(backup)
    if output_dir.exists() or output_dir.is_symlink():
        os.replace(output_dir, backup)
    try:
        os.replace(candidate, output_dir)
    except OSError:
        if backup.exists():
            os.replace(backup, output_dir)
        raise
    if backup.exists():
        shutil.rmtree(backup)


def format_issues(issues: list[Issue]) -> str:
    return "\n".join(format_issue(issue) for issue in issues)


def _build_frontend(repo_root: Path, destination: Path) -> None:
    npm = shutil.which("npm")
    if npm is None:
        raise BuildError("npm is required to build the offline application")
    if not (repo_root / "package-lock.json").is_file():
        raise BuildError("package-lock.json is required for a deterministic frontend build")

    command = (
        npm,
        "run",
        "build",
        "--",
        "--outDir",
        str(destination),
        "--emptyOutDir",
    )
    completed = subprocess.run(
        command,
        cwd=repo_root,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if completed.returncode:
        output = completed.stdout.strip()
        detail = f"\n{output}" if output else ""
        raise BuildError(f"frontend build failed with exit code {completed.returncode}{detail}")
    if not (destination / "index.html").is_file():
        raise BuildError("frontend build did not emit index.html")


def _write_frontend_data(
    path: Path, datasets: Mapping[str, list[dict[str, object]]]
) -> None:
    payload = {"format_version": FRONTEND_DATA_VERSION, "datasets": dict(datasets)}
    content = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    _write_text_atomic(path, f"{content}\n")


def _canonical_document_paths(
    data_root: Path, entry: Mapping[str, object]
) -> list[Path]:
    configured = entry.get("data")
    if isinstance(configured, str):
        return [_canonical_data_path(data_root, configured)]
    configured_glob = entry.get("data_glob")
    if isinstance(configured_glob, str):
        relative = _data_relative_path(configured_glob)
        return sorted(path for path in data_root.glob(str(relative)) if path.is_file())
    raise BuildError("schema/manifest.json: invalid_manifest: dataset data is not configured")


def _canonical_data_path(data_root: Path, configured: str) -> Path:
    path = data_root / _data_relative_path(configured)
    if not path.is_file():
        raise BuildError(f"missing canonical dataset: {configured}")
    return path


def _data_relative_path(configured: str) -> Path:
    path = Path(configured)
    if path.is_absolute() or not path.parts or path.parts[0] != "data" or ".." in path.parts:
        raise BuildError("schema/manifest.json: invalid_manifest: dataset path escapes data")
    return Path(*path.parts[1:])


def _write_text_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, delete=False
    ) as handle:
        handle.write(content)
        temporary = Path(handle.name)
    os.replace(temporary, path)
