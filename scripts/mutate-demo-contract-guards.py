#!/usr/bin/env python3
"""
Break each signer-package and attested_at guard of the demo contracts on
purpose and check that a Foundry test notices.

WHY THIS EXISTS. GiwaDemoVault and SsiatDrop pick one of three verifiers by
the caller's `signerVariant` (a proof verifies only on the verifier of the
package that made it) and refuse a statement time `attested_at` outside
900 s behind / 300 s ahead of the block. A routing slip or an off-by-one in
the window passes every happy-path test, so each guard is broken here once.

At every step it checks that (1) the substitution matched exactly once,
(2) `forge test --match-contract <suite>` exits non-zero with at least one
[FAIL], and (3) the file is restored byte-identical (sha256).

Prerequisite: forge 1.4.3 on PATH ($HOME/.foundry/bin).

Usage (from anywhere in the workspace):
    python3 proofport-app-demo/scripts/mutate-demo-contract-guards.py

Exit code is 0 only when every mutation was applied, caught, and reverted.
"""

from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path


def project_home() -> Path:
    def ask(*args: str) -> str:
        return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout.strip()

    home = ask("rev-parse", "--show-superproject-working-tree") or ask("rev-parse", "--show-toplevel")
    return Path(home)


HOME = project_home()
CONTRACTS = HOME / "proofport-app-demo" / "contracts"
if not CONTRACTS.is_dir():
    CONTRACTS = HOME / "contracts"
if not (CONTRACTS / "foundry.toml").is_file():
    sys.exit(f"No Foundry project at {CONTRACTS}.")

SUITES = {
    "src/GiwaDemoVault.sol": "GiwaDemoVaultTest",
    "src/SsiatDrop.sol": "SsiatDropTest",
}

# (name, original, replacement) -- applied to each contract in SUITES.
MUTATIONS = [
    ("android routed to the standard verifier",
     "if (signerVariant == SIGNER_ANDROID) return VERIFIER_ANDROID;",
     "if (signerVariant == SIGNER_ANDROID) return VERIFIER_STANDARD;"),
    ("android_factory routed to the android verifier",
     "if (signerVariant == SIGNER_ANDROID_FACTORY) return VERIFIER_ANDROID_FACTORY;",
     "if (signerVariant == SIGNER_ANDROID_FACTORY) return VERIFIER_ANDROID;"),
    ("unknown variant falls back to standard",
     "revert UnknownSignerVariant(signerVariant);",
     "return VERIFIER_STANDARD;"),
    ("max age one second longer",
     "attestedAt + ATTESTED_AT_MAX_AGE < block.timestamp",
     "attestedAt + ATTESTED_AT_MAX_AGE <= block.timestamp"),
    ("max future one second shorter",
     "attestedAt > block.timestamp + ATTESTED_AT_MAX_FUTURE",
     "attestedAt >= block.timestamp + ATTESTED_AT_MAX_FUTURE"),
    ("u64 range check removed",
     "if (attestedAt > type(uint64).max) revert AttestedAtNotUint64(attestedAt);",
     ""),
    ("freshness check never called",
     "_checkAttestedAt(publicInputs[ATTESTED_AT_INDEX]);",
     ""),
    ("android verifier bytecode check removed",
     "if (VERIFIER_ANDROID.code.length == 0) revert ContractNotDeployed(VERIFIER_ANDROID);",
     ""),
]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    failures = 0
    for rel, suite in SUITES.items():
        path = CONTRACTS / rel
        original = path.read_text()
        digest = sha(path)
        try:
            for name, old, new in MUTATIONS:
                count = original.count(old)
                if count != 1:
                    print(f"NOT APPLIED  {rel}: {name} (pattern matched {count} times)")
                    failures += 1
                    continue
                path.write_text(original.replace(old, new))
                if path.read_text() == original:
                    print(f"NOT APPLIED  {rel}: {name} (file unchanged)")
                    failures += 1
                    continue
                run = subprocess.run(["forge", "test", "--match-contract", suite],
                                     cwd=CONTRACTS, capture_output=True, text=True)
                failed = sum(1 for line in run.stdout.splitlines() if line.startswith("[FAIL"))
                ran = [line for line in run.stdout.splitlines() if line.startswith("Suite result")]
                if run.returncode != 0 and failed > 0:
                    print(f"CAUGHT       {rel}: {name} ({failed} failing; {' '.join(ran)})")
                else:
                    print(f"NOT CAUGHT   {rel}: {name} (exit {run.returncode}, {failed} failing; {' '.join(ran)})")
                    if run.returncode != 0:
                        print(run.stdout[-2000:], run.stderr[-2000:])
                    failures += 1
        finally:
            path.write_text(original)
        if sha(path) != digest:
            print(f"NOT RESTORED {rel}")
            failures += 1
    total = len(SUITES) * len(MUTATIONS)
    print(f"{total - failures} of {total} mutations applied, caught and reverted.")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
