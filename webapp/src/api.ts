// SPDX-License-Identifier: Apache-2.0

import type { CatalogResponse, Job, JobKind, JobsResponse } from './types';
import { accessToken } from './auth';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const localRequestToken = document
  .querySelector<HTMLMetaElement>('meta[name="apisync-token"]')
  ?.content;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const bearerToken = accessToken();
  if (bearerToken) headers.set('Authorization', `Bearer ${bearerToken}`);
  if (init?.method && init.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
    if (localRequestToken && localRequestToken !== '{{APISYNC_TOKEN}}') {
      headers.set('X-Apisync-Token', localRequestToken);
    }
  }
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }
  return payload;
}

export const api = {
  catalog: () => request<CatalogResponse>('/api/catalog'),
  jobs: () => request<JobsResponse>('/api/jobs'),
  job: (jobId: string) => request<Job>(`/api/jobs/${encodeURIComponent(jobId)}`),
  updateTracking: (services: string[]) => request<CatalogResponse>('/api/tracking', {
    method: 'POST',
    body: JSON.stringify({ services }),
  }),
  startJob: (kind: JobKind, services: string[], createMissing: boolean) => request<Job>('/api/jobs', {
    method: 'POST',
    body: JSON.stringify({ kind, services, create_missing: createMissing }),
  }),
};
