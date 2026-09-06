from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import re
from collections.abc import Mapping
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

from tools.lib.contracts import Issue


FORBIDDEN_KEYS = {
    "path", "checkpoint", "checkpoint_path", "prompt_text", "raw_log", "error",
    "sha256", "checkpoint_safetensors_sha256", "noise_sha256_float32",
    "output_sha256_float32", "hostname", "ip", "command", "environment",
}

BLOCKED_SUFFIXES = {
    ".nsys-rep", ".ncu-rep", ".sqlite", ".sqlite3", ".db", ".log",
    ".safetensors", ".gguf", ".onnx", ".engine", ".plan", ".pt", ".pth",
    ".jpg", ".jpeg", ".png", ".mp4", ".mov",
}

_WINDOWS_PATH = re.compile(r"(?i)(?<![a-z0-9])[a-z]:[\\/]")
_UNC_PATH = re.compile(r"(?<![a-z0-9_\\])\\\\[^\\\s]+\\[^\\\s]+", re.IGNORECASE)
_LOCAL_POSIX_PATH = re.compile(
    r"(?<![a-z0-9._-])/(?:home|Users|root|tmp|private|var|etc|usr|opt|mnt|media|srv|dev|proc|sys|run)(?:/|$)",
    re.IGNORECASE,
)
_PRIVATE_KEY = re.compile(r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----")
_URL = re.compile(r"[a-z][a-z0-9+.-]*://[^\s<>'\"]+", re.IGNORECASE)
_IPV4 = re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")
_IPV6 = re.compile(
    r"(?<![0-9a-f:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![0-9a-f:])",
    re.IGNORECASE,
)
_HOST_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", re.IGNORECASE)
_CPP_LOCATOR = re.compile(
    r"^[a-z0-9_./-]+#[a-z_][a-z0-9_]*(?:::[a-z_][a-z0-9_]*)+$",
    re.IGNORECASE,
)
_RUNTIME_MAPPING_PATH = re.compile(r"(?:^|\.)mappings\[\d+\]\.path$")
_CREDENTIAL_QUERY_KEYS = {
    "access_token", "accesskey", "access_key", "accesskeyid", "access_key_id",
    "api_key", "apikey", "auth", "awsaccesskeyid", "aws_access_key_id",
    "credential", "key", "password", "passwd", "secret", "security_token",
    "sig", "signature", "token",
}
_CREDENTIAL_QUERY_SUFFIXES = (
    "_accesskey", "_access_key", "_credential", "_password", "_secret",
    "_sig", "_signature", "_token",
)
_ECHARTS_SHA256 = "bf4a223524e40b77c304bec67e1222cf551f14880cf42c69dc046558e11c07b1"


def scan_json(value: object, path: str = "$") -> list[Issue]:
    issues: list[Issue] = []
    if isinstance(value, Mapping):
        for key, child in sorted(value.items(), key=lambda item: str(item[0])):
            key_text = str(key)
            child_path = f"{path}.{key_text}"
            controlled_mapping_path = (
                key_text == "path"
                and child in {"primary", "fallback"}
                and _RUNTIME_MAPPING_PATH.search(child_path) is not None
            )
            if key_text in FORBIDDEN_KEYS and not controlled_mapping_path:
                issues.append(
                    Issue(
                        child_path,
                        "forbidden_key",
                        "field is forbidden in release data",
                    )
                )
            if key_text == "url":
                if child is not None and (
                    not isinstance(child, str) or not _is_public_url(child)
                ):
                    issues.append(
                        Issue(
                            child_path,
                            "invalid_url",
                            "URL must be public and credential-free",
                        )
                    )
                if not isinstance(child, (str, type(None))):
                    issues.extend(scan_json(child, child_path))
            else:
                child_issues = scan_json(child, child_path)
                if key_text == "locator" and isinstance(child, str) and _CPP_LOCATOR.fullmatch(child):
                    locator_path, symbol = child.split("#", 1)
                    child_issues = [
                        *_scan_string(locator_path, child_path),
                        *_scan_string(symbol.replace("::", "__"), child_path),
                    ]
                issues.extend(child_issues)
    elif isinstance(value, (list, tuple)):
        for index, child in enumerate(value):
            issues.extend(scan_json(child, f"{path}[{index}]"))
    elif isinstance(value, str):
        issues.extend(_scan_string(value, path))
    return issues


def scan_release_tree(root: Path, *, verified_assets: frozenset[str] = frozenset()) -> list[Issue]:
    issues: list[Issue] = []
    if root.is_symlink():
        return [Issue("$", "symlink", "release trees must not contain symlinks")]
    if not root.exists():
        return issues
    if not root.is_dir():
        return _scan_release_file(root, Path(root.name))

    for directory, names, filenames in os.walk(root, followlinks=False):
        parent = Path(directory)
        for name in sorted(names):
            path = parent / name
            relative = path.relative_to(root)
            if path.is_symlink():
                issues.append(
                    Issue(
                        _release_path(relative),
                        "symlink",
                        "release trees must not contain symlinks",
                    )
                )
            if ".local" in relative.parts:
                issues.append(
                    Issue(
                        _release_path(relative),
                        "forbidden_path",
                        ".local must not enter a release",
                    )
                )
        names[:] = [
            name for name in names
            if not (parent / name).is_symlink() and name != ".local"
        ]
        for name in sorted(filenames):
            path = parent / name
            relative = path.relative_to(root)
            if relative.as_posix() in verified_assets and not path.is_symlink():
                continue
            issues.extend(_scan_release_file(path, relative))
    return issues


def scan_site_tree(root: Path) -> list[Issue]:
    """Scan first-party output normally; third-party exemptions require exact pinned bytes."""
    vendor_issues, verified = _verify_perfetto_assets(root)
    issues = vendor_issues + scan_release_tree(root, verified_assets=verified)
    asset = root / "assets" / "vendor" / "echarts.min.js"
    if not asset.is_file():
        return issues
    digest = hashlib.sha256(asset.read_bytes()).hexdigest()
    if digest != _ECHARTS_SHA256:
        return issues
    return [
        issue for issue in issues
        if not (
            issue.path == "$/assets/vendor/echarts.min.js"
            and issue.code == "ip_address"
        )
    ]


def perfetto_asset_paths() -> frozenset[str]:
    """Trusted build inventory lives with source code, never in generated output."""
    pin = Path(__file__).with_name("perfetto-assets.json")
    return frozenset(json.loads(pin.read_text(encoding="utf-8")))


def _verify_perfetto_assets(root: Path) -> tuple[list[Issue], frozenset[str]]:
    vendor = root / "perfetto"
    if not vendor.exists() or vendor.is_symlink():
        return [], frozenset()
    pins = json.loads(Path(__file__).with_name("perfetto-assets.json").read_text(encoding="utf-8"))
    issues: list[Issue] = []
    verified: set[str] = set()
    actual = {p.relative_to(root).as_posix(): p for p in vendor.rglob("*") if p.is_file() or p.is_symlink()}
    for name, path in actual.items():
        if name not in pins:
            issues.append(Issue(_release_path(Path(name)), "unrecognized_vendor_asset", "file is not in the pinned Perfetto distribution"))
        elif path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != pins[name]:
            issues.append(Issue(_release_path(Path(name)), "vendor_asset_mismatch", "file differs from the reviewed offline Perfetto pin"))
        else:
            verified.add(name)
    for name in pins.keys() - actual.keys():
        issues.append(Issue(_release_path(Path(name)), "missing_vendor_asset", "pinned Perfetto resource is missing"))
    return issues, frozenset(verified)


def scan_release_name(path: Path, *, symlink: bool = False) -> list[Issue]:
    issues: list[Issue] = []
    display = _release_path(path)
    if path.is_absolute() or ".." in path.parts or ".local" in path.parts:
        issues.append(
            Issue(display, "forbidden_path", "path is outside the release boundary")
        )
    if symlink:
        issues.append(Issue(display, "symlink", "release trees must not contain symlinks"))
    if _blocked_suffix(path.name):
        issues.append(
            Issue(display, "blocked_suffix", "file type is forbidden in a release")
        )
    return issues


def _scan_release_file(path: Path, relative: Path) -> list[Issue]:
    issues = scan_release_name(relative, symlink=path.is_symlink())
    if path.is_symlink() or any(issue.code == "blocked_suffix" for issue in issues):
        return issues
    try:
        payload = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return issues
    content_path = _release_path(relative)
    if path.suffix.lower() == ".json":
        try:
            value = json.loads(payload)
        except json.JSONDecodeError:
            issues.append(
                Issue(content_path, "invalid_json", "release JSON is malformed")
            )
        else:
            issues.extend(scan_json(value, content_path))
    else:
        issues.extend(_scan_string(payload, content_path))
    return issues


def _scan_string(value: str, path: str) -> list[Issue]:
    issues: list[Issue] = []
    urls = list(_URL.finditer(value))
    scrubbed = _without_matches(value, urls)
    if (
        ".local/" in scrubbed
        or ".local\\" in scrubbed
        or _WINDOWS_PATH.search(scrubbed)
        or _UNC_PATH.search(scrubbed)
        or _LOCAL_POSIX_PATH.search(scrubbed)
    ):
        issues.append(
            Issue(path, "local_path", "string contains an absolute local path")
        )
    if _PRIVATE_KEY.search(value):
        issues.append(Issue(path, "private_key", "string contains a private-key header"))
    if any(_url_has_credentials(match.group(0)) for match in urls):
        issues.append(
            Issue(
                path,
                "credential_url",
                "string contains a credential-bearing URL",
            )
        )
    if _contains_ip_address(scrubbed):
        issues.append(Issue(path, "ip_address", "literal IP addresses are forbidden"))
    return issues


def _is_public_url(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return False
    hostname = parsed.hostname
    if (
        parsed.scheme not in {"http", "https"}
        or hostname is None
        or port is not None and not 0 < port < 65536
    ):
        return False
    if parsed.username is not None or parsed.password is not None or _url_has_credentials(value):
        return False
    hostname = hostname.rstrip(".").lower()
    if hostname == "localhost" or hostname.endswith((".localhost", ".local", ".internal")):
        return False
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        return False
    labels = hostname.split(".")
    return len(labels) >= 2 and all(_HOST_LABEL.fullmatch(label) for label in labels)


def _url_has_credentials(value: str) -> bool:
    try:
        parsed = urlsplit(value)
    except ValueError:
        return True
    if parsed.username is not None or parsed.password is not None:
        return True
    parameters = parse_qsl(parsed.query, keep_blank_values=True)
    parameters.extend(parse_qsl(parsed.fragment, keep_blank_values=True))
    for key, _ in parameters:
        normalized = key.lower().replace("-", "_")
        if (
            normalized in _CREDENTIAL_QUERY_KEYS
            or normalized.endswith(_CREDENTIAL_QUERY_SUFFIXES)
        ):
            return True
    return False


def _blocked_suffix(name: str) -> bool:
    lowered = name.lower()
    return any(lowered.endswith(suffix) for suffix in BLOCKED_SUFFIXES)


def _contains_ip_address(value: str) -> bool:
    candidates = [value.strip().strip("[]")]
    candidates.extend(match.group(0) for match in _IPV4.finditer(value))
    candidates.extend(match.group(0) for match in _IPV6.finditer(value))
    for candidate in candidates:
        try:
            ipaddress.ip_address(candidate)
        except ValueError:
            continue
        return True
    return False


def _without_matches(value: str, matches: list[re.Match]) -> str:
    if not matches:
        return value
    characters = list(value)
    for match in matches:
        characters[match.start():match.end()] = " " * (match.end() - match.start())
    return "".join(characters)


def _release_path(path: Path) -> str:
    escaped = path.as_posix().encode("unicode_escape").decode("ascii")
    return f"$/{escaped}"
