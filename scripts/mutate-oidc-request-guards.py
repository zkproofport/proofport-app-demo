#!/usr/bin/env python3
"""
Break each OIDC v2 guard of the demo on purpose and check that a test notices.

WHY THIS EXISTS. With core 0.3.0 / SDK 0.5.0-beta.3 an OIDC proof made by the
app carries a nonce bound to keccak256(scope) and the relay requestId. The
demo verifies on-chain through a fresh SDK (lib/sdk.ts createVerifierSDK)
that never created the request, so every verify call must name the request,
and the demo's own policy must expect the v2 circuit's 214 public inputs.

At every step it checks that (1) the substitution matched exactly once,
(2) vitest exits non-zero, and (3) the file is restored byte-identical
(sha256).

Prerequisite: node on PATH. NODE_OPTIONS is removed from the child
environment, because a shell that points it at a missing preload file makes
every node process exit before vitest starts.

Usage:
    python3 scripts/mutate-oidc-request-guards.py

Exit code is 0 only when every mutation was applied, caught, and reverted.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
from pathlib import Path

DEMO = Path(__file__).resolve().parent.parent
HOOK = "lib/useCredentialDemo.ts"
PAGE = "app/page.tsx"
POLICY = "lib/demo-policy.ts"
HOOK_TEST = "__tests__/verify-passes-the-request.test.tsx"
SOURCE_TEST = "__tests__/verifier-sdk.test.ts"
POLICY_TEST = "__tests__/demo-policy.test.ts"

# (name, file, original, replacement, tests that must go red)
MUTATIONS = [
    ("policy expects 148 OIDC inputs", POLICY,
     "[CIRCUIT_IDS.OIDC_DOMAIN_ATTESTATION]: OIDC_PUBLIC_INPUT_COUNT,",
     "[CIRCUIT_IDS.OIDC_DOMAIN_ATTESTATION]: 148,", [POLICY_TEST]),
    ("hook on-chain drops the request", HOOK,
     "verifyResponseOnChain(proof, undefined, { request })",
     "verifyResponseOnChain(proof)", [HOOK_TEST, SOURCE_TEST]),
    ("hook off-chain drops the request", HOOK,
     "verifyResponseOffChain(proof, { request })",
     "verifyResponseOffChain(proof)", [HOOK_TEST, SOURCE_TEST]),
    ("hook never records the request", HOOK,
     "      requestRef.current = { scope, requestId: pending.requestId };\n",
     "", [HOOK_TEST]),
    ("hook records another scope", HOOK,
     "requestRef.current = { scope, requestId: pending.requestId };",
     "requestRef.current = { scope: 'other', requestId: pending.requestId };", [HOOK_TEST]),
    ("page on-chain drops the request", PAGE,
     "verifyResponseOnChain(proofResponse, undefined, { request })",
     "verifyResponseOnChain(proofResponse)", [SOURCE_TEST]),
    ("page off-chain drops the request", PAGE,
     "verifyResponseOffChain(proofResponse, { request })",
     "verifyResponseOffChain(proofResponse)", [SOURCE_TEST]),
    ("page email card not recorded", PAGE,
     "      madeRequestIdsRef.current.email = result.requestId;\n",
     "", [SOURCE_TEST]),
]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(tests: list[str]) -> int:
    env = {k: v for k, v in os.environ.items() if k != "NODE_OPTIONS"}
    return subprocess.run(["npx", "vitest", "run", *tests], cwd=DEMO, env=env,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode


def main() -> int:
    tests = sorted({t for m in MUTATIONS for t in m[4]})
    if run(tests) != 0:
        print("[ERROR] the tests fail before any mutation; fix them first")
        return 1
    failures = 0
    for name, rel, original, replacement, must_fail in MUTATIONS:
        path = DEMO / rel
        before = sha(path)
        text = path.read_text()
        count = text.count(original)
        if count != 1:
            print(f"[NOT APPLIED] {name}: pattern found {count} times in {rel}")
            failures += 1
            continue
        path.write_text(text.replace(original, replacement))
        try:
            for test in must_fail:
                caught = run([test]) != 0
                print(f"[{'CAUGHT' if caught else 'MISSED'}] {name} -> {test}")
                failures += 0 if caught else 1
        finally:
            path.write_text(text)
        if sha(path) != before:
            print(f"[ERROR] {rel} was not restored byte-identical")
            return 1
    print(f"{len(MUTATIONS)} mutations, {failures} problems")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
