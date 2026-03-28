#!/usr/bin/env python3
"""Read JSON files from a publicly shared Google Drive folder."""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


USER_AGENT = "Mozilla/5.0"


@dataclass
class DriveFile:
    file_id: str
    name: str
    url: str


def extract_folder_id(folder_value: str) -> str:
    match = re.search(r"/folders/([^/?#]+)", folder_value)
    if match:
        return match.group(1)
    return folder_value.strip()


def fetch_with_retry(url: str, timeout: int = 30, retries: int = 2) -> bytes:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT})
            with urlopen(request, timeout=timeout) as response:
                return response.read()
        except (HTTPError, URLError, OSError) as exc:
            last_error = exc
            if attempt == retries:
                break
            time.sleep(attempt + 1)
    raise RuntimeError(f"failed to fetch {url}: {last_error}")


def fetch_text(url: str, timeout: int = 30) -> str:
    return fetch_with_retry(url, timeout=timeout).decode("utf-8", "ignore")


def fetch_bytes(url: str, timeout: int = 30) -> bytes:
    return fetch_with_retry(url, timeout=timeout)


def list_public_folder_files(folder_value: str) -> list[DriveFile]:
    folder_id = extract_folder_id(folder_value)
    url = f"https://drive.google.com/embeddedfolderview?id={folder_id}#list"
    html = fetch_text(url)
    matches = re.findall(
        r'<a href="([^"]+)"[^>]*>[\s\S]*?<div class="flip-entry-title">([\s\S]*?)</div>',
        html,
    )

    files: list[DriveFile] = []
    for file_url, raw_name in matches:
        file_match = re.search(r"/file/d/([^/]+)", file_url)
        if not file_match:
            continue
        files.append(
            DriveFile(
                file_id=file_match.group(1),
                name=unescape(raw_name).strip(),
                url=file_url,
            )
        )

    return files


def readable_json_files(files: Iterable[DriveFile]) -> list[DriveFile]:
    json_files = [file for file in files if file.name.lower().endswith(".json")]
    return sorted(json_files, key=lambda item: item.name, reverse=True)


def download_public_file(file_id: str, retries: int = 2) -> bytes:
    url = f"https://drive.google.com/uc?export=download&id={file_id}"
    return fetch_bytes(url, retries=retries)


def command_list(args: argparse.Namespace) -> int:
    files = list_public_folder_files(args.folder)
    payload = [
        {"id": file.file_id, "name": file.name, "url": file.url}
        for file in files
    ]
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def command_latest(args: argparse.Namespace) -> int:
    files = readable_json_files(list_public_folder_files(args.folder))
    if not files:
        raise RuntimeError("no JSON files found in the public folder")

    latest = files[0]
    content = download_public_file(latest.file_id).decode("utf-8")
    parsed = json.loads(content)
    payload = {
        "latestFile": {
            "id": latest.file_id,
            "name": latest.name,
            "url": latest.url,
        },
        "parsed": parsed,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def command_download(args: argparse.Namespace) -> int:
    files = readable_json_files(list_public_folder_files(args.folder))
    if not files:
        raise RuntimeError("no JSON files found in the public folder")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    selected = files if args.all else files[:1]
    results: list[dict[str, str | int]] = []
    for file in selected:
        destination = output_dir / file.name
        payload = download_public_file(file.file_id)
        destination.write_bytes(payload)
        results.append(
            {
                "name": file.name,
                "id": file.file_id,
                "path": str(destination),
                "bytes": len(payload),
            }
        )

    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0


def command_archive(args: argparse.Namespace) -> int:
    files = readable_json_files(list_public_folder_files(args.folder))
    if not files:
        raise RuntimeError("no JSON files found in the public folder")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    selected = files if args.all else files[:1]
    results: list[dict[str, str | int | bool]] = []
    for file in selected:
        destination = output_dir / file.name
        if destination.exists() and not args.overwrite:
            results.append(
                {
                    "name": file.name,
                    "id": file.file_id,
                    "path": str(destination),
                    "skipped": True,
                }
            )
            continue

        payload = download_public_file(file.file_id)
        destination.write_bytes(payload)
        results.append(
            {
                "name": file.name,
                "id": file.file_id,
                "path": str(destination),
                "bytes": len(payload),
                "skipped": False,
            }
        )

    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Read JSON files from a publicly shared Google Drive folder."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="List files in the public folder")
    list_parser.add_argument("--folder", required=True, help="Public folder link or folder ID")
    list_parser.set_defaults(func=command_list)

    latest_parser = subparsers.add_parser(
        "latest", help="Read the latest JSON file in the public folder"
    )
    latest_parser.add_argument("--folder", required=True, help="Public folder link or folder ID")
    latest_parser.set_defaults(func=command_latest)

    download_parser = subparsers.add_parser(
        "download", help="Download JSON files from the public folder"
    )
    download_parser.add_argument("--folder", required=True, help="Public folder link or folder ID")
    download_parser.add_argument("--output-dir", required=True, help="Local download directory")
    download_parser.add_argument(
        "--all",
        action="store_true",
        help="Download all JSON files instead of only the latest one",
    )
    download_parser.set_defaults(func=command_download)

    archive_parser = subparsers.add_parser(
        "archive",
        help="Archive JSON files into a local json directory",
    )
    archive_parser.add_argument("--folder", required=True, help="Public folder link or folder ID")
    archive_parser.add_argument(
        "--output-dir",
        default="json",
        help="Local archive directory. Defaults to ./json",
    )
    archive_parser.add_argument(
        "--all",
        action="store_true",
        help="Archive all JSON files instead of only the latest one",
    )
    archive_parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite files that already exist in the archive directory",
    )
    archive_parser.set_defaults(func=command_archive)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except Exception as exc:  # pragma: no cover
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
