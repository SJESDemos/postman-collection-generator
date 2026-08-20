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

export interface CheckServiceChange {
  service: string;
  ops_added: string[];
  ops_removed: string[];
}

export interface CheckResult extends Record<string, unknown> {
  initialized: boolean;
  message?: string;
  anchor?: string;
  source_ref: string;
  source_head?: string;
  source_commits_pending?: number;
  local_sync_pending?: number;
  mirror_remote?: string | null;
  changed_tracked: CheckServiceChange[];
  untracked_changed: number;
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
  result: Record<string, unknown> | null;
}

export interface JobsResponse {
  active_job_id: string | null;
  jobs: Job[];
}
