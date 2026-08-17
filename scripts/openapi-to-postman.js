#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * OpenAPI to Postman Collection Converter
 *
 * Converts OpenAPI 3.x specifications to Postman Collection v2.1 format
 * with AWS-specific enhancements (SigV4 auth, region variables, etc.)
 */

import Converter from 'openapi-to-postmanv2';
import { program } from 'commander';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, basename, dirname } from 'path';

// Conversion options optimized for AWS APIs
const CONVERSION_OPTIONS = {
  folderStrategy: 'Tags',
  schemaFaker: true,
  optimizeConversion: true,
  stackLimit: 100,
  requestParametersResolution: 'Schema',
  exampleParametersResolution: 'Schema',
  includeAuthInfoInExample: true,
  requestNameSource: 'Fallback',
  indentCharacter: 'Space',
  collapseFolders: true,
  parametersResolution: 'Schema',
  disableOptionalParameters: false,
  keepImplicitHeaders: false,
  includeDeprecated: true
};

/**
 * Convert a single OpenAPI spec to Postman Collection
 */
async function convertFile(inputPath, outputPath, options = {}) {
  return new Promise((resolve, reject) => {
    const spec = readFileSync(inputPath, 'utf8');
    let specObj;

    try {
      specObj = JSON.parse(spec);
    } catch (e) {
      return reject(new Error(`Invalid JSON in ${inputPath}: ${e.message}`));
    }

    // Extract service name from spec
    const serviceName = specObj.info?.title || basename(inputPath, '.openapi.json');
    const serviceSlug = extractServiceSlug(specObj, inputPath);

    Converter.convert(
      { type: 'string', data: spec },
      CONVERSION_OPTIONS,
      (err, result) => {
        if (err) {
          return reject(new Error(`Conversion error: ${err.message}`));
        }

        if (!result.result) {
          return reject(new Error(`Conversion failed: ${result.reason}`));
        }

        const collection = result.output[0].data;

        // Make faked example bodies deterministic (the schema faker emits a
        // random number of "key_N" map entries per run)
        canonicalizeFakedBodies(collection.item);

        const awsProtocol = specObj['x-aws-protocol'];

        // Apply AWS-specific enhancements
        enhanceForAws(collection, serviceName, serviceSlug, awsProtocol);

        // Reorganize items into path-based folders
        collection.item = reorganizeByPath(collection.item);

        // RPC-protocol services (awsQuery/ec2Query/awsJson1_x) route on the
        // Action form field or X-Amz-Target header, not the URL path — some
        // (e.g. SQS) reject any path but "/". Rewrite requests to their real
        // wire shape AFTER folder organization so the per-operation folders
        // derived from the synthetic /OperationName paths are preserved.
        if (RPC_PROTOCOLS.has(awsProtocol)) {
          applyRpcWireShape(collection.item, awsProtocol, {
            targetPrefix: specObj['x-aws-target-prefix'],
            apiVersion: specObj['x-aws-api-version'],
            requiredFormParams: collectRequiredFormParams(specObj)
          });
        }

        // Add metadata
        collection.info._postman_id = generateUUID();
        collection.info.description = collection.info.description ||
          `Postman Collection for AWS ${serviceName} API.\n\nGenerated from official AWS Smithy models.`;

        // Write output
        const outputJson = JSON.stringify(collection, null, 2);
        writeFileSync(outputPath, outputJson);

        resolve({
          success: true,
          service: serviceName,
          inputPath,
          outputPath,
          requestCount: countRequests(collection),
          folderCount: collection.item?.length || 0
        });
      }
    );
  });
}

/**
 * Extract service slug from spec or filename
 */
function extractServiceSlug(spec, filePath) {
  // Try to get from x-amazon-apigateway-integration or similar
  const servers = spec.servers || [];
  for (const server of servers) {
    const vars = server.variables || {};
    if (vars.service?.default) {
      return vars.service.default;
    }
  }

  // Fall back to filename
  return basename(filePath, '.openapi.json').toLowerCase();
}

/**
 * Enhance collection with AWS-specific features
 */
