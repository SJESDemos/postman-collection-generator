// SPDX-License-Identifier: Apache-2.0

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { readServiceModel } from './model-source.js';
import { nowIso } from './time.js';
import type { JsonMap, Logger } from './types.js';

const PROTOCOLS: Record<string, string> = {
  'aws.protocols#restJson1': 'REST JSON',
  'aws.protocols#restXml': 'REST XML',
  'aws.protocols#awsJson1_1': 'AWS JSON 1.1',
  'aws.protocols#awsJson1_0': 'AWS JSON 1.0',
  'aws.protocols#awsQuery': 'AWS Query',
  'aws.protocols#ec2Query': 'EC2 Query',
};

const QUERY_PROTOCOLS = new Set([
  'aws.protocols#awsQuery',
  'aws.protocols#ec2Query',
]);

const SCALAR_SHAPE_TYPES = new Set([
  'string', 'enum', 'intEnum', 'integer', 'long', 'short', 'byte',
  'float', 'double', 'boolean', 'timestamp', 'blob', 'bigDecimal', 'bigInteger',
]);

const TYPE_MAP: Record<string, JsonMap> = {
  'smithy.api#String': { type: 'string' },
  'smithy.api#Integer': { type: 'integer', format: 'int32' },
  'smithy.api#Long': { type: 'integer', format: 'int64' },
  'smithy.api#Short': { type: 'integer', format: 'int32' },
  'smithy.api#Byte': { type: 'integer', format: 'int32' },
  'smithy.api#Float': { type: 'number', format: 'float' },
  'smithy.api#Double': { type: 'number', format: 'double' },
  'smithy.api#Boolean': { type: 'boolean' },
  'smithy.api#Blob': { type: 'string', format: 'binary' },
  'smithy.api#Timestamp': { type: 'string', format: 'date-time' },
  'smithy.api#Document': { type: 'object' },
  'smithy.api#BigInteger': { type: 'string' },
  'smithy.api#BigDecimal': { type: 'string' },
  'smithy.api#Unit': { type: 'object' },
};

const MAX_QUERY_FLATTEN_DEPTH = 4;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function shapeName(shapeId: string): string {
  return shapeId.split('#').at(-1) || shapeId;
}

export class QueryProtocolConverter {
  private readonly shapes: JsonMap;
  private serviceShape?: [string, JsonMap];
  private protocol?: string;
  private endpointPrefix: string;
  private apiVersion = '';
  private xmlNamespace?: string;
  private targetPrefix = '';
  private openapi: JsonMap = {};

  constructor(
    private readonly model: JsonMap,
    private readonly serviceName: string,
  ) {
    this.shapes = model.shapes || {};
    this.endpointPrefix = serviceName;
  }

  convert(): JsonMap {
    this.serviceShape = this.findServiceShape();
    if (!this.serviceShape) {
      throw new Error('No service shape found in model.');
    }
    this.protocol = this.detectProtocol();
    const [serviceId, serviceDefinition] = this.serviceShape;
    const serviceTrait = serviceDefinition.traits?.['aws.api#service'] || {};
    this.endpointPrefix = serviceTrait.endpointPrefix || this.serviceName;
    this.apiVersion = serviceDefinition.version || '';
    this.xmlNamespace = serviceDefinition.traits?.['smithy.api#xmlNamespace']?.uri;
    this.targetPrefix = shapeName(serviceId);

    this.openapi = {
      openapi: '3.0.2',
      info: this.buildInfo(),
      servers: this.buildServers(),
      paths: {},
      components: {
        schemas: {},
        securitySchemes: this.buildSecuritySchemes(),
      },
      security: [{ aws_sigv4: [] }],
      tags: [],
      'x-aws-target-prefix': this.targetPrefix,
    };
    if (this.protocol) {
      this.openapi['x-aws-protocol'] = shapeName(this.protocol);
    }
    if (this.apiVersion) {
      this.openapi['x-aws-api-version'] = this.apiVersion;
    }
    this.processOperations();
    this.processSchemas();
    return this.openapi;
  }

