// SPDX-License-Identifier: Apache-2.0

import { join } from 'node:path';

import { readJson, writeJsonAtomic } from './json-store.js';
import { listModelServices, serviceMetadata } from './model-source.js';
import { nowIso } from './time.js';
import type { CatalogResponse, RuntimePaths, ServiceMetadata } from './types.js';

export class Catalog {
  private cachedServices?: ServiceMetadata[];

  constructor(
    private readonly modelsRoot: string,
    private readonly paths: RuntimePaths,
  ) {}

  invalidate(): void {
    this.cachedServices = undefined;
  }

  async services(): Promise<ServiceMetadata[]> {
    if (!this.cachedServices) {
      const names = await listModelServices(this.modelsRoot);
      this.cachedServices = await Promise.all(names.map((name) => serviceMetadata(this.modelsRoot, name)));
    }
    return this.cachedServices.map((service) => ({ ...service }));
  }

  async response(): Promise<CatalogResponse> {
    const config = await readJson<{ tracked?: string[] }>(this.paths.servicesConfig, {});
    const tracked = new Set(config.tracked || []);
    const postmanMap = await readJson<Record<string, any>>(
      join(this.paths.applicationHome, 'postman-map.json'),
      {},
    );
    const workspace = await readJson<Record<string, any>>(this.paths.postmanConfig, {});
    const services = (await this.services()).map((service) => {
      const mapping = postmanMap[service.id] || {};
      return {
        ...service,
        tracked: tracked.has(service.id),
        collection_status: mapping.missing
          ? 'missing' as const
          : mapping.uid
            ? 'mapped' as const
            : 'unmapped' as const,
        collection_name: mapping.name || '',
        last_pushed: mapping.last_pushed || '',
      };
    });
    return {
      services,
      workspace_name: workspace.workspace_name || '',
      workspace_configured: Boolean(workspace.workspace_id),
      updated_at: nowIso(),
    };
  }

  async updateTracking(serviceIds: unknown): Promise<CatalogResponse> {
    if (!Array.isArray(serviceIds) || !serviceIds.every((service) => typeof service === 'string')) {
      throw new Error('services must be a list of service identifiers.');
    }
    const known = new Set((await this.services()).map((service) => service.id));
    const selected = [...new Set(serviceIds as string[])].sort();
    const unknown = selected.filter((service) => !known.has(service));
    if (unknown.length > 0) {
      throw new Error(`Unknown services: ${unknown.join(', ')}`);
    }
    if (selected.length === 0) {
      throw new Error('Keep at least one tracked service.');
    }
    await writeJsonAtomic(this.paths.servicesConfig, { tracked: selected });
    return this.response();
  }

  async validateTargets(serviceIds: unknown): Promise<string[]> {
    if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
      throw new Error('Select at least one service first.');
    }
    if (!serviceIds.every((service) => typeof service === 'string')) {
      throw new Error('services must be a list of service identifiers.');
    }
    const selected = [...new Set(serviceIds as string[])].sort();
    const response = await this.response();
    const known = new Set(response.services.map((service) => service.id));
    const unknown = selected.filter((service) => !known.has(service));
    if (unknown.length > 0) {
      throw new Error(`Unknown services: ${unknown.join(', ')}`);
    }
    const tracked = new Set(response.services.filter((service) => service.tracked).map((service) => service.id));
    const untracked = selected.filter((service) => !tracked.has(service));
    if (untracked.length > 0) {
      throw new Error(`Track selected services before running the pipeline: ${untracked.join(', ')}`);
    }
    return selected;
  }
}
