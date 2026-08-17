# Fresh Public Repository Checklist

This checklist implements ADR-0001. The public repository will begin with a new Git history from a
sanitized source snapshot. The private repository and its history will remain unchanged.

## 1. Establish the publication boundary

- [x] Freeze the exact reviewed public source snapshot before Git initialization.
- [x] Create the publication workspace outside the private repository.
- [x] Copy source through an explicit allowlist. Do not copy the private `.git` directory.
- [x] Do not configure the public remote in the private repository.
- [x] Record private source provenance in a private release note, not in the public repository.

## 2. Remove personal and private data

- [x] Remove Postman workspace identifiers and workspace names.
- [x] Remove personal Git fork names and account-specific remote assumptions.
- [x] Remove AWS account identifiers, role names, resource identifiers, and console origins.
- [x] Remove authorization headers, access keys, secret keys, and session tokens.
- [x] Remove local absolute paths, usernames, home directories, and machine names.
- [x] Remove personal screenshots. Add replacements only from neutral fixture data.
- [x] Review documentation, comments, test fixtures, reports, and generated output separately.
- [x] Search binary assets and archives, not only text files.

The SNS protocol fixture may retain the request method, content type, service endpoint pattern, and
`Action=ListTopics&Version=2010-03-31` form body. It must not retain captured credentials, account
identifiers, browser origins, or unrelated browser headers.

## 3. Replace local state with public examples

- [x] Move the workspace binding to ignored `state/postman.json` and add a neutral example.
- [x] Store tracked-service selection as user-owned state and add a neutral example.
- [x] Provide documented environment-variable examples without real values.
- [x] Ignore user configuration, state, reports, caches, generated collections, and secrets.
- [x] Ignore generated browser bundles and build them from the checked-in lockfile.
- [x] Verify a clean clone can create all required local directories itself.
- [x] Verify no example implies a required personal fork or fixed sibling checkout.

## 4. Apply the Apache-2.0 license

- [x] Add the complete Apache License 2.0 text as `LICENSE`.
- [x] Add `NOTICE` with the copyright holder selected by the project owner.
- [x] Add SPDX identifier `Apache-2.0` to authored source files where appropriate.
- [x] Add `THIRD_PARTY_NOTICES.md` with direct and distributed dependency attribution.
- [ ] Generate a software bill of materials for every release artifact.
- [ ] Verify licenses for npm, Java, build, test, and bundled browser dependencies.
- [x] Document Developer Certificate of Origin sign-off in `CONTRIBUTING.md`.

## 5. Add public project governance

- [x] Add `README.md` with neutral examples and supported-platform requirements.
- [x] Add `CONTRIBUTING.md` with build, test, sign-off, and review requirements.
- [x] Add `SECURITY.md` with supported versions and a private reporting channel.
- [x] Add `CODE_OF_CONDUCT.md`.
- [x] Add issue and pull-request templates.
- [ ] Define versioning, release, deprecation, and support policies.
- [ ] Define maintainer and approval responsibilities without using a private organization identity.
- [x] Use the owner-approved repository name `SJESDemos/postman-collection-generator`.

## 6. Validate source and artifacts

- [x] Build from a clean checkout on macOS, Linux, and Windows.
- [x] Run TypeScript type checking, unit tests, and protocol fixture tests.
- [ ] Add and enforce TypeScript and React lint rules.
- [x] Build the Java 17 Smithy converter. The Java test source set is currently empty.
- [x] Verify generated SNS collections use form data and accept XML responses.
- [x] Verify no test or preview writes to Postman.
- [x] Run secret scanning against the complete publication workspace.
- [x] Run personal-metadata and absolute-path scans.
- [x] Run npm dependency vulnerability scans and review direct dependency licenses.
- [ ] Inspect packaged npm, Java, browser, and release artifacts before publication.

## 7. Initialize the fresh history

- [x] Initialize Git only after the sanitized workspace passes review.
- [x] Add only reviewed files to the initial commit.
- [x] Inspect the complete staged file list before committing.
- [x] Confirm the new repository has one root commit and no imported tags or branches.
- [x] Use the project owner's approved personal attribution for the initial commit.
- [x] Create the public remote from the new repository only.
- [x] Push only the reviewed public history to the new remote.
- [ ] Perform a final browser review of files, commit metadata, releases, and rendered documentation.

## 8. Configure public repository controls

- [x] Require pull-request review and passing checks on the default branch.
- [x] Enable dependency update automation.
- [x] Enable code, dependency, and secret scanning supported by the hosting platform.
- [x] Prevent force pushes and branch deletion on the default branch.
- [ ] Restrict release creation to maintainers.
- [ ] Require provenance for published packages and release artifacts where supported.
- [x] Verify the repository is public, owned by `SJESDemos`, and is not a fork.

## Publication stop conditions

Do not publish when any of these conditions is true:

- A credential or session token appears anywhere in the snapshot or an artifact.
- A personal workspace, account, fork, local path, or private organization name remains.
- A dependency has an unknown or incompatible distribution license.
- A clean checkout cannot build without access to the private repository.
- Protocol fixtures or generated collections differ from approved behavior.
- The public repository contains any object from the private Git history.
