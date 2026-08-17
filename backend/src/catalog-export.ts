#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeJsonAtomic } from './json-store.js';
import { listModelServices, serviceMetadata } from './model-source.js';
import { nowIso } from './time.js';

export async function exportServiceCatalog(modelsRoot: string, outputFile: string): Promise<number> {
  const serviceIds = await listModelServices(resolve(modelsRoot));
  const services = await Promise.all(
    serviceIds.map((serviceId) => serviceMetadata(resolve(modelsRoot), serviceId)),
  );
  await writeJsonAtomic(resolve(outputFile), { services, updated_at: nowIso() });
  return services.length;
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.length !== 2) {
    throw new Error('Usage: catalog-export MODELS_ROOT OUTPUT_FILE');
  }
  const outputFile = resolve(argv[1]!);
  const count = await exportServiceCatalog(argv[0]!, outputFile);
  console.log(`Exported ${count} services to ${outputFile}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
