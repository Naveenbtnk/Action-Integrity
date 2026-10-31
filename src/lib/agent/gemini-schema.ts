import { z, type ZodType } from 'zod';

const SUPPORTED_KEYS = new Set(['type', 'properties', 'required', 'enum', 'items']);

function keepSupportedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(keepSupportedKeys);
  if (!value || typeof value !== 'object') return value;

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!SUPPORTED_KEYS.has(key)) continue;
    result[key] =
      key === 'properties' && entry && typeof entry === 'object' && !Array.isArray(entry)
        ? Object.fromEntries(
            Object.entries(entry).map(([name, property]) => [name, keepSupportedKeys(property)]),
          )
        : keepSupportedKeys(entry);
  }
  return result;
}

export function geminiJsonSchema(schema: ZodType<unknown>): Record<string, unknown> {
  // The provider accepts a JSON Schema subset. Zod remains the authoritative validator.
  return keepSupportedKeys(z.toJSONSchema(schema)) as Record<string, unknown>;
}
