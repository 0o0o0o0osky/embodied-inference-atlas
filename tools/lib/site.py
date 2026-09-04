from __future__ import annotations

import html
import json
import os
import shutil
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from string import Template

from tools.lib.contracts import Issue, load_manifest
from tools.lib.jsonio import load_json
from tools.lib.privacy import scan_release_tree
from tools.validate import format_issue, validate_repository


@dataclass(frozen=True)
class BuildResult:
    pages: tuple[str, ...]
    checked: bool


class BuildError(RuntimeError):
    """Raised when canonical data or a generated release tree is unsafe."""


def json_for_script(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).replace("</", "<\\/")


def render_template(
    template: str,
    *,
    title: str,
    root_prefix: str,
    content: str,
    page_data: object,
    page_script: str,
) -> str:
    return Template(template).substitute(
        title=html.escape(title),
        root_prefix=root_prefix,
        content=content,
        page_data=json_for_script(page_data),
        page_script=page_script,
    )


def build_site(repo_root: Path, output_dir: Path, check: bool = False) -> BuildResult:
    """Build the offline shell from validated canonical documents only."""
    repo_root = repo_root.resolve()
    output_dir = output_dir.resolve()
    datasets = load_validated_datasets(repo_root / "data", repo_root)
    pages = render_foundation_pages(datasets, repo_root / "web")
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    candidate = Path(tempfile.mkdtemp(prefix="atlas-site-", dir=output_dir.parent))
    try:
        write_pages(candidate, pages)
        copy_static_assets(repo_root, candidate)
        issues = scan_release_tree(candidate)
        if issues:
            raise BuildError(format_issues(issues))
        if not check:
            replace_tree(candidate, output_dir)
        return BuildResult(pages=tuple(sorted(pages)), checked=check)
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


def render_foundation_pages(
    datasets: Mapping[str, list[dict[str, object]]], web_root: Path
) -> dict[str, str]:
    template = (web_root / "templates" / "base.html").read_text(encoding="utf-8")
    content = _index_content(datasets)
    return {
        "index.html": render_template(
            template,
            title="Embodied Inference Atlas",
            root_prefix="",
            content=content,
            page_data={"datasets": datasets},
            page_script="",
        )
    }


def write_pages(root: Path, pages: Mapping[str, str]) -> None:
    for relative, content in sorted(pages.items()):
        path = Path(relative)
        if path.is_absolute() or ".." in path.parts:
            raise BuildError(f"invalid page path: {relative}")
        _write_text_atomic(root / path, content)


def copy_static_assets(repo_root: Path, destination: Path) -> None:
    _copy_file(repo_root / "web" / "styles.css", destination / "assets" / "styles.css")
    _copy_tree(repo_root / "web" / "js", destination / "assets" / "js")
    _copy_tree(repo_root / "assets" / "vendor", destination / "assets" / "vendor")


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


def _canonical_document_paths(data_root: Path, entry: Mapping[str, object]) -> list[Path]:
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


def _copy_file(source: Path, destination: Path) -> None:
    if source.is_symlink() or not source.is_file():
        raise BuildError(f"missing static asset: {source.name}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)


def _copy_tree(source: Path, destination: Path) -> None:
    if source.is_symlink() or not source.is_dir():
        raise BuildError(f"missing static asset directory: {source.name}")
    for path in sorted(source.rglob("*")):
        relative = path.relative_to(source)
        target = destination / relative
        if path.is_symlink():
            raise BuildError(f"static assets cannot contain symlinks: {relative.as_posix()}")
        if path.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        elif path.is_file():
            _copy_file(path, target)


def _index_content(datasets: Mapping[str, list[dict[str, object]]]) -> str:
    cards = "".join(
        f"<li><strong>{html.escape(name)}</strong><br>{len(records)} records</li>"
        for name, records in sorted(datasets.items())
    )
    return (
        "<h1 class=\"atlas-title\">Embodied Inference Atlas</h1>"
        "<p class=\"atlas-lede\">Offline, evidence-backed views of canonical "
        "inference measurements. This file is self-contained and can be opened directly.</p>"
        f"<ul class=\"dataset-list\">{cards}</ul>"
    )


def _write_text_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, delete=False
    ) as handle:
        handle.write(content)
        temporary = Path(handle.name)
    os.replace(temporary, path)
