"""Stage the exact reviewed LIVE Edge archive into isolated function trees.

This is local source recovery preparation only. It never reads an escrow key,
contacts production, deploys, or loads runtime secret values.
"""
import argparse
import json
import os
import shutil
import tempfile
from pathlib import Path, PurePosixPath

from package_live_runtime_archive import PackageError, require, verify_archive, digest

REVIEWED = {
    'v104': (
        Path('.verification-results/build01-runtime-archive-2026-10-16T20-46-18-125Z'),
        'f9dc270c53c5a964b436b70bed3d6da2b06f9810ea330ee45444b8c3de931da8',
        Path('.verification-results/build01-edge-staged-v104'),
    ),
    'v106': (
        Path('.verification-results/build01-runtime-archive-2026-10-16T22-03-23-328Z'),
        'ed8ca3970251af3fe843dab9153f9c149a1f824513f245b2492e795a96026da6',
        Path('.verification-results/build01-edge-staged-v106'),
    ),
}


def staged_path(slug, source_path):
    path = PurePosixPath(source_path)
    if path.parts[:1] == ('functions',):
        target = PurePosixPath('supabase') / path
    elif path.parts[:2] == ('work', 'supabase'):
        target = PurePosixPath(*path.parts[1:])
    elif len(path.parts) == 1:
        target = PurePosixPath('supabase', 'functions', slug, path.name)
    else:
        raise PackageError('runtime_staging_path_unrecognised')
    allowed_owner = target.parts[2] in ('_shared', slug) or (
        slug == 'learn-data-import' and target.parts[2] == 'data-import'
        and str(target) == 'supabase/functions/data-import/handler.ts')
    require(target.parts[:2] == ('supabase', 'functions')
            and len(target.parts) >= 4 and allowed_owner,
            'runtime_staging_target_invalid')
    return target


def stage(reviewed):
    root_path, manifest_sha, output = REVIEWED[reviewed]
    root = root_path.resolve(strict=True)
    raw, _, manifest = verify_archive(root, manifest_sha, 103)
    require(not output.exists() and output.parent.is_dir()
            and not output.parent.is_symlink(), 'runtime_staging_output_exists_or_invalid')
    temp = Path(tempfile.mkdtemp(prefix='.edge-staging-', dir=output.parent))
    os.chmod(temp, 0o700)
    files = 0
    copied = 0
    try:
        for entry in manifest['entries']:
            slug = entry['slug']
            for item in entry['files']:
                target = temp / slug / staged_path(slug, item['path'])
                source = root / slug / 'supabase' / 'functions' / slug / item['path']
                require(not target.exists(), 'runtime_staging_path_collision')
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                body = source.read_bytes()
                require(len(body) == item['bytes'] and digest(source) == item['sha256'],
                        'runtime_source_changed_during_staging')
                with target.open('xb') as out:
                    os.chmod(target, 0o600)
                    out.write(body)
                require(digest(target) == item['sha256'], 'runtime_staged_source_mismatch')
                files += 1
                copied += len(body)
        summary = {
            'contract': 'build01-live-edge-staging/1',
            'sourceManifestSha256': manifest_sha,
            'functions': len(manifest['entries']), 'files': files,
            'sourceBytes': copied,
            'limitation': 'Local per-function source staging only; no all-function build or service restore proof.',
        }
        with (temp / 'staging-summary.json').open('x') as out:
            os.chmod(temp / 'staging-summary.json', 0o600)
            json.dump(summary, out, sort_keys=True)
            out.write('\n')
        os.replace(temp, output)
        return summary
    except BaseException:
        shutil.rmtree(temp)
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--stage-reviewed-v104', action='store_true')
    parser.add_argument('--stage-reviewed-v106', action='store_true')
    args = parser.parse_args()
    require(args.stage_reviewed_v104 != args.stage_reviewed_v106,
            'runtime_staging_exact_mode_required')
    print(json.dumps(stage('v104' if args.stage_reviewed_v104 else 'v106'), sort_keys=True))


if __name__ == '__main__':
    main()
