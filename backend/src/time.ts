// SPDX-License-Identifier: Apache-2.0

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function nowStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/T/, '-').replace(/\.\d{3}Z$/, '');
}