function enhanceForAws(collection, serviceName, serviceSlug, awsProtocol) {
  // Initialize variables array
  collection.variable = collection.variable || [];

  // Add AWS-specific collection variables
  const awsVariables = [
    { key: 'aws_region', value: 'us-east-1', type: 'string', description: 'AWS Region' },
    { key: 'aws_access_key_id', value: '', type: 'string', description: 'AWS Access Key ID' },
    { key: 'aws_secret_access_key', value: '', type: 'string', description: 'AWS Secret Access Key (keep real values in a Postman Environment)' },
    { key: 'aws_session_token', value: '', type: 'string', description: 'AWS Session Token (optional; keep real values in a Postman Environment)' },
    { key: 'aws_service', value: serviceSlug, type: 'string', description: 'AWS Service name for signing' },
    { key: 'baseUrl', value: `https://${serviceSlug}.{{aws_region}}.amazonaws.com`, type: 'string', description: 'Base URL for API requests' }
  ];

  // Drop converter-produced server-template variables ({{service}}/{{region}})
  // — they are superseded by aws_service/aws_region and would otherwise drift.
  collection.variable = collection.variable.filter(
    v => v.key !== 'region' && v.key !== 'service'
  );

  // Merge AWS variables, overriding any converter-produced entries with the
  // same key (notably baseUrl, which the converter seeds with the raw server
  // template 'https://{{service}}.{{region}}.amazonaws.com').
  for (const v of awsVariables) {
    const idx = collection.variable.findIndex(existing => existing.key === v.key);
    if (idx >= 0) {
      collection.variable[idx] = v;
    } else {
      collection.variable.push(v);
    }
  }

  // Set collection-level authentication to AWS SigV4
  collection.auth = {
    type: 'awsv4',
    awsv4: [
      { key: 'accessKey', value: '{{aws_access_key_id}}', type: 'string' },
      { key: 'secretKey', value: '{{aws_secret_access_key}}', type: 'string' },
      { key: 'region', value: '{{aws_region}}', type: 'string' },
      { key: 'service', value: '{{aws_service}}', type: 'string' },
      { key: 'sessionToken', value: '{{aws_session_token}}', type: 'string' }
    ]
  };

  // Update all request URLs to use baseUrl variable
  updateRequestUrls(collection.item);

  // Add pre-request script for dynamic configuration
  collection.event = collection.event || [];
  collection.event.push({
    listen: 'prerequest',
    script: {
      type: 'text/javascript',
      exec: [
        '// AWS Service Collection Pre-request Script',
        '// Ensures proper configuration for AWS API calls',
        '',
        '// Check if AWS credentials are configured',
        'if (!pm.collectionVariables.get("aws_access_key_id")) {',
        '    console.warn("AWS Access Key ID not set. Configure in collection variables.");',
        '}',
        '',
        '// Default Content-Type to JSON only for raw bodies; urlencoded/form',
        '// bodies get their correct Content-Type from Postman automatically.',
        'const bodyMode = pm.request.body ? pm.request.body.mode : undefined;',
        'if (!pm.request.headers.has("Content-Type") && (!bodyMode || bodyMode === "raw")) {',
        '    pm.request.headers.add({',
        '        key: "Content-Type",',
        '        value: "application/json"',
        '    });',
        '}'
      ]
    }
  });

  const responseTestScript = [
    '// Common response handling for AWS protocols',
    '',
    'const responseBody = pm.response.text();',
    'const responseContentType = (pm.response.headers.get("Content-Type") || "").toLowerCase();',
    'const isXmlResponse = responseContentType.includes("xml") || /^\\s*</.test(responseBody);',
    'const xmlValue = (tag) => {',
    '    const pattern = new RegExp("<(?:[^:>]+:)?" + tag + "(?:\\\\s[^>]*)?>([\\\\s\\\\S]*?)</(?:[^:>]+:)?" + tag + ">");',
    '    const match = responseBody.match(pattern);',
    '    return match ? match[1] : undefined;',
    '};',
    '',
    '// Query protocols return XML. JSON protocols use JSON error shapes.',
    'if (pm.response.code >= 400) {',
    '    if (isXmlResponse) {',
    '        console.error("AWS Error:", xmlValue("Code") || "Unknown", "-", xmlValue("Message") || "");',
    '    } else {',
    '        try {',
    '            const responseJson = pm.response.json();',
    '            const queryError = responseJson.Error || {};',
    '            const type = responseJson.__type || queryError.Code;',
    '            const message = responseJson.message || responseJson.Message || queryError.Message;',
    '            if (type || message) {',
    '                console.error("AWS Error:", type || "Unknown", "-", message || "");',
    '            }',
    '        } catch (e) {',
    '            console.error("AWS Error (unrecognized response):", responseBody.slice(0, 200));',
    '        }',
    '    }',
    '}',
    '',
    '// Log request ID from a response header or Query-protocol XML envelope.',
    'const requestId = pm.response.headers.get("x-amzn-RequestId")',
    '    || pm.response.headers.get("x-amz-request-id")',
    '    || (isXmlResponse ? xmlValue("RequestId") : undefined);',
    'if (requestId) {',
    '    console.log("AWS Request ID:", requestId);',
    '}'
  ];

  if (QUERY_PROTOCOLS.has(awsProtocol)) {
    responseTestScript.push(
      '',
      'pm.test("AWS Query response uses XML", function () {',
      '    pm.expect(isXmlResponse, "expected an XML response body").to.be.true;',
      '});'
    );
  }

  // Add test script for protocol-aware response handling
  collection.event.push({
    listen: 'test',
    script: {
      type: 'text/javascript',
      exec: responseTestScript
    }
  });

  // Update collection info (avoid 'AWS AWS ...' when the title already carries the prefix)
  collection.info.name = serviceName.startsWith('AWS') ? serviceName : `AWS ${serviceName}`;
  collection.info.schema = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
}

