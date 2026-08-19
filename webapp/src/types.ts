export type CollectionStatus = 'mapped' | 'missing' | 'unmapped';
export type JobKind = 'check' | 'preview' | 'publish';
export type JobStatus = 'running' | 'succeeded' | 'failed';

// SPDX-License-Identifier: Apache-2.0

export interface Service {
  id: string;
  name: string;
  protocol: string;
  version: string;
  operations: number;
  tracked: boolean;
  collection_status: CollectionStatus;
  collection_name: string;
  last_pushed: string;
}

export interface CategorizedService extends Service {
  primaryCategoryId: string;
  categoryIds: string[];
}

export interface CatalogResponse {
  services: Service[];
  workspace_name: string;
  workspace_configured: boolean;
  updated_at: string;
}

export interface Job {
  id: string;
  kind: JobKind;
  services: string[];
  create_missing: boolean;
  status: JobStatus;
  started_at: string;
  finished_at: string | null;
  return_code: number | null;
  output: string;
}

export interface JobsResponse {
  active_job_id: string | null;
  jobs: Job[];
}
