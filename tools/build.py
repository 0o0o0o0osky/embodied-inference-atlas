from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from tools.lib.site import BuildError, build_site


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the offline Embodied Inference Atlas")
    parser.add_argument(
        "--check",
        action="store_true",
        help="build and scan a temporary tree without replacing site/",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    repo_root = Path(__file__).resolve().parents[1]
    try:
        result = build_site(repo_root, repo_root / "site", check=args.check)
    except BuildError as error:
        print(error, file=sys.stderr)
        return 1
    print(f"built {len(result.pages)} page(s){' for check' if result.checked else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