  get detectedProtocol(): string | undefined {
    return this.protocol;
  }

  private findServiceShape(): [string, JsonMap] | undefined {
    return Object.entries(this.shapes).find(([, definition]) => definition.type === 'service');
  }

  private detectProtocol(): string | undefined {
    const traits = this.serviceShape?.[1].traits || {};
    return Object.keys(PROTOCOLS).find((protocol) => protocol in traits);
  }

  private buildInfo(): JsonMap {
    const definition = this.serviceShape![1];
    const traits = definition.traits || {};
    const serviceTrait = traits['aws.api#service'] || {};
    const rawDescription = traits['smithy.api#documentation'] || `AWS ${this.serviceName} API`;
    const description = String(rawDescription).replace(/<[^>]+>/g, '');
    return {
      title: serviceTrait.sdkId ? `AWS ${serviceTrait.sdkId}` : this.serviceName,
      description: description.length > 500 ? `${description.slice(0, 500)}...` : description,
      version: definition.version || '1.0.0',
      contact: { name: 'AWS Support', url: 'https://aws.amazon.com/support' },
      'x-logo': { url: 'https://aws.amazon.com/favicon.ico', altText: 'AWS' },
    };
  }

  private buildServers(): JsonMap[] {
    return [{
      url: 'https://{service}.{region}.amazonaws.com',
      description: `AWS ${this.serviceName} regional endpoint`,
      variables: {
        service: {
          default: this.endpointPrefix,
          description: 'AWS service endpoint prefix',
        },
        region: {
          default: 'us-east-1',
          description: 'AWS region',
          enum: [
            'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
            'eu-west-1', 'eu-west-2', 'eu-central-1',
            'ap-northeast-1', 'ap-southeast-1', 'ap-southeast-2',
          ],
        },
      },
    }];
  }

  private buildSecuritySchemes(): JsonMap {
    return {
      aws_sigv4: {
        type: 'apiKey',
        name: 'Authorization',
        in: 'header',
        description: 'AWS Signature Version 4 authentication',
        'x-amazon-apigateway-authtype': 'awsSigv4',
      },
    };
  }

  private processOperations(): void {
    const operationIds = [...this.collectOperationIds(this.serviceShape![1])].sort();
    for (const operationId of operationIds) {
      const definition = this.shapes[operationId];
      if (definition) {
        this.processOperation(operationId, definition);
      }
    }
  }

  private collectOperationIds(definition: JsonMap): Set<string> {
    const operationIds = new Set<string>();
    for (const reference of [
      ...(definition.operations || []),
      ...(definition.collectionOperations || []),
    ]) {
      if (reference.target) {
        operationIds.add(reference.target);
      }
    }
    for (const lifecycle of ['create', 'put', 'read', 'update', 'delete', 'list']) {
      const target = definition[lifecycle]?.target;
      if (target) {
        operationIds.add(target);
      }
    }
    for (const reference of definition.resources || []) {
      const resource = reference.target ? this.shapes[reference.target] : undefined;
      if (resource) {
        for (const operation of this.collectOperationIds(resource)) {
          operationIds.add(operation);
        }
      }
    }
    return operationIds;
  }

