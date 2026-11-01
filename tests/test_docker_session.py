"""Docker session bridge must capture credentials and reject missing/invalid sessions."""
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('docker_session', Path(__file__).resolve().parents[1] / 'scripts/docker-aws-session.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class DockerSessionTest(unittest.TestCase):
    def test_selected_session_is_captured_and_overrides_stale_environment(self):
        payload = {'AccessKeyId': 'fictional-access', 'SecretAccessKey': 'fictional-secret', 'SessionToken': 'fictional-token'}
        result = subprocess.CompletedProcess([], 0, stdout=json.dumps(payload), stderr='')
        with patch.object(bridge.subprocess, 'run', return_value=result) as run:
            environment = bridge.session_environment('demo-profile', {'AWS_PROFILE': 'old-profile', 'AWS_ACCESS_KEY_ID': 'stale', 'KEEP': 'yes'})
        self.assertEqual(environment['AWS_ACCESS_KEY_ID'], payload['AccessKeyId'])
        self.assertEqual(environment['AWS_PROFILE'], '')
        self.assertEqual(environment['KEEP'], 'yes')
        self.assertTrue(run.call_args.kwargs['capture_output'])
        self.assertEqual(run.call_args.args[0][4:6], ['demo-profile', '--format'])

    def test_missing_or_non_session_credentials_fail_without_echoing_provider_output(self):
        for result in [subprocess.CompletedProcess([], 1, stdout='private-output', stderr='private-error'),
                       subprocess.CompletedProcess([], 0, stdout='invalid-private-output', stderr=''),
                       subprocess.CompletedProcess([], 0, stdout='{}', stderr='')]:
            with self.subTest(status=result.returncode), patch.object(bridge.subprocess, 'run', return_value=result):
                with self.assertRaises(RuntimeError) as raised:
                    bridge.session_environment('demo-profile', {})
                self.assertNotIn('private', str(raised.exception))
