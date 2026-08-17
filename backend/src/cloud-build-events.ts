// SPDX-License-Identifier: Apache-2.0

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { EventBridgeEvent } from 'aws-lambda';

const jobsTable = requiredEnvironment('JOBS_TABLE');
const lockId = '__active_job__';
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface CodeBuildStateDetail {
  'build-id': string;
  'build-status': string;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function normalizeBuildId(value: string): string {
  return value.includes(':build/') ? value.slice(value.lastIndexOf('/') + 1) : value;
}

export async function handler(
  event: EventBridgeEvent<'CodeBuild Build State Change', CodeBuildStateDetail>,
): Promise<void> {
  const buildId = normalizeBuildId(event.detail['build-id']);
  const buildStatus = event.detail['build-status'];
  const query = await dynamodb.send(new QueryCommand({
    TableName: jobsTable,
    IndexName: 'build_id-index',
    KeyConditionExpression: 'build_id = :build_id',
    ExpressionAttributeValues: { ':build_id': buildId },
    Limit: 1,
  }));
  const job = query.Items?.[0];
  if (!job) {
    throw new Error(`No application job is associated with CodeBuild build ${buildId}.`);
  }

  const succeeded = buildStatus === 'SUCCEEDED';
  await dynamodb.send(new UpdateCommand({
    TableName: jobsTable,
    Key: { id: job.id },
    UpdateExpression: 'SET #status = :status, finished_at = :finished_at, return_code = :return_code',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':status': succeeded ? 'succeeded' : 'failed',
      ':finished_at': event.time,
      ':return_code': succeeded ? 0 : 1,
    },
  }));
  try {
    await dynamodb.send(new DeleteCommand({
      TableName: jobsTable,
      Key: { id: lockId },
      ConditionExpression: 'job_id = :job_id',
      ExpressionAttributeValues: { ':job_id': job.id },
    }));
  } catch (error) {
    if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
  }
}
