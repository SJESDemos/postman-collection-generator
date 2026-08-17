// SPDX-License-Identifier: Apache-2.0

import { createHash } from 'node:crypto';

import type { JsonMap } from './types.js';

export const HTTP_METHODS = [
  'get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace',
] as const;

const UUIDISH = /^(?:\d+-)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function stripVolatileIds(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripVolatileIds);
  }
  if (value && typeof value === 'object') {
    const output: JsonMap = {};
    for (const key of Object.keys(value as JsonMap).sort()) {
      const child = (value as JsonMap)[key];
      if (['id', '_postman_id', 'uid'].includes(key) && typeof child === 'string' && UUIDISH.test(child)) {
        continue;
      }
      output[key] = stripVolatileIds(child);
    }
    return output;
  }
  return value;
}

export function collectionHash(collection: JsonMap): string {
  return createHash('sha256')
    .update(JSON.stringify(stripVolatileIds(collection)))
    .digest('hex');
}

export function countRequests(items: JsonMap[] | undefined): number {
  let count = 0;
  for (const item of items || []) {
    if (item.request) {
      count += 1;
    }
    count += countRequests(item.item);
  }
  return count;
}

export function specificationOperationIds(specification: JsonMap): string[] {
  const operations: string[] = [];
  for (const path of Object.values(specification.paths || {}) as JsonMap[]) {
    for (const method of HTTP_METHODS) {
      const operation = path?.[method];
      if (operation?.operationId) {
        operations.push(operation.operationId);
      }
    }
  }
  return operations.sort();
}

export function filterCorsOperations(specification: JsonMap): void {
  const paths = specification.paths || {};
  for (const [pathName, path] of Object.entries(paths) as [string, JsonMap][]) {
    for (const method of HTTP_METHODS) {
      if (String(path[method]?.operationId || '').startsWith('Cors')) {
        delete path[method];
      }
    }
    if (!HTTP_METHODS.some((method) => method in path)) {
      delete paths[pathName];
    }
  }
}

export function normalizeCollectionName(value: string): string {
  let normalized = value.toLowerCase().trim();
  while (/^aws([^a-z0-9]+|$)/.test(normalized)) {
    normalized = normalized.replace(/^aws([^a-z0-9]+|$)/, '');
  }
  return normalized.replace(/[^a-z0-9]/g, '');
}
