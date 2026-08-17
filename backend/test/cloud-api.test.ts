// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import test from 'node:test';

process.env.STATE_BUCKET = 'test-state';
process.env.JOBS_TABLE = 'test-jobs';
process.env.CODEBUILD_PROJECT = 'test-build';
process.env.ORIGIN_HEADER_VALUE = 'test-origin';

const { claimGroups } = await import('../src/cloud-api.js');
const { normalizeBuildId } = await import('../src/cloud-build-events.js');

test('claimGroups accepts API Gateway string and array claim formats', () => {
  assert.deepEqual(claimGroups('[Administrators,Auditors]'), ['Administrators', 'Auditors']);
  assert.deepEqual(claimGroups('Administrators'), ['Administrators']);
  assert.deepEqual(claimGroups(['Administrators']), ['Administrators']);
});

test('claimGroups rejects absent and unsupported claim values', () => {
  assert.deepEqual(claimGroups(undefined), []);
  assert.deepEqual(claimGroups({ group: 'Administrators' }), []);
});

test('normalizeBuildId accepts CodeBuild API identifiers and EventBridge ARNs', () => {
  const id = 'postman-collection-generator-jobs:00000000-0000-0000-0000-000000000000';
  assert.equal(normalizeBuildId(id), id);
  assert.equal(
    normalizeBuildId(`arn:aws:codebuild:us-east-1:123456789012:build/${id}`),
    id,
  );
});
