# Contributing

## Development Requirements

- Node.js 24 or newer
- Java 17 or newer
- Git

Install and verify the project:

```bash
npm ci --prefix backend
npm ci --prefix scripts
npm ci --prefix webapp
npm test
npm run build:web
./gradlew test installDist
```

## Changes

- Keep protocol behavior covered by a sanitized fixture.
- Keep personal workspaces, account identifiers, credentials, and local paths out of source and
  generated artifacts.
- Do not add a required personal fork or operating-system credential store.
- Preserve the shared TypeScript core used by the command line and local HTTP server.
- Do not commit `webui/static/`, local state, model caches, reports, or generated collections.

## Pull Requests

Describe the behavior changed, the tests run, and any compatibility impact. Keep unrelated changes
in separate pull requests.

All commits must include a Developer Certificate of Origin sign-off:

```text
Signed-off-by: Your Name <your-email@example.com>
```

Use `git commit -s` to add the line. The sign-off certifies that you have the right to submit the
contribution under the repository license.
