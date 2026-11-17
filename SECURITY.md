# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's
[private vulnerability reporting](https://github.com/davidcirosierrra/heftmap/security/advisories/new)
instead. You will get an answer within a week.

Useful to include: what you did, what happened, the Heftmap version (*Extensions* view) and, if
possible, a minimal folder or repository that reproduces it.

## Scope

Heftmap analyzes whatever folder is open. Treat the folder as untrusted input: anything that lets a
folder run code, read or delete files outside itself, hang the editor or make the panel act on
the user's behalf is a vulnerability.

In VS Code's Restricted Mode Heftmap does not run `git`. See [docs/seguridad.md](docs/seguridad.md)
(Spanish) for the threat model and past fixes.

## Supported versions

Only the latest published version receives fixes.