  private processOperation(operationId: string, definition: JsonMap): void {
    const traits = definition.traits || {};
    const httpTrait = traits['smithy.api#http'] || {};
    let method = String(httpTrait.method || 'POST').toLowerCase();
    let path = String(httpTrait.uri || `/${shapeName(operationId)}`);
    if (Object.keys(httpTrait).length === 0 && [
      'aws.protocols#awsJson1_1',
      'aws.protocols#awsJson1_0',
    ].includes(this.protocol || '')) {
      path = `/${shapeName(operationId)}`;
      method = 'post';
    }

    const pathParameters = [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!);
    const operationName = shapeName(operationId);
    const operation: JsonMap = {
      operationId: operationName,
      summary: operationName,
      description: traits['smithy.api#documentation'] || '',
      tags: [this.serviceName],
      parameters: [],
      responses: {
        '200': { description: 'Success' },
        '400': { description: 'Bad Request' },
        '403': { description: 'Forbidden' },
        '500': { description: 'Internal Server Error' },
      },
    };

    const inputReference = definition.input?.target;
    const inputShape = inputReference ? this.shapes[inputReference] : undefined;
    if (QUERY_PROTOCOLS.has(this.protocol || '')) {
      operation.requestBody = this.buildQueryRequestBody(operationName, inputShape);
    } else if (inputShape) {
      this.processInput(operation, inputShape, pathParameters, method);
    }

    const outputReference = definition.output?.target;
    const outputSchema = outputReference && this.shapes[outputReference]
      ? { $ref: `#/components/schemas/${shapeName(outputReference)}` }
      : undefined;
    if (QUERY_PROTOCOLS.has(this.protocol || '')) {
      const properties: JsonMap = {};
      if (outputSchema) {
        properties[`${operationName}Result`] = {
          allOf: [outputSchema],
          xml: { name: `${operationName}Result` },
        };
      }
      properties.ResponseMetadata = {
        type: 'object',
        properties: { RequestId: { type: 'string' } },
        xml: { name: 'ResponseMetadata' },
      };
      const xml: JsonMap = { name: `${operationName}Response` };
      if (this.xmlNamespace) {
        xml.namespace = this.xmlNamespace;
      }
      operation.responses['200'].content = {
        'application/xml': {
          schema: { type: 'object', properties, xml },
        },
      };
    } else if (outputSchema) {
      operation.responses['200'].content = {
        'application/json': { schema: outputSchema },
      };
    }

    this.openapi.paths[path] ||= {};
    this.openapi.paths[path][method] = operation;
  }

  private processInput(
    operation: JsonMap,
    inputShape: JsonMap,
    _pathParameters: string[],
    method: string,
  ): void {
    const bodyProperties: JsonMap = {};
    const requiredBody: string[] = [];
    for (const [memberName, memberDefinition] of Object.entries(inputShape.members || {}) as [string, JsonMap][]) {
      const traits = memberDefinition.traits || {};
      if ('smithy.api#httpLabel' in traits) {
        operation.parameters.push({
          name: memberName,
          in: 'path',
          required: true,
          schema: this.schemaForTarget(memberDefinition.target || ''),
        });
      } else if ('smithy.api#httpQuery' in traits) {
        operation.parameters.push({
          name: traits['smithy.api#httpQuery'],
          in: 'query',
          required: 'smithy.api#required' in traits,
          schema: this.schemaForTarget(memberDefinition.target || ''),
        });
      } else if ('smithy.api#httpHeader' in traits) {
        operation.parameters.push({
          name: traits['smithy.api#httpHeader'],
          in: 'header',
          required: 'smithy.api#required' in traits,
          schema: this.schemaForTarget(memberDefinition.target || ''),
        });
      } else {
        bodyProperties[memberName] = this.schemaForTarget(memberDefinition.target || '');
        if ('smithy.api#required' in traits) {
          requiredBody.push(memberName);
        }
      }
    }
    if (Object.keys(bodyProperties).length > 0 && !['get', 'delete', 'head'].includes(method)) {
      const schema: JsonMap = { type: 'object', properties: bodyProperties };
      if (requiredBody.length > 0) {
        schema.required = requiredBody;
      }
      operation.requestBody = {
        required: requiredBody.length > 0,
        content: { 'application/json': { schema } },
      };
    }
  }

