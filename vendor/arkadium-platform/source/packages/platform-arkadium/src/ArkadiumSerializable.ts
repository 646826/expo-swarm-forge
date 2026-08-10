import type { SerializableValue } from '../../platform-contract/src/index.ts';

const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function cloneArkadiumSerializable(
  value: unknown,
  ancestors = new Set<object>(),
): SerializableValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw jsonSafeError();
    return value;
  }
  if (typeof value !== 'object') throw jsonSafeError();
  if (ancestors.has(value)) throw jsonSafeError();
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw jsonSafeError();
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const ownNames = Object.keys(descriptors);
      if (
        Object.getOwnPropertySymbols(value).length > 0 ||
        ownNames.some((name) => name !== 'length' && !/^\d+$/.test(name))
      ) {
        throw jsonSafeError();
      }
      const clone: SerializableValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          throw jsonSafeError();
        }
        clone.push(cloneArkadiumSerializable(descriptor.value, ancestors));
      }
      return clone;
    }

    if (!isPlainArkadiumRecord(value) || Object.getOwnPropertySymbols(value).length > 0) {
      throw jsonSafeError();
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const clone: Record<string, SerializableValue> = {};
    for (const key of Object.keys(descriptors).sort()) {
      const descriptor = descriptors[key];
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !('value' in descriptor) ||
        FORBIDDEN_OBJECT_KEYS.has(key)
      ) {
        throw jsonSafeError();
      }
      clone[key] = cloneArkadiumSerializable(descriptor.value, ancestors);
    }
    return clone;
  } finally {
    ancestors.delete(value);
  }
}

export function arkadiumSerializableEqual(
  left: SerializableValue,
  right: SerializableValue,
): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => arkadiumSerializableEqual(value, right[index]!));
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  const leftObject = left as Readonly<Record<string, SerializableValue>>;
  const rightObject = right as Readonly<Record<string, SerializableValue>>;
  const leftKeys = Object.keys(leftObject).sort();
  const rightKeys = Object.keys(rightObject).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key, index) =>
      key === rightKeys[index] &&
      arkadiumSerializableEqual(leftObject[key]!, rightObject[key]!),
  );
}

export function isPlainArkadiumRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function jsonSafeError(): Error {
  return new Error('Value is not JSON-safe.');
}
