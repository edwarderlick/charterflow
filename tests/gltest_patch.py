"""Monkeypatch gltest.direct.sdk_loader for upstream GenVM migration.

1. Upstream GenVM migrated from genlayerlabs/genvm to genlayerlabs/genvm-manager.
2. In v0.6.0-rc8, runner and stdlib archives inside genvm-universal.tar.xz
   are packaged as .zip instead of .tar. gltest 0.29.2 hardcoded .tar, so
   we patch extract_runner to support both .zip and .tar archives.
"""

import io
import re
import tarfile
import zipfile
from pathlib import Path
from typing import Optional

import gltest.direct.sdk_loader as sdk_loader

sdk_loader.GITHUB_RELEASES_URL = "https://github.com/genlayerlabs/genvm-manager/releases"

_orig_extract_runner = sdk_loader.extract_runner


def patched_extract_runner(
    tarball_path: Path,
    runner_type: str,
    runner_hash: Optional[str] = None,
    version: Optional[str] = None,
) -> Path:
    if version is None:
        match = re.search(r"genvm-universal-(.+)\.tar\.xz", tarball_path.name)
        version = match.group(1) if match else "unknown"

    extract_base = sdk_loader.CACHE_DIR / "extracted" / version / runner_type

    if runner_hash and runner_hash.lower() != "latest":
        extract_dir = extract_base / runner_hash
        if extract_dir.exists():
            return extract_dir

    if extract_base.exists():
        existing = sorted(extract_base.iterdir(), reverse=True)
        if existing and (not runner_hash or runner_hash.lower() == "latest"):
            return existing[0]

    with tarfile.open(tarball_path, "r:xz") as outer_tar:
        prefix = f"runners/{runner_type}/"
        runner_members = [
            m.name
            for m in outer_tar.getmembers()
            if m.name.startswith(prefix)
            and (m.name.endswith(".tar") or m.name.endswith(".zip"))
        ]

        if not runner_members:
            prefix_legacy = f"executor/v0.2.17/legacy-runners/{runner_type}/"
            runner_members = [
                m.name
                for m in outer_tar.getmembers()
                if m.name.startswith(prefix_legacy)
                and (m.name.endswith(".tar") or m.name.endswith(".zip"))
            ]

        if not runner_members:
            raise ValueError(f"No {runner_type} runners found in tarball")

        if runner_hash and runner_hash.lower() != "latest":
            target_tar = f"runners/{runner_type}/{runner_hash[:2]}/{runner_hash[2:]}.tar"
            target_zip = f"runners/{runner_type}/{runner_hash[:2]}/{runner_hash[2:]}.zip"
            if target_zip in runner_members:
                chosen = target_zip
            elif target_tar in runner_members:
                chosen = target_tar
            else:
                raise ValueError(f"Runner hash {runner_hash} not found in tarball")
            extract_dir = extract_base / runner_hash
        else:
            chosen = sorted(runner_members)[-1]
            parts = chosen.split("/")
            runner_hash = parts[-2] + parts[-1].replace(".tar", "").replace(".zip", "")
            extract_dir = extract_base / runner_hash

        if extract_dir.exists():
            return extract_dir

        inner_file = outer_tar.extractfile(chosen)
        if inner_file is None:
            raise ValueError(f"Failed to read {chosen}")

        extract_dir.mkdir(parents=True, exist_ok=True)

        if chosen.endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(inner_file.read())) as z:
                z.extractall(extract_dir)
        else:
            with tarfile.open(fileobj=inner_file, mode="r:") as inner_tar:
                inner_tar.extractall(extract_dir, filter="data")

        return extract_dir


sdk_loader.extract_runner = patched_extract_runner