  private buildQueryRequestBody(operationName: string, inputShape?: JsonMap): JsonMap {
    const properties: JsonMap = {
      Action: { type: 'string', enum: [operationName] },
    };
    const required = ['Action'];
    if (this.apiVersion) {
      properties.Version = { type: 'string', enum: [this.apiVersion] };
      required.push('Version');
    }
    if (inputShape) {
      for (const [memberName, memberDefinition] of Object.entries(inputShape.members || {}) as [string, JsonMap][]) {
        const traits = memberDefinition.traits || {};
        const key = traits['smithy.api#xmlName'] || memberName;
        this.flattenQueryMember(properties, key, memberDefinition.target || '', traits, 1);
        if ('smithy.api#required' in traits && key in properties) {
          required.push(key);
        }
      }
    }
    return {
      required: true,
      content: {
        'application/x-www-form-urlencoded': {
          schema: { type: 'object', properties, required },
        },
      },
    };
  }

  private flattenQueryMember(
    properties: JsonMap,
    prefix: string,
    target: string,
    memberTraits: JsonMap,
    depth: number,
  ): void {
    const shape = this.shapes[target];
    const shapeType = shape?.type;
    if (target in TYPE_MAP || SCALAR_SHAPE_TYPES.has(shapeType)) {
      properties[prefix] = this.schemaForTarget(target);
      return;
    }
    if (depth >= MAX_QUERY_FLATTEN_DEPTH) {
      properties[prefix] = { type: 'string' };
      return;
    }
    if (shapeType === 'structure' || shapeType === 'union') {
      for (const [memberName, memberDefinition] of Object.entries(shape.members || {}) as [string, JsonMap][]) {
        const traits = memberDefinition.traits || {};
        const name = traits['smithy.api#xmlName'] || memberName;
        this.flattenQueryMember(
          properties,
          `${prefix}.${name}`,
          memberDefinition.target || '',
          traits,
          depth + 1,
        );
      }
    } else if (shapeType === 'list') {
      const member = shape.member || {};
      const traits = member.traits || {};
      const itemPrefix = 'smithy.api#xmlFlattened' in memberTraits
        ? `${prefix}.1`
        : `${prefix}.${traits['smithy.api#xmlName'] || 'member'}.1`;
      this.flattenQueryMember(properties, itemPrefix, member.target || '', traits, depth + 1);
    } else if (shapeType === 'map') {
      const key = shape.key || {};
      const value = shape.value || {};
      const keyTraits = key.traits || {};
      const valueTraits = value.traits || {};
      const entryPrefix = 'smithy.api#xmlFlattened' in memberTraits
        ? `${prefix}.1`
        : `${prefix}.entry.1`;
      this.flattenQueryMember(
        properties,
        `${entryPrefix}.${keyTraits['smithy.api#xmlName'] || 'key'}`,
        key.target || '',
        keyTraits,
        depth + 1,
      );
      this.flattenQueryMember(
        properties,
        `${entryPrefix}.${valueTraits['smithy.api#xmlName'] || 'value'}`,
        value.target || '',
        valueTraits,
        depth + 1,
      );
    } else {
      properties[prefix] = { type: 'string' };
    }
  }

  private schemaForTarget(target: string): JsonMap {
    if (target in TYPE_MAP) {
      return clone(TYPE_MAP[target]!);
    }
    const shape = this.shapes[target];
    if (!shape) {
      return { type: 'object' };
    }
    switch (shape.type) {
      case 'string': {
        const schema: JsonMap = { type: 'string' };
        const enumTrait = shape.traits?.['smithy.api#enum'];
        if (Array.isArray(enumTrait)) {
          schema.enum = enumTrait.map((entry) => entry.value || entry.name || '');
        } else if (enumTrait && typeof enumTrait === 'object') {
          schema.enum = Object.keys(enumTrait);
        }
        return schema;
      }
      case 'enum':
        return this.convertEnum(shape);
      case 'intEnum':
      case 'integer':
      case 'short':
      case 'byte':
        return { type: 'integer' };
      case 'long':
        return { type: 'integer', format: 'int64' };
      case 'float':
        return { type: 'number', format: 'float' };
      case 'double':
        return { type: 'number', format: 'double' };
      case 'boolean':
        return { type: 'boolean' };
      case 'timestamp':
        return { type: 'string', format: 'date-time' };
      case 'blob':
        return { type: 'string', format: 'binary' };
      case 'list': {
        const member = shape.member || {};
        let itemSchema = this.schemaForTarget(member.target || '');
        const itemName = member.traits?.['smithy.api#xmlName'] || 'member';
        itemSchema = '$ref' in itemSchema
          ? { allOf: [itemSchema], xml: { name: itemName } }
          : { ...itemSchema, xml: { name: itemName } };
        return { type: 'array', items: itemSchema, xml: { wrapped: true } };
      }
      case 'map':
        return {
          type: 'object',
          additionalProperties: this.schemaForTarget(shape.value?.target || ''),
        };
      case 'structure':
      case 'union':
        return { $ref: `#/components/schemas/${shapeName(target)}` };
      default:
        return { type: 'object' };
    }
  }

