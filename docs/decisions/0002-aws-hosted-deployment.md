# ADR-0002: AWS Hosted Deployment

- Status: Accepted
- Decision date: 2026-08-17
- Scope: Optional hosted runtime for the React application and collection pipeline

## Context

The local application serves the browser interface and runs Git, Node.js, Java, and Postman
operations in one workstation process. Static hosting alone cannot preserve those operations.
Hosted state and jobs must survive process restarts. The deployment must use managed AWS services
and must not require an ECS cluster, Fargate service, ECR repository, or customer-managed image.

## Decision

The optional hosted runtime uses these components:

- A private S3 bucket stores the React build.
- CloudFront uses Origin Access Control to read the private frontend bucket.
- A dedicated AWS WAF web access control list protects the CloudFront distribution.
- Route 53 and an existing ACM certificate provide the deployment hostname and TLS.
- A dedicated Cognito user pool provides one administrator login with required software-token MFA.
- API Gateway validates Cognito JSON Web Tokens for protected API routes.
- A Node.js 24 Lambda function implements the browser API.
- DynamoDB stores durable job records and the single-job execution lock.
- A versioned private S3 bucket stores configuration, mappings, reports, and generated artifacts.
- Secrets Manager stores the Postman API key. The browser and API Lambda cannot read it.
- CodeBuild runs Git, Node.js 24, Java 17, and the existing conversion pipeline.
- EventBridge records terminal CodeBuild states in DynamoDB.
- AWS CDK defines the complete deployment in TypeScript.

CodeBuild uses an AWS-maintained build image internally. The application owns no container image or
container service. A pure Lambda conversion path remains possible only after replacing or separately
packaging the Java conversion lane.

## Security Boundaries

- Public S3 access is blocked.
- CloudFront is the only frontend bucket reader.
- API Gateway requires a Cognito token for every operational route.
- Lambda also requires membership in the `Administrators` Cognito group.
- A deployment-specific origin header prevents direct use of the API Gateway endpoint.
- The Postman credential is available only to the CodeBuild job role.
- Runtime state, generated reports, credentials, and account-specific deployment values stay outside
  the public source history.

## State Migration

An operator may seed these local files into the private state bucket:

- `services.json`
- `postman.json`
- `postman-map.json`
- `ops-inventory.json`
- `sync-state.json`

AWS and Postman environment exports, credentials, and historical reports are excluded.

## Consequences

- Local operation remains available without an AWS account.
- The hosted application supports one administrator and one Postman workspace.
- Only one pipeline job may run at a time.
- Each job obtains an independent AWS model checkout. Model-cache optimization is deferred.
- The generated Postman secret must be replaced before publish jobs can succeed.
- Adding multiple users, workspaces, or tenant isolation requires a new architecture decision.
