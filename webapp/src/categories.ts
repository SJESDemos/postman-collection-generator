// SPDX-License-Identifier: Apache-2.0

import categoryData from './service-categories.json';
import type { CategorizedService, Service } from './types';

export interface ServiceCategory {
  id: string;
  label: string;
  services: string[];
  prefixes: string[];
}

interface CategoryData {
  source: string;
  categories: ServiceCategory[];
  primaryOverrides: Record<string, string>;
  related: Record<string, string[]>;
}

const data = categoryData as CategoryData;

export const SERVICE_CATEGORIES = data.categories;
export const CATEGORY_SOURCE = data.source;
export const UNCLASSIFIED_CATEGORY: ServiceCategory = {
  id: 'unclassified',
  label: 'Unclassified',
  services: [],
  prefixes: [],
};

function matchesCategory(serviceId: string, category: ServiceCategory): boolean {
  return category.services.includes(serviceId)
    || category.prefixes.some((prefix) => serviceId.startsWith(prefix));
}

export function categorizeService(service: Service): CategorizedService {
  const matches = SERVICE_CATEGORIES
    .filter((category) => matchesCategory(service.id, category))
    .map((category) => category.id);
  const related = data.related[service.id] ?? [];
  const categoryIds = [...new Set([...matches, ...related])];
  const primaryCategoryId = data.primaryOverrides[service.id]
    ?? matches[0]
    ?? related[0]
    ?? UNCLASSIFIED_CATEGORY.id;
  if (!categoryIds.includes(primaryCategoryId)) categoryIds.unshift(primaryCategoryId);
  return { ...service, primaryCategoryId, categoryIds };
}
