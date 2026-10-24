import assert from 'node:assert/strict';

/**
 * Strict-indexing helper for tests: assert that an (index-based) lookup is
 * defined and return it narrowed, instead of non-null assertions.
 */
export function defined<T>(value: T | undefined | null, message = 'expected a defined value'): T {
  assert.ok(value !== undefined && value !== null, message);
  return value;
}
