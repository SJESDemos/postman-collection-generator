# Postman Collection Generator

Generate protocol-correct Postman Collections from the official AWS Smithy API models. The
application discovers AWS services, tracks selected services, converts their models, previews
changes, and optionally publishes collections to a Postman workspace.

```text
AWS Smithy models -> OpenAPI 3.0.2 -> Postman Collection 2.1 -> optional Postman workspace
```

## Runtime

The application is Python-free and supports macOS, Linux, and Windows.

| Component | Responsibility |
|---|---|
| TypeScript backend | Command handling, Git synchronization, state, Query/JSON conversion, Postman publishing, and local HTTP API |
| Java 17 converter | Smithy `restJson1` and `restXml` conversion using the official Smithy libraries |
| Node.js converter | OpenAPI to Postman Collection conversion |
| React application | Service discovery, AWS category views, tracking, previews, publishing, and job output |

The command-line application and local HTTP server call the same TypeScript pipeline functions.
The browser never receives the Postman API key.

## Requirements

- Node.js 24 or newer
- Java 17 or newer
- Git

Python and containers are not required.

## Install

```bash
npm ci --prefix backend
npm ci --prefix scripts
npm ci --prefix webapp
./gradlew installDist
npm run build
```

Initialize neutral local configuration:

```bash
npm run cli -- init
```

The application uses the operating system's standard application-data directory:

| Platform | Default location |
|---|---|
| macOS | `~/Library/Application Support/postman-collection-generator` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/postman-collection-generator` |
| Windows | `%APPDATA%\postman-collection-generator` |

Set `APISYNC_HOME` to use another directory. Configuration examples under `config/` contain no
workspace identifier, credential, account identifier, personal path, or required fork.

## AWS Models

The application can manage its own clone of the official AWS model repository. When
`--models-dir` and `APISYNC_MODELS_REPO` are both absent, the first model operation clones:

```text
https://github.com/aws/api-models-aws.git
```

The clone is stored under the application-data directory. To use an existing checkout instead:

```bash
export APISYNC_MODELS_REPO=/path/to/api-models-aws
```

The default source is `origin/main`. A repository that uses `upstream` for AWS and `origin` for a
personal mirror can configure the roles explicitly:

```bash
export APISYNC_SOURCE_REMOTE=upstream
export APISYNC_SOURCE_BRANCH=main
export APISYNC_LOCAL_BRANCH=main
export APISYNC_MIRROR_REMOTE=origin
export APISYNC_MIRROR_BRANCH=main
```

Mirror publishing is optional and disabled by default. Source and mirror remotes must differ. The
application never pushes to the configured source remote.

## Command Line

```bash
npm run cli -- init
npm run cli -- check
npm run cli -- refresh
npm run cli -- refresh --all
npm run cli -- refresh --service sns,sts,sqs --dry-run
npm run cli -- refresh --service sns,sts,sqs --create-missing
npm run cli -- adopt --workspace "AWS API Collections"
npm run cli -- reconcile
```

Repository options may appear before or after the command:

```bash
npm run cli -- refresh \
  --models-dir /path/to/api-models-aws \
  --source-remote origin \
  --source-branch main \
  --service sns \
  --dry-run
```

| Command | Behavior |
|---|---|
| `init` | Create neutral local configuration without replacing existing files |
| `check` | Report pending model and operation changes without modifying collections |
| `refresh` | Synchronize models, convert selected services, publish changed collections, and update local state |
| `refresh --dry-run` | Convert and report without merging, publishing, or changing collection state |
| `adopt` | Bind a Postman workspace and propose mappings to existing collections |
| `reconcile` | Mark mappings whose Postman collections no longer exist |

Set `POSTMAN_API_KEY` only when adopting, reconciling, or publishing:

```bash
export POSTMAN_API_KEY=replace-with-your-key
```

Do not store Postman or AWS credentials in this repository.

## Browser Application

Build and start the local application:

```bash
npm run build
npm run serve -- --models-dir /path/to/api-models-aws
```

Open `http://127.0.0.1:8765`.

The interface provides:

- All-service and AWS-category views
- Expandable categories and service-level selection
- Service search, status filters, and protocol filters
- Track and untrack actions
- Read-only conversion previews
- Explicit Postman publishing
- Local job status and output

The local server binds only to `127.0.0.1`. State-changing requests require a per-process token
injected into the served page.

### Static Hosting

Vite writes the browser artifact to ignored `webui/static/`. Continuous integration and releases
build it from `webapp/package-lock.json`.

The static application can be deployed from a private S3 bucket through CloudFront and WAF. A
deployed browser must set `VITE_API_BASE_URL` to a protected API. Static hosting cannot run Git,
Java conversion, or Postman publishing by itself. The optional AWS execution backend remains a
separate architecture decision.

## Protocol Behavior

| Smithy protocol | Converter | Wire behavior |
|---|---|---|
| `restJson1` | Java | REST requests with JSON payloads |
| `restXml` | Java | REST requests with XML payloads |
| `awsJson1_0` | TypeScript | `POST /`, JSON body, and `X-Amz-Target` routing |
| `awsJson1_1` | TypeScript | `POST /`, JSON body, and `X-Amz-Target` routing |
| `awsQuery` | TypeScript | Form-encoded `Action` and `Version`, with XML responses |
| `ec2Query` | TypeScript | Flattened form fields, with XML responses |

SNS `ListTopics` is generated as:

```http
POST / HTTP/1.1
Content-Type: application/x-www-form-urlencoded
Accept: application/xml

Action=ListTopics&Version=2010-03-31
```

Nested Query inputs use dotted keys such as `Entries.member.1.Id` and
`Attributes.entry.1.key`. Optional form parameters start disabled. Successful Query responses use
XML envelopes, including `ResponseMetadata` and `RequestId`.

## Generated Collections

Each collection includes AWS Signature Version 4 authentication and these variables:

| Variable | Default |
|---|---|
| `aws_region` | `us-east-1` |
| `aws_access_key_id` | Empty |
| `aws_secret_access_key` | Empty |
| `aws_session_token` | Empty |
| `aws_service` | Generated service signing name |
| `baseUrl` | Generated regional endpoint |

Keep real AWS credentials in a private Postman environment or another approved secret store.

## Test and Verify

```bash
npm test
npm run build:web
./gradlew test installDist
npm audit --prefix backend
npm audit --prefix scripts
npm audit --prefix webapp
```

The Node test suite verifies optional mirror behavior and the complete SNS `ListTopics` conversion
from Smithy through the generated Postman Collection.

## Repository Structure

```text
backend/                     Shared TypeScript core, command line, and local HTTP server
config/                      Neutral local-configuration examples
docs/decisions/              Architecture decision records
scripts/                     OpenAPI to Postman converter
src/main/java/               Smithy REST protocol converter
tests/fixtures/              Sanitized protocol fixtures
webapp/                      React, Vite, TypeScript, and Cloudscape source
webui/static/                Generated browser build, ignored by Git
```

## Security

Review [SECURITY.md](SECURITY.md) before reporting a vulnerability. Generated Postman environments
are ignored because they can contain live AWS credentials.

## Contributing

Contributions are accepted under Apache-2.0 and require Developer Certificate of Origin sign-off.
See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Copyright 2026 Srinath Jagannathan.

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE), [NOTICE](NOTICE), and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
