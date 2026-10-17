"""Rebuild LIVE Control Plane v38 from the verified v107 Edge source archive.

This operates on local source only. The archived manifest stays private and is
checked by digest; the tracked patch contains code changes, never credentials.
An output directory is left only after every reconstructed file matches its
expected digest. The source archive is never changed.
"""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

BASE_MANIFEST_SHA256 = "4008cc502a41f5948cfea8e2d06fa3be26ff4f4f7828839f707724b7c49f1488"
BASE_VERSION = 37
CURRENT_VERSION = 38
SLUG = "openfolk-control-plane"
PATCH_SHA256 = "c9884af4d71ffa343a039df62cd50662de6b5fcf9f000ae2177dfdb0698ef4d2"
CHANGED = {
    "index.ts": "00a3476d5488389e35a94306b91b1917c3ed2109c5cf618e288f0af6473583c1",
    "work/supabase/functions/_shared/controlplane/authz.ts": "784796439ceb49050808b14e981b1cae3ff217b10a6996bba250c5d0dc48cfb6",
    "work/supabase/functions/_shared/controlplane/roster.ts": "7d3733818cd15ba3415b4ea76542f8064a3a1ed855f07ee5e55edd572c61fc17",
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fail(message):
    raise RuntimeError(message)


def verify_source(root):
    manifest_path = root / "manifest.private.json"
    if not manifest_path.is_file() or sha(manifest_path) != BASE_MANIFEST_SHA256:
        fail("Pinned v107 manifest unavailable or changed")
    manifest = json.loads(manifest_path.read_text())
    entries = manifest.get("entries", [])
    if manifest.get("project") != "tgbnakbxwcqjeimygroz" or len(entries) != 103:
        fail("Unexpected v107 function inventory")
    entry = next((row for row in entries if row.get("slug") == SLUG), None)
    if not entry or entry.get("version") != BASE_VERSION or len(entry.get("files", [])) != 24:
        fail("Unexpected v107 Control Plane inventory")
    source = root / SLUG / "supabase" / "functions" / SLUG
    paths = set()
    for item in entry["files"]:
        name = item.get("path")
        if not isinstance(name, str) or name.startswith("/") or ".." in Path(name).parts or name in paths:
            fail("Invalid archived source path")
        paths.add(name)
        file = source / name
        if not file.is_file() or file.is_symlink() or file.stat().st_size != item["bytes"] or sha(file) != item["sha256"]:
            fail("Archived Control Plane source changed")
    actual = {str(path.relative_to(source)) for path in source.rglob("*") if path.is_file()}
    if actual != paths or not set(CHANGED).issubset(paths):
        fail("Archived Control Plane file list changed")
    return source, entry


def reconstruct(root, patch, output):
    if not patch.is_file() or sha(patch) != PATCH_SHA256:
        fail("Pinned Control Plane overlay patch unavailable or changed")
    source, entry = verify_source(root)
    if output.exists():
        fail("Output already exists")
    output.mkdir(mode=0o700, parents=True)
    try:
        shutil.copytree(source, output, dirs_exist_ok=True)
        result = subprocess.run(["git", "apply", "--check", str(patch)], cwd=output,
                                capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            fail("Overlay patch does not apply to pinned v107 source")
        result = subprocess.run(["git", "apply", str(patch)], cwd=output,
                                capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            fail("Overlay patch failed")
        for item in entry["files"]:
            name = item["path"]
            expected = CHANGED.get(name, item["sha256"])
            if sha(output / name) != expected:
                fail(f"Reconstructed source digest mismatch: {name}")
        actual = {str(path.relative_to(output)) for path in output.rglob("*") if path.is_file()}
        if actual != {item["path"] for item in entry["files"]}:
            fail("Reconstructed file list changed")
    except BaseException:
        shutil.rmtree(output, ignore_errors=True)
        raise
    return {"baseManifestSha256": BASE_MANIFEST_SHA256, "baseVersion": BASE_VERSION,
            "reconstructedVersion": CURRENT_VERSION, "filesVerified": len(entry["files"]),
            "changedFiles": len(CHANGED), "sourceOnly": True, "credentialRecoveryProven": False,
            "productionWrites": False, "providerRequests": 0}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--patch", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(reconstruct(args.archive.resolve(), args.patch.resolve(),
                                     args.output.resolve()), sort_keys=True))
    except BaseException as error:
        print(json.dumps({"state": "overlay_unverified", "code": str(error)}), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
