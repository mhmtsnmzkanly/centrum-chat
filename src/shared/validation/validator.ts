import { ValidationError } from "../errors/validationError.ts";

/** Tiny schema-validation helper (no external dependency). Route/handler input
 * validation lives here so decoded WS/HTTP bodies never get read with raw property
 * access and silent `undefined`s. */
export function asRecord(value: unknown, context = "Request body"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(`${context} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export interface StringRule {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: RegExp;
}

export function requireString(
  record: Record<string, unknown>,
  field: string,
  rule: StringRule = {},
): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw new ValidationError(`"${field}" is required and must be a string.`, { field });
  }
  const trimmed = value.trim();
  if (rule.minLength !== undefined && trimmed.length < rule.minLength) {
    throw new ValidationError(`"${field}" must be at least ${rule.minLength} characters.`, {
      field,
    });
  }
  if (rule.maxLength !== undefined && trimmed.length > rule.maxLength) {
    throw new ValidationError(`"${field}" must be at most ${rule.maxLength} characters.`, {
      field,
    });
  }
  if (rule.pattern && !rule.pattern.test(trimmed)) {
    throw new ValidationError(`"${field}" has an invalid format.`, { field });
  }
  return trimmed;
}

export function optionalString(
  record: Record<string, unknown>,
  field: string,
  rule: StringRule = {},
): string | undefined {
  if (record[field] === undefined || record[field] === null) return undefined;
  return requireString(record, field, rule);
}

export function optionalInteger(
  record: Record<string, unknown>,
  field: string,
  rule: { min?: number; max?: number } = {},
): number | undefined {
  const value = record[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ValidationError(`"${field}" must be an integer.`, { field });
  }
  if (rule.min !== undefined && value < rule.min) {
    throw new ValidationError(`"${field}" must be at least ${rule.min}.`, { field });
  }
  if (rule.max !== undefined && value > rule.max) {
    throw new ValidationError(`"${field}" must be at most ${rule.max}.`, { field });
  }
  return value;
}

export function optionalBoolean(
  record: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const value = record[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new ValidationError(`"${field}" must be a boolean.`, { field });
  }
  return value;
}

export function requireEnum<T extends string>(
  record: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const value = requireString(record, field);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`"${field}" must be one of: ${allowed.join(", ")}.`, {
      field,
      allowed,
    });
  }
  return value as T;
}

export function optionalEnum<T extends string>(
  record: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T | undefined {
  if (record[field] === undefined || record[field] === null) return undefined;
  return requireEnum(record, field, allowed);
}