/**
 * The schema faker (schemaFaker/parametersResolution 'Schema') generates a
 * RANDOM number of placeholder entries ("key_0", "key_1", ... "key_N") for
 * map-typed schemas (OpenAPI objects with additionalProperties, i.e. Smithy
 * map members such as 'tags'/'metadata') on every run, so two conversions of
 * the same spec differ byte-wise and defeat apisync's hash gate. Canonicalize
 * by keeping only the "key_0" entry of each faked map.
 */
const FAKED_MAP_KEY_RE = /^key_[0-9]+$/;

function pruneFakedMapKeys(node) {
  let changed = false;
  if (Array.isArray(node)) {
    for (const child of node) {
      if (pruneFakedMapKeys(child)) changed = true;
    }
    return changed;
  }
  if (node && typeof node === 'object') {
    const keys = Object.keys(node);
    if (keys.includes('key_0')) {
      for (const key of keys) {
        if (key !== 'key_0' && FAKED_MAP_KEY_RE.test(key)) {
          delete node[key];
          changed = true;
        }
      }
    }
    for (const key of Object.keys(node)) {
      if (pruneFakedMapKeys(node[key])) changed = true;
    }
    return changed;
  }
  return false;
}

function canonicalizeBodyString(raw) {
  if (typeof raw !== 'string' || !raw.includes('"key_')) return raw;
  try {
    const parsed = JSON.parse(raw);
    // Re-serialize only when something was pruned, preserving the converter's
    // 2-space indentation (indentCharacter: 'Space').
    return pruneFakedMapKeys(parsed) ? JSON.stringify(parsed, null, 2) : raw;
  } catch {
    // Non-JSON body: conservatively collapse runs of consecutive scalar
    // "key_N": "<...>" pairs that follow a "key_0" pair.
    return raw.replace(
      /("key_0"\s*:\s*"(?:[^"\\]|\\.)*")((?:\s*,\s*"key_[0-9]+"\s*:\s*"(?:[^"\\]|\\.)*")+)/g,
      '$1'
    );
  }
}

