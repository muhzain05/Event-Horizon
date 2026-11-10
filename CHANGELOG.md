# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]
- Show tweak IDs on optimization cards to make bug reports easier.

### Fixed
- Respect reduced-motion preferences in the space background and page transitions, including preference changes while the app is open.

## [1.0.0] - 2026-11-06

First public release.

### Added
- 89 reversible tweaks in 9 categories, each with apply, revert and live state check.
- Lite, Power and Max presets. High-risk tweaks are only in Max and always ask for confirmation.
- 13 boost-ups, including a system restore point, junk cleaner, shader-cache rebuild and standby-memory trim.
- Observatory dashboard with live CPU, GPU (via `nvidia-smi`) and RAM telemetry and a top-processes list.
- Deep Scan hardware inventory with a hardware-compatibility panel.
- Programs manager: installed programs with icons and silent uninstall, Store apps with bloatware flags, startup entries from the registry, Startup folders and logon tasks.
- Activity log, Revert all, and reboot prompts.
- 19 user-level tweaks that work without administrator rights.
- Test suite: catalog schema, PowerShell parse check of every snippet, Electron hardening checks.
- Generated tweak catalog at `docs/TWEAKS.md`.

### Security
- Renderer runs sandboxed with context isolation and a `connect-src 'none'` content security policy. Fonts are bundled, so the app makes no network requests.
- External links are limited to `https:`.
- PowerShell scripts are passed to PowerShell over stdin and never written to disk, so unelevated code cannot swap a script before it runs with administrator rights (found by CodeQL `js/insecure-temporary-file`).
- Development-only switches (screenshot and capture modes) are disabled in packaged builds.

### Removed before release
- Three tweaks without credible evidence of effect on current Windows: `irq8_priority`, `nvidia_powermizer`, `nvidia_hdcp_off`.

[1.0.0]: https://github.com/muhzain05/Event-Horizon/releases/tag/v1.0.0
