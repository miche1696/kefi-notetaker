# Agent Guidance

## CLI tools
- Smoke test: `python3 tools/smoke.py --base http://localhost:5001`
- Full test suite: `python3 tools/test_suite.py --base http://localhost:5001` (or `--skip-smoke` if backend is not running)
- Frontend unit tests: `cd frontend && npm run test:unit`
- Trace viewer: `python3 tools/trace.py --last 50` or `python3 tools/trace.py --frontend --last 50`
- Both CLIs support `--help` for usage details.

Use these to quickly verify changes and inspect logs when debugging.