function canonicalizeFakedBodies(items) {
  if (!items) return;
  for (const item of items) {
    if (item.item) {
      canonicalizeFakedBodies(item.item);
      continue;
    }
    if (item.request?.body?.raw) {
      item.request.body.raw = canonicalizeBodyString(item.request.body.raw);
    }
    if (Array.isArray(item.response)) {
      for (const response of item.response) {
        if (response?.body) {
          response.body = canonicalizeBodyString(response.body);
        }
        if (response?.originalRequest?.body?.raw) {
          response.originalRequest.body.raw = canonicalizeBodyString(response.originalRequest.body.raw);
        }
      }
    }
  }
}

/**
 * Normalize a single Postman URL (string or object) to use {{baseUrl}} and
 * strip leaked OpenAPI server-template variables ({{service}}/{{region}}).
 */
function sanitizeUrl(url) {
  if (!url) return url;

  if (typeof url === 'string') {
    return url.replace(/^https?:\/\/[^\/]+/, '{{baseUrl}}');
  }

  if (url.raw) {
    url.raw = url.raw.replace(/^https?:\/\/[^\/]+/, '{{baseUrl}}');
  }
  if (url.host) {
    url.host = ['{{baseUrl}}'];
    // Protocol/port are baked into {{baseUrl}}; leaving them would render
    // e.g. 'https://{{baseUrl}}'.
    delete url.protocol;
    delete url.port;
  }

  // Drop server-template URL variables (service/region) that the converter
  // copies onto every request; keep genuine path variables (present in path
  // as ':<name>' segments).
  if (Array.isArray(url.variable)) {
    const pathSegments = Array.isArray(url.path) ? url.path : [];
    url.variable = url.variable.filter(v =>
      !(
        (v.key === 'service' || v.key === 'region') &&
        !pathSegments.includes(`:${v.key}`)
      )
    );
    if (url.variable.length === 0) {
      delete url.variable;
    }
  }

  return url;
}

/**
 * Update all request URLs to use {{baseUrl}} variable
 */
function updateRequestUrls(items) {
  if (!items) return;

  for (const item of items) {
    if (item.item) {
      // This is a folder, recurse
      updateRequestUrls(item.item);
    } else if (item.request) {
      // This is a request
      const request = item.request;

      request.url = sanitizeUrl(request.url);

      // Saved example responses carry a copy of the request URL too
      if (Array.isArray(item.response)) {
        for (const response of item.response) {
          if (response?.originalRequest?.url) {
            response.originalRequest.url = sanitizeUrl(response.originalRequest.url);
          }
        }
      }

      // Inherit collection auth: the collection schema (enforced by the
      // Postman API on PUT, though not by the app importer) expresses
      // inherit-from-parent as an ABSENT auth property — 'inherit' is not
      // an allowed auth.type and gets the whole PUT rejected as malformed.
      if (!request.auth || request.auth.type === 'inherit' || request.auth.type === 'noauth') {
        delete request.auth;
      }
    }
  }
}

/**
 * RPC-style AWS protocols: the URL path does not select the operation.
 * awsQuery/ec2Query route on the Action form field; awsJson1_x route on the
 * X-Amz-Target header. Verified live: SQS (awsJson1_0) 404s on any path
 * except "/", while Query services also accept "/" — so all RPC requests
 * are sent to the endpoint root.
 */
const QUERY_PROTOCOLS = new Set(['awsQuery', 'ec2Query']);
const RPC_PROTOCOLS = new Set([...QUERY_PROTOCOLS, 'awsJson1_0', 'awsJson1_1']);

function upsertHeader(headers, key, value) {
  const existing = headers.find(h => h.key && h.key.toLowerCase() === key.toLowerCase());
  if (existing) {
    existing.value = value;
  } else {
    headers.push({ key, value });
  }
}

function rewriteToRootPath(url) {
  if (!url || typeof url === 'string') return { raw: '{{baseUrl}}/', host: ['{{baseUrl}}'], path: [''] };
  url.raw = '{{baseUrl}}/';
  url.host = ['{{baseUrl}}'];
  url.path = [''];
  return url;
}

/**
 * Map operation name -> Set of required form params, read from the OpenAPI
 * urlencoded request schemas (Query-protocol specs only).
 */