  private processSchemas(): void {
    for (const [shapeId, definition] of Object.entries(this.shapes) as [string, JsonMap][]) {
      if (definition.type === 'structure' || definition.type === 'union') {
        this.openapi.components.schemas[shapeName(shapeId)] = this.convertStructure(definition);
      } else if (definition.type === 'enum' || definition.type === 'intEnum') {
        this.openapi.components.schemas[shapeName(shapeId)] = this.convertEnum(definition);
      }
    }
  }

  private convertStructure(definition: JsonMap): JsonMap {
    const properties: JsonMap = {};
    const required: string[] = [];
    for (const [memberName, memberDefinition] of Object.entries(definition.members || {}) as [string, JsonMap][]) {
      properties[memberName] = this.schemaForTarget(memberDefinition.target || '');
      const traits = memberDefinition.traits || {};
      if (traits['smithy.api#documentation']) {
        properties[memberName].description = String(traits['smithy.api#documentation']).slice(0, 200);
      }
      if ('smithy.api#required' in traits) {
        required.push(memberName);
      }
    }
    const schema: JsonMap = { type: 'object', properties };
    if (required.length > 0) {
      schema.required = required;
    }
    const documentation = definition.traits?.['smithy.api#documentation'];
    if (documentation) {
      schema.description = String(documentation).slice(0, 200);
    }
    return schema;
  }

  private convertEnum(definition: JsonMap): JsonMap {
    const values = Object.entries(definition.members || {}).map(([name, member]) => (
      (member as JsonMap).traits?.['smithy.api#enumValue'] ?? name
    ));
    return {
      type: definition.type === 'intEnum' ? 'integer' : 'string',
      enum: values,
    };
  }
}

export async function convertQueryService(
  modelsRoot: string,
  serviceName: string,
  outputDirectory: string,
): Promise<{ service: string; paths: number; protocol: string }> {
  const model = await readServiceModel(modelsRoot, serviceName);
  if (!model) {
    throw new Error(`No model file found for ${serviceName}.`);
  }
  const converter = new QueryProtocolConverter(model, serviceName);
  const openapi = converter.convert();
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, `${serviceName}.openapi.json`),
    `${JSON.stringify(openapi, null, 2)}\n`,
    'utf8',
  );
  return {
    service: serviceName,
    paths: Object.keys(openapi.paths || {}).length,
    protocol: converter.detectedProtocol || 'unknown',
  };
}

export async function convertQueryServices(
  modelsRoot: string,
  services: string[],
  outputDirectory: string,
  logger: Logger,
): Promise<Map<string, Error>> {
  const failures = new Map<string, Error>();
  let successful = 0;
  for (const service of services) {
    try {
      const result = await convertQueryService(modelsRoot, service, outputDirectory);
      logger.info(`${service}: ${result.paths} paths, protocol ${result.protocol}`);
      successful += 1;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      failures.set(service, failure);
      logger.warn(`${service}: ${failure.message}`);
    }
  }
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, 'conversion-report.json'), `${JSON.stringify({
    timestamp: nowIso(),
    totalServices: services.length,
    successful,
    failed: failures.size,
  }, null, 2)}\n`, 'utf8');
  return failures;
}
