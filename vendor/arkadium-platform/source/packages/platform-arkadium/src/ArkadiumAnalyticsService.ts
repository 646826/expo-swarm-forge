import type { AnalyticsEvent } from '../../platform-contract/src/index.ts';

import { cloneArkadiumSerializable, isPlainArkadiumRecord } from './ArkadiumSerializable.ts';
import type { OfficialArkadiumSdk } from './official-sdk.ts';

export type ArkadiumAnalyticsBackend = Pick<
  OfficialArkadiumSdk['analytics'],
  'setGameVersion' | 'configureProvider' | 'sendEvent'
> &
  Pick<OfficialArkadiumSdk['analytics'], 'APP_INSIGHTS'>;

export type ArkadiumAnalyticsPropertyType = 'string' | 'number' | 'boolean';

export interface ArkadiumAnalyticsPropertyRule {
  readonly output: string;
  readonly type: ArkadiumAnalyticsPropertyType;
  readonly required?: boolean;
  readonly maxLength?: number;
}

export interface ArkadiumAnalyticsEventRule {
  readonly name: string;
  readonly version: number;
  readonly category: string;
  readonly action: string;
  readonly properties: Readonly<Record<string, ArkadiumAnalyticsPropertyRule>>;
}

export interface ArkadiumAnalyticsPolicy {
  readonly appId: string;
  readonly gameVersion: string;
  readonly events: readonly ArkadiumAnalyticsEventRule[];
}

type AnalyticsPrimitive = string | number | boolean;

interface NormalizedPropertyRule {
  readonly input: string;
  readonly output: string;
  readonly type: ArkadiumAnalyticsPropertyType;
  readonly required: boolean;
  readonly maxLength: number | undefined;
}

interface NormalizedEventRule {
  readonly name: string;
  readonly version: number;
  readonly category: string;
  readonly action: string;
  readonly properties: ReadonlyMap<string, NormalizedPropertyRule>;
}

const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_.-]{1,79}$/;
const OUTPUT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
const GAME_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const PLACEHOLDER_APP_ID = /^(?:your|replace|placeholder|example|test|todo|tbd)(?:[-_ ]|$)/i;
const MAX_APP_ID_LENGTH = 256;
const DEFAULT_STRING_MAX_LENGTH = 256;
const MAX_PROPERTIES_PER_EVENT = 40;
const SENSITIVE_DIMENSION_PARTS = [
  'email',
  'token',
  'secret',
  'password',
  'credential',
  'cookie',
  'jwt',
  'profile',
  'session',
  'userid',
  'user_id',
] as const;

export class ArkadiumAnalyticsService {
  #backend: ArkadiumAnalyticsBackend;
  #appId: string;
  #gameVersion: string;
  #events: ReadonlyMap<string, NormalizedEventRule>;
  #state: 'new' | 'initialized' | 'failed' = 'new';

  constructor(backend: ArkadiumAnalyticsBackend, policy: ArkadiumAnalyticsPolicy) {
    const normalized = normalizePolicy(policy);
    this.#backend = backend;
    this.#appId = normalized.appId;
    this.#gameVersion = normalized.gameVersion;
    this.#events = normalized.events;
  }

  get isInitialized(): boolean {
    return this.#state === 'initialized';
  }

  async initialize(): Promise<void> {
    if (this.#state === 'initialized') return;
    if (this.#state === 'failed') {
      throw new Error('Arkadium analytics initialization previously failed.');
    }

    try {
      await this.#backend.setGameVersion(this.#gameVersion);
      await this.#backend.configureProvider({
        appId: this.#appId,
        provider: this.#backend.APP_INSIGHTS,
      });
      this.#state = 'initialized';
    } catch {
      this.#state = 'failed';
      throw new Error('Unable to initialize Arkadium analytics.');
    }
  }

  async track(event: AnalyticsEvent): Promise<void> {
    if (this.#state !== 'initialized') {
      throw new Error('Arkadium analytics is not initialized.');
    }

    const normalizedEvent = normalizeEventInput(event);
    const identity = eventIdentity(normalizedEvent.name, normalizedEvent.version);
    const definition = this.#events.get(identity);
    if (!definition) {
      throw new Error(`Arkadium analytics event ${identity} is not allowlisted.`);
    }

    const dimensions = normalizeDimensions(definition, normalizedEvent.properties);
    try {
      await this.#backend.sendEvent(definition.category, definition.action, dimensions);
    } catch {
      throw new Error('Unable to send Arkadium analytics event.');
    }
  }
}