function collectRequiredFormParams(spec) {
  const byOp = new Map();
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    const required = methods.post?.requestBody?.content
      ?.['application/x-www-form-urlencoded']?.schema?.required;
    const opName = path.split('/').filter(Boolean).pop();
    if (opName && Array.isArray(required)) {
      byOp.set(opName, new Set(required));
    }
  }
  return byOp;
}

function applyRpcWireShape(items, protocol, opts) {
  if (!items) return;
  const { targetPrefix, apiVersion, requiredFormParams } = opts;
  for (const item of items) {
    if (item.item) {
      applyRpcWireShape(item.item, protocol, opts);
      continue;
    }
    if (!item.request) continue;

    const segments = getPathSegments(item);
    const opName = segments[segments.length - 1] || item.name;

    const targets = [item.request];
    if (Array.isArray(item.response)) {
      for (const response of item.response) {
        if (response?.originalRequest) targets.push(response.originalRequest);
      }
    }

    for (const target of targets) {
      target.url = rewriteToRootPath(target.url);
      target.header = target.header || [];
      if (protocol === 'awsJson1_0' || protocol === 'awsJson1_1') {
        upsertHeader(target.header, 'Content-Type',
          protocol === 'awsJson1_0' ? 'application/x-amz-json-1.0' : 'application/x-amz-json-1.1');
        upsertHeader(target.header, 'X-Amz-Target', `${targetPrefix}.${opName}`);
      } else {
        // Query protocols: form body carries Action/Version and responses
        // use the protocol-defined XML envelope.
        upsertHeader(target.header, 'Content-Type', 'application/x-www-form-urlencoded');
        upsertHeader(target.header, 'Accept', 'application/xml');
        // The schema faker leaves single-value enums as '<string>' — pin the
        // routing fields to their real values. Optional params keep their
        // placeholder values but start disabled so the request is sendable
        // as-is (a '<string>' NextToken would otherwise be rejected).
        if (target.body?.mode === 'urlencoded' && Array.isArray(target.body.urlencoded)) {
          const required = requiredFormParams.get(opName);
          for (const param of target.body.urlencoded) {
            if (param.key === 'Action') param.value = opName;
            else if (param.key === 'Version' && apiVersion) param.value = apiVersion;
            else if (required && !required.has(param.key)) param.disabled = true;
          }
        }
      }
    }
  }
}

/**
 * Extract URL path segments from a Postman request item
 */
function getPathSegments(item) {
  const url = item.request?.url;
  if (!url) return [];

  // Use structured path array if available
  if (typeof url === 'object' && Array.isArray(url.path)) {
    return url.path.filter(s => s && s !== '');
  }

  // Fall back to parsing raw URL string
  const raw = typeof url === 'string' ? url : url.raw;
  if (!raw) return [];

  const pathPart = raw
    .replace(/^https?:\/\/[^/]+/, '')   // strip http(s)://host
    .replace(/^\{\{[^}]+\}\}/, '');     // strip {{baseUrl}}
  return pathPart.split('?')[0].split('#')[0].split('/').filter(Boolean);
}

/**
 * Reorganize flat/tagged items into nested path-based folders.
 * e.g. GET /cases/{caseId}/comments → folder "cases" > "{caseId}" > "comments"
 */
function reorganizeByPath(items) {
  // Flatten all leaf requests regardless of existing folder structure
  const allRequests = [];
  function collect(list) {
    if (!list) return;
    for (const item of list) {
      if (item.item) collect(item.item);
      else if (item.request) allRequests.push(item);
    }
  }
  collect(items);

  // Build a tree keyed by path segments
  const root = { children: new Map(), requests: [] };

  for (const request of allRequests) {
    const segments = getPathSegments(request);
    let node = root;
    for (const seg of segments) {
      if (!node.children.has(seg)) {
        node.children.set(seg, { children: new Map(), requests: [] });
      }
      node = node.children.get(seg);
    }
    node.requests.push(request);
  }

  // Convert tree back to Postman item array (requests before child folders)
  function treeToItems(node) {
    const result = [];
    for (const req of node.requests) result.push(req);
    for (const [name, child] of node.children) {
      result.push({ name, item: treeToItems(child) });
    }
    return result;
  }

  return treeToItems(root);
}

/**
 * Count total requests in collection
 */
