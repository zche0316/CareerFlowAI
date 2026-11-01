#!/usr/bin/env python3
"""Pass one selected temporary AWS CLI session to an already-built local app container."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def session_environment(profile, parent=None):
    # Keep credential output out of terminal output, files, source and image builds.
    result = subprocess.run(
        ['aws', 'configure', 'export-credentials', '--profile', profile, '--format', 'process'],
        capture_output=True, text=True, check=False,
    )
    if result.returncode:
        raise RuntimeError('AWS session is unavailable. Sign in with aws login for the selected profile, then retry.')
    try:
        credentials = json.loads(result.stdout)
        values = {target: credentials[source] for target, source in [
            ('AWS_ACCESS_KEY_ID', 'AccessKeyId'),
            ('AWS_SECRET_ACCESS_KEY', 'SecretAccessKey'),
            ('AWS_SESSION_TOKEN', 'SessionToken'),
        ]}
        if not all(isinstance(value, str) and value for value in values.values()):
            raise ValueError('Incomplete temporary session')
    except (ValueError, KeyError, TypeError):
        raise RuntimeError('The selected profile must resolve to a valid temporary AWS session.') from None
    environment = dict(os.environ if parent is None else parent)
    environment.update(values)
    environment['AWS_PROFILE'] = ''
    return environment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', default=os.environ.get('AWS_PROFILE') or 'careerflow')
    parser.add_argument('--project-name')
    parser.add_argument('--env-file')
    args = parser.parse_args()
    environment = session_environment(args.profile)
    command = ['docker', 'compose']
    if args.project_name:
        command += ['--project-name', args.project_name]
    if args.env_file:
        command += ['--env-file', str(Path(args.env_file).resolve())]
    command += ['-f', str(ROOT / 'compose.yaml'), '-f', str(ROOT / 'compose.aws.yaml'),
                'up', '-d', '--wait', '--no-build', '--no-deps', '--force-recreate', 'app']
    result = subprocess.run(command, cwd=ROOT, env=environment, check=False)
    return result.returncode


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (RuntimeError, FileNotFoundError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