function normalizePolicy(policy: ArkadiumAnalyticsPolicy): {
  readonly appId: string;
  readonly gameVersion: string;
  readonly events: ReadonlyMap<string, NormalizedEventRule>;
} {
  let cloned: unknown;
  try {
    cloned = cloneArkadiumSerializable(policy);
  } catch {
    throw new Error('Arkadium analytics policy must contain data properties only.');
  }
  const record = requireExactRecord(cloned, ['appId', 'events', 'gameVersion'], 'analytics policy');

  const appId = normalizeAppId(record.appId);
  const gameVersion = normalizeGameVersion(record.gameVersion);
  if (!Array.isArray(record.events) || record.events.length === 0) {
    throw new Error('Arkadium analytics policy must define at least one event.');
  }

  const events = new Map<string, NormalizedEventRule>();
  for (const rawEvent of record.events) {
    const eventRecord = requireExactRecord(
      rawEvent,
      ['action', 'category', 'name', 'properties', 'version'],
      'analytics event rule',
    );
    const name = requirePattern(eventRecord.name, EVENT_NAME_PATTERN, 'analytics event name');
    const rawVersion = eventRecord.version;
    if (typeof rawVersion !== 'number' || !Number.isSafeInteger(rawVersion) || rawVersion <= 0) {
      throw new Error('Arkadium analytics event version must be a positive safe integer.');
    }
    const version = rawVersion;
    const category = requireText(eventRecord.category, 'analytics category');
    const action = requireText(eventRecord.action, 'analytics action');
    const properties = normalizePropertyRules(eventRecord.properties);
    const identity = eventIdentity(name, version);
    if (events.has(identity)) {
      throw new Error(`Arkadium analytics policy contains duplicate event identity ${identity}.`);
    }
    events.set(identity, Object.freeze({ name, version, category, action, properties }));
  }

  return Object.freeze({ appId, gameVersion, events });
}

function normalizePropertyRules(value: unknown): ReadonlyMap<string, NormalizedPropertyRule> {
  if (!isPlainArkadiumRecord(value)) {
    throw new Error('Arkadium analytics event properties must be a plain object.');
  }
  const keys = Object.keys(value).sort();
  if (keys.length > MAX_PROPERTIES_PER_EVENT) {
    throw new Error('Arkadium analytics event defines too many properties.');
  }

  const rules = new Map<string, NormalizedPropertyRule>();
  const outputs = new Set<string>();
  for (const input of keys) {
    if (!OUTPUT_NAME_PATTERN.test(input)) {
      throw new Error(`Arkadium analytics property name ${input} is invalid.`);
    }
    const ruleRecord = requireAllowedRecord(
      value[input],
      ['maxLength', 'output', 'required', 'type'],
      'analytics property rule',
    );
    const output = requirePattern(
      ruleRecord.output,
      OUTPUT_NAME_PATTERN,
      'analytics output dimension',
    );
    if (isSensitiveDimension(input) || isSensitiveDimension(output)) {
      throw new Error(`Arkadium analytics policy contains sensitive dimension ${input}.`);
    }
    if (outputs.has(output)) {
      throw new Error(`Arkadium analytics event contains duplicate output dimension ${output}.`);
    }
    outputs.add(output);

    const type = ruleRecord.type;
    if (type !== 'string' && type !== 'number' && type !== 'boolean') {
      throw new Error(`Arkadium analytics property ${input} has an invalid type.`);
    }
    const required = ruleRecord.required ?? false;
    if (typeof required !== 'boolean') {
      throw new Error(`Arkadium analytics property ${input} required flag must be boolean.`);
    }
    let maxLength: number | undefined;
    if (type === 'string') {
      const rawMaxLength = ruleRecord.maxLength ?? DEFAULT_STRING_MAX_LENGTH;
      if (
        typeof rawMaxLength !== 'number' ||
        !Number.isSafeInteger(rawMaxLength) ||
        rawMaxLength <= 0 ||
        rawMaxLength > 4_096
      ) {
        throw new Error(`Arkadium analytics property ${input} maxLength is invalid.`);
      }
      maxLength = rawMaxLength;
    } else if (ruleRecord.maxLength !== undefined) {
      throw new Error(`Arkadium analytics property ${input} maxLength is valid only for strings.`);
    }

    rules.set(input, Object.freeze({ input, output, type, required, maxLength }));
  }
  return rules;
}

