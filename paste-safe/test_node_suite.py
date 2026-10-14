"""Runs the JavaScript test suites (test/*.test.mjs) with Node.

Paste-Safe is a browser app; this wrapper only lets Python test runners
gate a commit on the same `node --test` run a developer does by hand.
"""
import os
import shutil
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SUITES = [os.path.join("test", "core.test.mjs"), os.path.join("test", "eval.test.mjs")]


def find_node():
    found = shutil.which("node")
    if found:
        return found
    for path in (r"C:\Program Files\nodejs\node.exe", "/usr/local/bin/node", "/usr/bin/node"):
        if os.path.exists(path):
            return path
    return None


class NodeSuite(unittest.TestCase):
    def test_suites(self):
        node = find_node()
        if not node:
            self.skipTest("node is not installed")
        missing = [s for s in SUITES if not os.path.exists(os.path.join(HERE, s))]
        self.assertEqual(missing, [], "test files are not next to this file")
        result = subprocess.run(
            [node, "--test", *SUITES],
            cwd=HERE, capture_output=True, text=True, timeout=300,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
