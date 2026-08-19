// SPDX-License-Identifier: Apache-2.0

import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation';

export async function stackOutputs(stackName: string): Promise<Record<string, string>> {
  const client = new CloudFormationClient({});
  const result = await client.send(new DescribeStacksCommand({ StackName: stackName }));
  const stack = result.Stacks?.[0];
  if (!stack) throw new Error(`CloudFormation stack '${stackName}' was not found.`);
  return Object.fromEntries(
    (stack.Outputs || [])
      .filter((output) => output.OutputKey && output.OutputValue)
      .map((output) => [output.OutputKey!, output.OutputValue!]),
  );
}

export function requiredOutput(outputs: Record<string, string>, name: string): string {
  const value = outputs[name];
  if (!value) throw new Error(`CloudFormation output '${name}' is missing.`);
  return value;
}