function normalizeEventInput(event: AnalyticsEvent): {
  readonly name: string;
  readonly version: number;
  readonly properties: Readonly<Record<string, unknown>>;
} {
  const record = requireAllowedRecord(event, ['name', 'properties', 'version'], 'analytics event');
  const name = requirePattern(record.name, EVENT_NAME_PATTERN, 'analytics event name');
  const rawVersion = record.version;
  if (typeof rawVersion !== 'number' || !Number.isSafeInteger(rawVersion) || rawVersion <= 0) {
    throw new Error('Arkadium analytics event version must be a positive safe integer.');
  }
  const version = rawVersion;
  const properties = readDataRecord(record.properties ?? {}, 'analytics event properties');
  return { name, version, properties };
}

function normalizeDimensions(
  definition: NormalizedEventRule,
  properties: Readonly<Record<string, unknown>>,
): Readonly<Record<string, AnalyticsPrimitive>> {
  const propertyKeys = Object.keys(properties).sort();
  for (const input of propertyKeys) {
    if (!definition.properties.has(input)) {
      throw new Error(`Arkadium analytics event contains unknown property ${input}.`);
    }
  }

  const dimensions: Record<string, AnalyticsPrimitive> = {};
  const rules = [...definition.properties.values()].sort((left, right) =>
    left.output.localeCompare(right.output),
  );
  for (const rule of rules) {
    const value = properties[rule.input];
    if (value === undefined) {
      if (rule.required) {
        throw new Error(`Arkadium analytics event is missing required property ${rule.input}.`);
      }
      continue;
    }
    if (!satisfiesRule(value, rule)) {
      throw new Error(
        `Arkadium analytics property ${rule.input} does not satisfy its analytics rule.`,
      );
    }
    dimensions[rule.output] = value as AnalyticsPrimitive;
  }
  return Object.freeze(dimensions);
}

function satisfiesRule(value: unknown, rule: NormalizedPropertyRule): boolean {
  if (rule.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (rule.type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'string' && value.length <= (rule.maxLength ?? DEFAULT_STRING_MAX_LENGTH);
}

function normalizeAppId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Arkadium analytics requires a publisher-assigned App Insights ID.');
  }
  const normalized = value.trim();
  if (
    normalized.length < 8 ||
    normalized.length > MAX_APP_ID_LENGTH ||
    PLACEHOLDER_APP_ID.test(normalized) ||
    /^0+$/.test(normalized)
  ) {
    throw new Error('Arkadium analytics requires a publisher-assigned App Insights ID.');
  }
  return normalized;
}

function normalizeGameVersion(value: unknown): string {
  if (typeof value !== 'string' || !GAME_VERSION_PATTERN.test(value.trim())) {
    throw new Error('Arkadium analytics game version is invalid.');
  }
  return value.trim();
}

function readDataRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!isPlainArkadiumRecord(value) || Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(`Arkadium ${label} must be a plain object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const record: Record<string, unknown> = {};
  for (const key of Object.keys(descriptors).sort()) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new Error('Arkadium analytics event must contain data properties only.');
    }
    record[key] = descriptor.value;
  }
  return record;
}

function requireExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  const record = requireAllowedRecord(value, expectedKeys, label);
  const keys = Object.keys(record).sort();
  if (keys.join('\0') !== [...expectedKeys].sort().join('\0')) {
    throw new Error(`Arkadium ${label} must contain exactly the reviewed fields.`);
  }
  return record;
}

function requireAllowedRecord(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  if (!isPlainArkadiumRecord(value) || Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(`Arkadium ${label} must be a plain object.`);
  }
  const allowed = new Set(allowedKeys);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const record: Record<string, unknown> = {};
  for (const key of Object.keys(descriptors).sort()) {
    const descriptor = descriptors[key];
    if (!allowed.has(key)) {
      throw new Error(`Arkadium ${label} contains unsupported field ${key}.`);
    }
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new Error('Arkadium analytics policy must contain data properties only.');
    }
    record[key] = descriptor.value;
  }
  return record;
}

function requirePattern(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`Arkadium ${label} is invalid.`);
  }
  return value;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Arkadium ${label} is invalid.`);
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 80 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error(`Arkadium ${label} is invalid.`);
  }
  return normalized;
}

function isSensitiveDimension(value: string): boolean {
  const normalized = value.toLowerCase();
  return SENSITIVE_DIMENSION_PARTS.some((part) => normalized.includes(part));
}

function eventIdentity(name: string, version: number): string {
  return `${name}@${version}`;
}
