// SPDX-License-Identifier: Apache-2.0

import { randomUUID } from 'node:crypto';

import { checkPipeline, refreshPipeline, type PipelineContext } from './pipeline.js';
import { nowIso } from './time.js';
import type { Job, Logger } from './types.js';
import { ApplicationError } from './types.js';
import type { Catalog } from './catalog.js';

const MAX_JOB_OUTPUT = 2 * 1024 * 1024;

class JobLogger implements Logger {
  constructor(private readonly update: (message: string) => void) {}
  info(message: string): void { this.update(message); }
  warn(message: string): void { this.update(`WARNING: ${message}`); }
  error(message: string): void { this.update(`ERROR: ${message}`); }
}

export class JobManager {
  private activeJobId?: string;
  private readonly jobs = new Map<string, Job>();

  constructor(
    private readonly catalog: Catalog,
    private readonly context: PipelineContext,
  ) {}

  start(
    kind: Job['kind'],
    services: string[] = [],
    createMissing = false,
  ): Job {
    if (this.activeJobId && this.jobs.get(this.activeJobId)?.status === 'running') {
      throw new Error('A pipeline job is already running. Wait for it to finish.');
    }
    const id = randomUUID().replace(/-/g, '').slice(0, 12);
    const job: Job = {
      id,
      kind,
      services,
      create_missing: createMissing,
      status: 'running',
      started_at: nowIso(),
      finished_at: null,
      return_code: null,
      output: '',
      result: null,
    };
    this.jobs.set(id, job);
    this.activeJobId = id;
    void this.run(id);
    return { ...job };
  }

  snapshot(jobId?: string): Job | { active_job_id: string | null; jobs: Job[] } | undefined {
    if (jobId) {
      const job = this.jobs.get(jobId);
      return job ? { ...job } : undefined;
    }
    return {
      active_job_id: this.activeJobId || null,
      jobs: [...this.jobs.values()]
        .sort((left, right) => right.started_at.localeCompare(left.started_at))
        .slice(0, 20)
        .map((job) => ({ ...job })),
    };
  }

  private append(jobId: string, message: string): void {
    const job = this.jobs.get(jobId);
    if (!job || job.output.length >= MAX_JOB_OUTPUT) {
      return;
    }
    const addition = `${message}\n`;
    if (job.output.length + addition.length > MAX_JOB_OUTPUT) {
      job.output += '\n[Job output truncated at 2 MiB]\n';
    } else {
      job.output += addition;
    }
  }

  private async run(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId)!;
    const logger = new JobLogger((message) => this.append(jobId, message));
    const context = { ...this.context, logger };
    let returnCode = 1;
    try {
      if (job.kind === 'check') {
        const report = await checkPipeline(context);
        job.result = report;
        this.append(jobId, JSON.stringify(report, null, 2));
        returnCode = 0;
      } else {
        const outcome = await refreshPipeline(context, {
          services: job.services,
          dryRun: job.kind === 'preview',
          createMissing: job.create_missing,
        });
        job.result = outcome.report;
        this.append(jobId, JSON.stringify(outcome.report, null, 2));
        returnCode = outcome.exitCode;
      }
    } catch (error) {
      returnCode = error instanceof ApplicationError ? error.exitCode : 1;
      this.append(jobId, `ERROR: ${error instanceof Error ? error.message : String(error)}`);
    }
    job.return_code = returnCode;
    job.status = returnCode === 0 ? 'succeeded' : 'failed';
    job.finished_at = nowIso();
    this.activeJobId = undefined;
    this.catalog.invalidate();
  }
}
