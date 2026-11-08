# mirafive/.github

Shared by every MIRA FIVE SDK repository:

- `profile/README.md`: the organisation's page.
- `CONTRIBUTING.md`, `SECURITY.md`, issue templates: the defaults for every repository.
- `.github/workflows/`: the reusable CI and release workflows each SDK repository calls
  (`js-sdk.yml`, `js-sdk-release.yml`, `php-sdk.yml`, `php-sdk-release.yml`).
- `scripts/verify-package.ts`: checks a built JavaScript SDK the way an app meets it.

SDK repositories pin these workflows by commit; Dependabot proposes updates.
