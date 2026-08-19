// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process';

import type { Logger, ProcessResult } from './types.js';

interface RunProcessOptions {
  cwd?: string;
  logger?: Logger;
  environment?: NodeJS.ProcessEnv;
  captureLimit?: number;
}

export function runProcess(
  executable: string,
  args: string[],
  options: RunProcessOptions = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.environment || process.env,
      shell: false,
      windowsHide: true,
    });
    const limit = options.captureLimit ?? 4 * 1024 * 1024;
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < limit) {
        stdout = (stdout + chunk).slice(0, limit);
      }
      if (options.logger) {
        for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
          options.logger.info(line);
        }
      }
    });
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < limit) {
        stderr = (stderr + chunk).slice(0, limit);
      }
      if (options.logger) {
        for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
          options.logger.warn(line);
        }
      }
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}
