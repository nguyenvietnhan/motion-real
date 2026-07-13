# Security Policy

## Supported versions

This project is pre-1.0 (`0.1.x`). Security fixes target the default branch
(`main`) only.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems that could
enable remote code execution, secret theft, SSRF, or local privilege abuse.

Email: **nguyenvietnhan.work@gmail.com**

Include:

- a clear description of the issue and impact;
- steps to reproduce (or a minimal PoC);
- affected commit / tag if known;
- whether you plan to disclose publicly and on what timeline.

You should receive an acknowledgement when practical. There is no paid bug
bounty.

## In-scope examples

- SSRF or unsafe network egress via URL ingest / image crawl
  (`packages/pipeline` safe-fetch paths)
- Desktop `media://` path escape or unauthorized file read
- IPC allow-list bypass or privilege issues in Electron main/preload
- Leakage of TTS API keys, gateway keys, or other secrets to the renderer or logs
- Authored-scene admission bypass that enables host RCE from generated TSX

## Out of scope (typical)

- Issues that require already-compromised local credentials
- Denial of service against third-party APIs (OpenAI-compatible, TTS vendors)
- Social engineering or physical access attacks
- Vulnerabilities only in third-party dependencies with no practical impact on
  this app’s threat model (still welcome as “please upgrade X” issues when
  non-sensitive)

## Safe handling of secrets

- Never commit `.env`, API keys, or machine-local `.mcp.json`
- Prefer Settings UI or env vars for credentials
- Redact keys from bug reports and screenshots