function countRequests(collection) {
  let count = 0;

  function countInItems(items) {
    if (!items) return;
    for (const item of items) {
      if (item.item) {
        countInItems(item.item);
      } else if (item.request) {
        count++;
      }
    }
  }

  countInItems(collection.item);
  return count;
}

/**
 * Generate a UUID v4
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Batch convert all OpenAPI files in a directory
 */
async function batchConvert(inputDir, outputDir, options = {}) {
  const files = readdirSync(inputDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.openapi.json'))
    .map(entry => join(inputDir, entry.name))
    .sort((left, right) => left.localeCompare(right));

  if (files.length === 0) {
    console.log('No OpenAPI files found in', inputDir);
    return { success: 0, failed: 0, errors: [] };
  }

  console.log(`Found ${files.length} OpenAPI files to convert`);

  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const results = {
    success: 0,
    failed: 0,
    errors: [],
    conversions: []
  };

  // Process files
  for (const inputPath of files) {
    const fileName = basename(inputPath, '.openapi.json');
    const outputPath = join(outputDir, `${fileName}.postman_collection.json`);

    process.stdout.write(`Converting ${fileName}... `);

    try {
      const result = await convertFile(inputPath, outputPath, options);
      results.success++;
      results.conversions.push(result);
      console.log(`OK (${result.requestCount} requests)`);
    } catch (error) {
      results.failed++;
      results.errors.push({ file: fileName, error: error.message });
      console.log(`FAILED: ${error.message}`);
    }
  }

  // Write conversion report
  const reportPath = join(outputDir, 'conversion-report.json');
  const report = {
    timestamp: new Date().toISOString(),
    inputDir,
    outputDir,
    totalFiles: files.length,
    successful: results.success,
    failed: results.failed,
    conversions: results.conversions,
    errors: results.errors
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log('\n========== Conversion Summary ==========');
  console.log(`Total: ${files.length}`);
  console.log(`Successful: ${results.success}`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Report: ${reportPath}`);

  return results;
}

// CLI setup
program
  .name('openapi-to-postman')
  .description('Convert OpenAPI specs to Postman Collections with AWS enhancements')
  .version('1.0.0');

program
  .command('convert')
  .description('Convert OpenAPI file(s) to Postman Collection')
  .argument('<input>', 'Input OpenAPI file or directory')
  .option('-o, --output <path>', 'Output path (file or directory)', 'output/postman')
  .option('--no-aws', 'Disable AWS-specific enhancements')
  .action(async (input, options) => {
    try {
      const stats = statSync(input);

      if (stats.isDirectory()) {
        // Batch convert
        await batchConvert(input, options.output);
      } else {
        // Single file convert
        const outputPath = options.output.endsWith('.json')
          ? options.output
          : join(options.output, basename(input, '.openapi.json') + '.postman_collection.json');

        if (!existsSync(dirname(outputPath))) {
          mkdirSync(dirname(outputPath), { recursive: true });
        }

        const result = await convertFile(input, outputPath);
        console.log(`Converted ${result.service}: ${result.requestCount} requests`);
        console.log(`Output: ${outputPath}`);
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program
  .command('info')
  .description('Show information about an OpenAPI or Postman file')
  .argument('<file>', 'OpenAPI or Postman collection file')
  .action((file) => {
    try {
      const content = JSON.parse(readFileSync(file, 'utf8'));

      if (content.openapi) {
        // OpenAPI file
        console.log('File Type: OpenAPI');
        console.log('Version:', content.openapi);
        console.log('Title:', content.info?.title);
        console.log('Description:', content.info?.description?.substring(0, 100) + '...');
        console.log('Paths:', Object.keys(content.paths || {}).length);
      } else if (content.info?.schema?.includes('postman')) {
        // Postman collection
        console.log('File Type: Postman Collection');
        console.log('Name:', content.info?.name);
        console.log('Requests:', countRequests(content));
        console.log('Variables:', content.variable?.length || 0);
      } else {
        console.log('Unknown file format');
      }
    } catch (error) {
      console.error('Error reading file:', error.message);
      process.exit(1);
    }
  });

program.parse();
