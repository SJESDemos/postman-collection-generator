// SPDX-License-Identifier: Apache-2.0

import { access, mkdir, readdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';

import { runProcess } from './process.js';
import type {
  JsonMap,
  Logger,
  RepositoryOptions,
  RuntimePaths,
  ServiceMetadata,
} from './types.js';
import { ApplicationError } from './types.js';

const JAVA_PROTOCOLS = new Set([
  'aws.protocols#restJson1',
  'aws.protocols#restXml',
]);

const PROTOCOL_NAMES: Record<string, string> = {
  'aws.protocols#restJson1': 'restJson1',
  'aws.protocols#restXml': 'restXml',
  'aws.protocols#awsJson1_0': 'awsJson1_0',
  'aws.protocols#awsJson1_1': 'awsJson1_1',
  'aws.protocols#awsQuery': 'awsQuery',
  'aws.protocols#ec2Query': 'ec2Query',
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function sourceRef(options: RepositoryOptions): string {
  return `${options.sourceRemote}/${options.sourceBranch}`;
}

export async function git(
  modelsRepository: string,
  args: string[],
  options: { check?: boolean; logger?: Logger } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = await runProcess('git', ['-C', modelsRepository, ...args], {
    logger: options.logger,
  });
  if (options.check !== false && result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new ApplicationError(`git ${args.join(' ')} failed (${result.exitCode}): ${detail}`);
  }
  return result;
}

export async function resolveModelsRepository(
  options: RepositoryOptions,
  paths: RuntimePaths,
  logger: Logger,
): Promise<string> {
  if (options.modelsDir) {
    const configured = resolve(options.modelsDir);
    if (!(await pathExists(join(configured, '.git')))) {
      const probe = await git(configured, ['rev-parse', '--is-inside-work-tree'], { check: false });
      if (probe.exitCode !== 0 || probe.stdout.trim() !== 'true') {
        throw new ApplicationError(`The configured models repository is not a Git worktree: ${configured}`);
      }
    }
    return configured;
  }

  const managed = join(paths.applicationHome, 'models', 'api-models-aws');
  if (await pathExists(join(managed, '.git'))) {
    return managed;
  }

  await mkdir(join(paths.applicationHome, 'models'), { recursive: true });
  logger.info(`Cloning the official AWS model source into ${managed}`);
  const clone = await runProcess('git', [
    'clone',
    '--origin', options.sourceRemote,
    '--branch', options.sourceBranch,
    '--single-branch',
    options.modelsUrl,
    managed,
  ], { logger });
  if (clone.exitCode !== 0) {
    throw new ApplicationError(`Unable to clone ${options.modelsUrl}: ${(clone.stderr || clone.stdout).trim()}`);
  }
  if (options.localBranch !== options.sourceBranch) {
    await git(managed, ['switch', '-c', options.localBranch], { logger });
  }
  options.modelsDir = managed;
  return managed;
}

export async function fetchSource(
  modelsRepository: string,
  options: RepositoryOptions,
  logger: Logger,
  fatal: boolean,
): Promise<void> {
  const result = await git(modelsRepository, ['fetch', options.sourceRemote, '--quiet'], { check: false });
  if (result.exitCode === 0) {
    return;
  }
  const message = `git fetch ${options.sourceRemote} failed: ${(result.stderr || result.stdout).trim()}`;
  if (fatal) {
    throw new ApplicationError(message);
  }
  logger.warn(`${message}. Continuing with the current local reference.`);
}

export async function isAncestor(
  modelsRepository: string,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  const result = await git(
    modelsRepository,
    ['merge-base', '--is-ancestor', ancestor, descendant],
    { check: false },
  );
  return result.exitCode === 0;
}

export async function enforceHistoryAnchor(
  modelsRepository: string,
  anchor: string,
  source: string,
): Promise<void> {
  if (await isAncestor(modelsRepository, anchor, source)) {
    return;
  }
  throw new ApplicationError(
    [
      'The configured model source rewrote history.',
      `The recorded anchor ${anchor} is not an ancestor of ${source}.`,
      'Inspect the source and set last_source_commit to a reachable commit before refreshing.',
    ].join('\n'),
    2,
  );
}

export async function changedServices(
  modelsRepository: string,
  anchor: string,
  source: string,
): Promise<Set<string>> {
  const result = await git(modelsRepository, [
    'diff', '--name-only', anchor, source, '--', 'models/',
  ]);
  const services = new Set<string>();
  for (const line of result.stdout.split(/\r?\n/)) {
    const parts = line.split('/');
    if (parts[0] === 'models' && parts[1]) {
      services.add(parts[1]);
    }
  }
  return services;
}

export async function modelBlobPathAt(
  modelsRepository: string,
  commit: string,
  service: string,
): Promise<string | undefined> {
  const result = await git(modelsRepository, [
    'ls-tree', '-r', '--name-only', commit, '--', `models/${service}/service/`,
  ], { check: false });
  if (result.exitCode !== 0) {
    return undefined;
  }
  const versions = new Map<string, string[]>();
  for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
    const parts = line.split('/');
    if (parts.length >= 5 && parts[4]?.endsWith('.json') && parts[3]) {
      const files = versions.get(parts[3]) || [];
      files.push(line);
      versions.set(parts[3], files);
    }
  }
  const latestVersion = [...versions.keys()].sort().at(-1);
  return latestVersion ? versions.get(latestVersion)?.sort().at(-1) : undefined;
}

export async function operationsAt(
  modelsRepository: string,
  commit: string,
  service: string,
): Promise<Set<string>> {
  const path = await modelBlobPathAt(modelsRepository, commit, service);
  if (!path) {
    return new Set();
  }
  const result = await git(modelsRepository, ['show', `${commit}:${path}`], { check: false });
  if (result.exitCode !== 0) {
    return new Set();
  }
  try {
    const model = JSON.parse(result.stdout) as JsonMap;
    return new Set(
      Object.entries(model.shapes || {})
        .filter(([, shape]) => (shape as JsonMap).type === 'operation')
        .map(([name]) => name.split('#').at(-1) || name),
    );
  } catch {
    return new Set();
  }
}

export async function findModelFile(modelsRoot: string, service: string): Promise<string | undefined> {
  const serviceDirectory = join(modelsRoot, service, 'service');
  let versions;
  try {
    versions = (await readdir(serviceDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return undefined;
  }
  const latestVersion = versions.at(-1);
  if (!latestVersion) {
    return undefined;
  }
  const files = (await readdir(join(serviceDirectory, latestVersion), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
  const latestFile = files.at(-1);
  return latestFile ? join(serviceDirectory, latestVersion, latestFile) : undefined;
}

export async function readServiceModel(modelsRoot: string, service: string): Promise<JsonMap | undefined> {
  const path = await findModelFile(modelsRoot, service);
  if (!path) {
    return undefined;
  }
  try {
    return JSON.parse(await readFile(path, 'utf8')) as JsonMap;
  } catch {
    return undefined;
  }
}

export async function routeConverter(
  modelsRoot: string,
  service: string,
): Promise<'java' | 'typescript' | undefined> {
  const model = await readServiceModel(modelsRoot, service);
  if (!model) {
    return undefined;
  }
  for (const shape of Object.values(model.shapes || {}) as JsonMap[]) {
    if (shape.type === 'service') {
      return Object.keys(shape.traits || {}).some((trait) => JAVA_PROTOCOLS.has(trait))
        ? 'java'
        : 'typescript';
    }
  }
  return undefined;
}

export async function listModelServices(modelsRoot: string): Promise<string[]> {
  const entries = await readdir(modelsRoot, { withFileTypes: true });
  const candidates = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const available = await Promise.all(candidates.map(async (service) => (
    await findModelFile(modelsRoot, service) ? service : undefined
  )));
  return available.filter((service): service is string => Boolean(service));
}

export async function serviceMetadata(modelsRoot: string, service: string): Promise<ServiceMetadata> {
  const model = await readServiceModel(modelsRoot, service);
  if (!model) {
    return { id: service, name: service, protocol: 'unknown', version: '', operations: 0 };
  }
  const shapes = model.shapes || {};
  const serviceShape = (Object.values(shapes) as JsonMap[]).find((shape) => shape.type === 'service') || {};
  const traits = serviceShape.traits || {};
  const apiTrait = traits['aws.api#service'] || {};
  const protocol = Object.keys(PROTOCOL_NAMES).find((key) => key in traits);
  return {
    id: service,
    name: apiTrait.sdkId || service,
    protocol: protocol ? PROTOCOL_NAMES[protocol]! : 'unknown',
    version: serviceShape.version || '',
    operations: (Object.values(shapes) as JsonMap[]).filter((shape) => shape.type === 'operation').length,
  };
}

export async function syncModelsRepository(
  options: RepositoryOptions,
  modelsRepository: string,
  source: string,
  logger: Logger,
): Promise<boolean | null> {
  const branch = (await git(modelsRepository, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
  if (branch !== options.localBranch) {
    throw new ApplicationError(
      `The models repository is on branch '${branch}', not '${options.localBranch}'.`,
    );
  }

  if (!(await isAncestor(modelsRepository, source, options.localBranch))) {
    const merge = await git(modelsRepository, ['merge', '--no-edit', source], { check: false });
    if (merge.exitCode !== 0) {
      await git(modelsRepository, ['merge', '--abort'], { check: false });
      throw new ApplicationError(
        `Merging ${source} into ${options.localBranch} failed. The merge was aborted.`,
      );
    }
    logger.info(`Merged ${source} into ${options.localBranch}.`);
  }

  if (!options.mirrorRemote) {
    return null;
  }
  const push = await git(modelsRepository, [
    'push', options.mirrorRemote, `${options.localBranch}:${options.mirrorBranch}`,
  ], { check: false });
  if (push.exitCode !== 0) {
    logger.warn(
      `Pushing ${options.localBranch} to ${options.mirrorRemote}/${options.mirrorBranch} failed. `
      + 'Conversion will continue from the local repository.',
    );
    return false;
  }
  return true;
}
