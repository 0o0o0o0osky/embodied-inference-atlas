from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

from tools.lib.jsonio import load_json
from tools.lib.promotion import PromotionError, apply_promotion, plan_promotion
from tools.validate import format_issue


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Review and promote a sanitized bundle"
    )
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--apply", action="store_true", help="write the reviewed promotion")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        plan = plan_promotion(load_json(args.bundle), Path.cwd())
    except (OSError, ValueError) as error:
        if isinstance(error, PromotionError) and error.issues:
            for issue in error.issues:
                print(format_issue(issue), file=sys.stderr)
        else:
            print(f"bundle: promotion_error: {error}", file=sys.stderr)
        return 1
    print(plan.diff, end="")
    if args.apply:
        try:
            apply_promotion(plan)
        except PromotionError as error:
            print(f"bundle: promotion_error: {error}", file=sys.stderr)
            return 1
        except Exception:
            print("bundle: promotion_error: promotion apply failed", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
