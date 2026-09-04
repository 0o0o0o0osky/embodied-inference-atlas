from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from extractors.common import ImportContext, SourceFormatError, read_jsonl
from extractors.flashrt import import_flashrt_shape
from extractors.lerobot import import_lerobot_shape
from extractors.vla_cpp import import_vla_cpp
from tools.lib.jsonio import write_json_atomic


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stage sanitized benchmark measurements")
    parser.add_argument(
        "--format", required=True,
        choices=("flashrt-shape", "lerobot-smolvla", "vla-cpp"),
    )
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--source-label", required=True)
    parser.add_argument("--source-id", required=True)
    parser.add_argument("--system-id", required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    context = ImportContext(args.source_label, args.source_id, args.system_id)
    try:
        output = staging_output(args.output, Path.cwd())
        records = read_jsonl(args.input, source_label=context.source_label)
        if args.format == "flashrt-shape":
            bundle = import_flashrt_shape(records, context)
        elif args.format == "lerobot-smolvla":
            bundle = import_lerobot_shape(records, context)
        else:
            bundle = import_vla_cpp(records, context)
        write_json_atomic(output, bundle)
    except (OSError, SourceFormatError, ValueError):
        print("import: rejected source or output", file=sys.stderr)
        return 1
    return 0


def staging_output(output: Path, repo_root: Path) -> Path:
    root = repo_root.resolve()
    staging = repo_root / ".local" / "staging"
    for parent in (repo_root / ".local", staging):
        if parent.is_symlink():
            raise ValueError("staging boundary is a symlink")
    resolved_staging = staging.resolve()
    resolved_output = output.resolve()
    if not _within(resolved_staging, root) or not _within(resolved_output, resolved_staging):
        raise ValueError("output is outside staging")
    return resolved_output


def _within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


if __name__ == "__main__":
    raise SystemExit(main())
