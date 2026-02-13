#!/usr/bin/env python3
import argparse
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def run_step(title, cmd, cwd):
    print(f"\n== {title} ==")
    print(f"$ {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=str(cwd))
    if result.returncode != 0:
        print(f"{title} failed with exit code {result.returncode}", file=sys.stderr)
        return False
    print(f"{title} passed")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Project test suite runner (backend tests, frontend build, optional smoke)"
    )
    parser.add_argument(
        "--base",
        default="http://localhost:5001",
        help="Backend base URL for smoke test",
    )
    parser.add_argument(
        "--skip-smoke",
        action="store_true",
        help="Skip smoke test step",
    )
    parser.add_argument(
        "--backend-python",
        default=None,
        help="Python interpreter for backend tests (defaults to backend/venv/bin/python if present)",
    )
    args = parser.parse_args()

    backend_dir = REPO_ROOT / "backend"
    frontend_dir = REPO_ROOT / "frontend"
    default_backend_python = backend_dir / "venv" / "bin" / "python"
    backend_python = args.backend_python or (
        str(default_backend_python) if default_backend_python.exists() else sys.executable
    )

    ok = run_step(
        "Backend unit tests",
        [backend_python, "-m", "unittest", "discover", "-s", "tests"],
        backend_dir,
    )
    if not ok:
        return 1

    ok = run_step(
        "Frontend unit tests",
        ["npm", "run", "test:unit"],
        frontend_dir,
    )
    if not ok:
        return 1

    ok = run_step(
        "Frontend build",
        ["npm", "run", "build"],
        frontend_dir,
    )
    if not ok:
        return 1

    if not args.skip_smoke:
        ok = run_step(
            "API smoke test",
            [sys.executable, "tools/smoke.py", "--base", args.base],
            REPO_ROOT,
        )
        if not ok:
            return 1

    print("\nTest suite OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
