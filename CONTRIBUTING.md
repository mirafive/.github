# Contributing to the MIRA FIVE SDKs

Thank you for helping. Bug reports, questions and pull requests are all welcome.

## Before you start

- Small fixes (a bug, a typo, a missing test) can go straight to a pull request.
- For anything that changes behaviour or the public API, open an issue first, so we can agree on
  the approach before you write it.
- The wire format every SDK speaks is defined in [mirafive/protocol](https://github.com/mirafive/protocol).
  A change to what is sent starts there.

## Working on a JavaScript SDK

```sh
bun install
bun run check   # format, lint, types, tests, build: what CI runs
```

## Working on a PHP SDK

```sh
composer install
composer check  # Pint, PHPStan, Pest: what CI runs
```

## Rules

- **No new runtime dependencies.** An SDK depends only on other MIRA FIVE packages; frameworks
  are peers.
- **Never throw into the host.** Event methods report problems (`onError`, the logger, `debug`)
  and keep the app running.
- **A secret key never reaches browser code**, and a public key is refused on the server.
- Tests for every change; comments only where the reason is not obvious.
- Conventional Commits (`feat: …`, `fix: …`, `docs: …`).

## Releasing (maintainers)

Bump the version (`package.json`, or the `VERSION` constant in PHP) and add its
`## x.y.z — YYYY-MM-DD` section to `CHANGELOG.md`. Merging that to `main` releases it: npm with
provenance, or a tag that Packagist reads, plus the GitHub release.
