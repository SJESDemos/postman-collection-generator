// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { git, syncModelsRepository } from '../src/model-source.js';
import { runProcess } from '../src/process.js';
import type { Logger, RepositoryOptions } from '../src/types.js';

const silentLogger: Logger = { info() {}, warn() {}, error() {} };

async function fixtureGit(args: string[], cwd?: string): Promise<string> {
  const result = await runProcess('git', args, { cwd });
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test('the mirror remains disabled until explicitly configured', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'postman-generator-git-'));
  const source = join(temporary, 'source.git');
  const mirror = join(temporary, 'mirror.git');
  const seed = join(temporary, 'seed');
  const local = join(temporary, 'local');
  try {
    await fixtureGit(['init', '--bare', '--initial-branch=main', source]);
    await fixtureGit(['clone', source, seed]);
    await fixtureGit(['config', 'user.name', 'Fixture Author'], seed);
    await fixtureGit(['config', 'user.email', 'fixture@example.invalid'], seed);
    await mkdir(join(seed, 'models'));
    await writeFile(join(seed, 'models', 'version.txt'), 'one\n');
    await fixtureGit(['add', 'models/version.txt'], seed);
    await fixtureGit(['commit', '-m', 'Initial fixture'], seed);
    await fixtureGit(['push', 'origin', 'main'], seed);
    await fixtureGit(['clone', source, local]);
    await fixtureGit(['config', 'user.name', 'Fixture Author'], local);
    await fixtureGit(['config', 'user.email', 'fixture@example.invalid'], local);
    await writeFile(join(seed, 'models', 'version.txt'), 'two\n');
    await fixtureGit(['commit', '-am', 'Update fixture'], seed);
    await fixtureGit(['push', 'origin', 'main'], seed);
    await fixtureGit(['fetch', 'origin'], local);

    const options: RepositoryOptions = {
      modelsDir: local,
      modelsUrl: source,
      sourceRemote: 'origin',
      sourceBranch: 'main',
      localBranch: 'main',
      mirrorBranch: 'main',
    };
    assert.equal(await syncModelsRepository(options, local, 'origin/main', silentLogger), null);
    assert.equal((await readFile(join(local, 'models', 'version.txt'), 'utf8')).trim(), 'two');

    await fixtureGit(['init', '--bare', '--initial-branch=main', mirror]);
    await fixtureGit(['remote', 'add', 'mirror', mirror], local);
    options.mirrorRemote = 'mirror';
    assert.equal(await syncModelsRepository(options, local, 'origin/main', silentLogger), true);
    assert.equal(
      (await git(local, ['rev-parse', 'main'])).stdout.trim(),
      await fixtureGit(['rev-parse', 'refs/heads/main'], mirror),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
