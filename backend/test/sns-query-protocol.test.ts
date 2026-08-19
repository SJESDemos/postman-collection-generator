// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runtimePaths } from '../src/config.js';
import { runProcess } from '../src/process.js';
import { convertQueryService, QueryProtocolConverter } from '../src/query-converter.js';
import type { JsonMap } from '../src/types.js';

function findRequest(items: JsonMap[] | undefined, name: string): JsonMap | undefined {
  for (const item of items || []) {
    if (item.request && item.name === name) {
      return item;
    }
    const nested = findRequest(item.item, name);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

test('SNS ListTopics uses a form request and XML response', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'postman-generator-sns-'));
  const paths = runtimePaths(temporary);
  const models = join(paths.repositoryRoot, 'tests', 'fixtures', 'sns', 'models');
  const openapiDirectory = join(temporary, 'openapi');
  const postmanDirectory = join(temporary, 'postman');
  try {
    const model = JSON.parse(
      await readFile(join(models, 'sns', 'service', '2010-03-31', 'sns.json'), 'utf8'),
    ) as JsonMap;
    const serviceShape = Object.values(model.shapes as JsonMap).find(
      (definition) => (definition as JsonMap).type === 'service',
    ) as JsonMap | undefined;
    assert.ok(serviceShape);
    serviceShape.traits = {
      ...serviceShape.traits,
      'smithy.api#documentation': '<<script>alert("unsafe")</script>&',
    };
    const sanitized = new QueryProtocolConverter(model, 'sns').convert();
    assert.doesNotMatch(sanitized.info.description, /[<>]/);
    assert.match(sanitized.info.description, /&lt;&lt;script&gt;/);

    await convertQueryService(models, 'sns', openapiDirectory);
    const specification = JSON.parse(
      await readFile(join(openapiDirectory, 'sns.openapi.json'), 'utf8'),
    ) as JsonMap;
    const operation = specification.paths['/ListTopics'].post;
    assert.ok('application/x-www-form-urlencoded' in operation.requestBody.content);
    assert.deepEqual(Object.keys(operation.responses['200'].content), ['application/xml']);
    const responseSchema = operation.responses['200'].content['application/xml'].schema;
    assert.equal(responseSchema.xml.name, 'ListTopicsResponse');
    assert.equal(responseSchema.xml.namespace, 'http://sns.amazonaws.com/doc/2010-03-31/');

    const conversion = await runProcess('node', [
      paths.postmanConverter,
      'convert',
      openapiDirectory,
      '-o', postmanDirectory,
    ], { cwd: paths.postmanConverterDirectory });
    assert.equal(conversion.exitCode, 0, conversion.stderr || conversion.stdout);
    const collection = JSON.parse(
      await readFile(join(postmanDirectory, 'sns.postman_collection.json'), 'utf8'),
    ) as JsonMap;
    const item = findRequest(collection.item, 'ListTopics');
    assert.ok(item);
    assert.equal(item.request.url.raw, '{{baseUrl}}/');
    const headers = Object.fromEntries(
      item.request.header.map((header: JsonMap) => [header.key, header.value]),
    );
    assert.equal(headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(headers.Accept, 'application/xml');
    const form = Object.fromEntries(
      item.request.body.urlencoded.map((field: JsonMap) => [field.key, field]),
    ) as Record<string, JsonMap>;
    assert.equal(form.Action?.value, 'ListTopics');
    assert.equal(form.Version?.value, '2010-03-31');
    assert.equal(form.NextToken?.disabled, true);
    const success = item.response.find((response: JsonMap) => response.code === 200);
    assert.equal(success.header[0].value, 'application/xml');
    assert.match(success.body, /<ListTopicsResponse/);
    assert.match(success.body, /<ListTopicsResult>/);
    assert.match(success.body, /<member>/);
    const testScript = collection.event
      .filter((event: JsonMap) => event.listen === 'test')
      .flatMap((event: JsonMap) => event.script.exec)
      .join('\n');
    assert.match(testScript, /AWS Query response uses XML/);
    assert.match(testScript, /xmlValue\("RequestId"\)/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
