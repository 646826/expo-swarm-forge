import {
  jsonByteLength,
  type SerializableValue,
  type UserState,
} from '../../platform-contract/src/index.ts';

import {
  arkadiumSerializableEqual,
  cloneArkadiumSerializable,
  isPlainArkadiumRecord,
} from './ArkadiumSerializable.ts';

export interface ArkadiumPersistenceStorage {
  getLocalStorageItem(key: string): Promise<string | null>;
  setLocalStorageItem(key: string, value: string): Promise<void>;
  getRemoteStorageItem(key: string): Promise<string | object | null>;
  setRemoteStorageItem(key: string, value: string | object): Promise<boolean>;
}

export interface ArkadiumPersistencePolicy {
  readonly key: string;
  readonly compareProgress: (
    local: SerializableValue,
    remote: SerializableValue,
  ) => -1 | 0 | 1;
  readonly equalProgressTieBreaker: 'local' | 'remote';
  readonly now?: () => number;
}

export interface ArkadiumPersistenceServiceOptions {
  readonly saveLimitBytes?: number;
}

export interface ArkadiumSaveEnvelope {
  readonly envelopeVersion: 1;
  readonly updatedAtMs: number;
  readonly payload: SerializableValue;
}

type ParsedEnvelope =
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'valid'; readonly envelope: ArkadiumSaveEnvelope };

type RemoteEnvelope = ParsedEnvelope | { readonly kind: 'unavailable' };

export const ARKADIUM_REMOTE_SAVE_LIMIT_BYTES = 32 * 1024;

const ENVELOPE_KEYS = ['envelopeVersion', 'payload', 'updatedAtMs'] as const;

export class ArkadiumPersistenceService {
  #storage: ArkadiumPersistenceStorage;
  #userState: UserState;
  #policy: ArkadiumPersistencePolicy;
  #key: string;
  #now: () => number;
  #saveLimitBytes: number;

  constructor(
    storage: ArkadiumPersistenceStorage,
    userState: UserState,
    policy: ArkadiumPersistencePolicy,
    options: ArkadiumPersistenceServiceOptions = {},
  ) {
    const key = policy.key.trim();
    if (key.length === 0) throw new Error('Arkadium persistence key must be non-empty.');
    if (typeof policy.compareProgress !== 'function') {
      throw new Error('Arkadium persistence compareProgress must be a function.');
    }
    if (
      policy.equalProgressTieBreaker !== 'local' &&
      policy.equalProgressTieBreaker !== 'remote'
    ) {
      throw new Error('Arkadium persistence tie breaker must be local or remote.');
    }
    const saveLimitBytes = options.saveLimitBytes ?? ARKADIUM_REMOTE_SAVE_LIMIT_BYTES;
    if (!Number.isSafeInteger(saveLimitBytes) || saveLimitBytes < 1) {
      throw new Error('Arkadium persistence save limit must be a positive safe integer.');
    }
    if (saveLimitBytes > ARKADIUM_REMOTE_SAVE_LIMIT_BYTES) {
      throw new Error('Arkadium persistence save limit must not exceed 32 KiB.');
    }

    this.#storage = storage;
    this.#userState = userState;
    this.#policy = policy;
    this.#key = key;
    this.#now = policy.now ?? Date.now;
    this.#saveLimitBytes = saveLimitBytes;
  }

  async load(): Promise<SerializableValue | null> {
    const local = await this.#readLocal();
    if (this.#userState === 'anonymous') {
      if (local.kind === 'missing') return null;
      if (local.kind === 'invalid') throw invalidEnvelopeError();
      return cloneArkadiumSerializable(local.envelope.payload);
    }

    const remote = await this.#readRemote();
    if (remote.kind === 'unavailable') {
      if (local.kind === 'valid') return cloneArkadiumSerializable(local.envelope.payload);
      throw invalidEnvelopeError();
    }

    return this.#reconcile(local, remote);
  }

  async save(value: SerializableValue): Promise<void> {
    const payload = cloneArkadiumSerializable(value);
    const updatedAtMs = this.#now();
    if (!Number.isFinite(updatedAtMs) || updatedAtMs < 0) {
      throw new Error('Arkadium persistence timestamp must be finite and non-negative.');
    }
    const envelope = this.#validateEnvelope({ envelopeVersion: 1, updatedAtMs, payload });
    if (!envelope) throw invalidEnvelopeError();

    await this.#writeLocal(envelope);
    if (this.#userState === 'anonymous') return;

    let accepted: boolean;
    try {
      accepted = await this.#storage.setRemoteStorageItem(this.#key, cloneEnvelope(envelope));
    } catch {
      throw new Error('Unable to write Arkadium remote save.');
    }
    if (!accepted) throw new Error('Arkadium remote save was not accepted.');
  }

  async #readLocal(): Promise<ParsedEnvelope> {
    let source: string | null;
    try {
      source = await this.#storage.getLocalStorageItem(this.#key);
    } catch {
      throw new Error('Unable to read Arkadium local save.');
    }
    if (source === null) return { kind: 'missing' };

    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch {
      return { kind: 'invalid' };
    }
    const envelope = this.#validateEnvelope(value);
    return envelope ? { kind: 'valid', envelope } : { kind: 'invalid' };
  }

  async #readRemote(): Promise<RemoteEnvelope> {
    let value: string | object | null;
    try {
      value = await this.#storage.getRemoteStorageItem(this.#key);
    } catch {
      return { kind: 'unavailable' };
    }
    if (value === null) return { kind: 'missing' };
    if (typeof value === 'string') return { kind: 'invalid' };
    const envelope = this.#validateEnvelope(value);
    return envelope ? { kind: 'valid', envelope } : { kind: 'invalid' };
  }

  async #reconcile(
    local: ParsedEnvelope,
    remote: ParsedEnvelope,
  ): Promise<SerializableValue | null> {
    if (local.kind === 'missing' && remote.kind === 'missing') return null;

    if (local.kind === 'valid' && remote.kind !== 'valid') {
      await this.#writeRemoteBestEffort(local.envelope);
      return cloneArkadiumSerializable(local.envelope.payload);
    }

    if (remote.kind === 'valid' && local.kind !== 'valid') {
      await this.#writeLocal(remote.envelope);
      return cloneArkadiumSerializable(remote.envelope.payload);
    }

    if (local.kind !== 'valid' || remote.kind !== 'valid') throw invalidEnvelopeError();

    if (arkadiumSerializableEqual(local.envelope.payload, remote.envelope.payload)) {
      return cloneArkadiumSerializable(local.envelope.payload);
    }

    let comparison: -1 | 0 | 1;
    try {
      comparison = this.#policy.compareProgress(
        cloneArkadiumSerializable(local.envelope.payload),
        cloneArkadiumSerializable(remote.envelope.payload),
      );
    } catch {
      throw new Error('Arkadium save progress comparison failed.');
    }
    if (comparison !== -1 && comparison !== 0 && comparison !== 1) {
      throw new Error('Arkadium save progress comparator must return -1, 0, or 1.');
    }

    const selected =
      comparison > 0 || (comparison === 0 && this.#policy.equalProgressTieBreaker === 'local')
        ? 'local'
        : 'remote';

    if (selected === 'local') {
      await this.#writeRemoteBestEffort(local.envelope);
      return cloneArkadiumSerializable(local.envelope.payload);
    }

    await this.#writeLocal(remote.envelope);
    return cloneArkadiumSerializable(remote.envelope.payload);
  }

  #validateEnvelope(value: unknown): ArkadiumSaveEnvelope | null {
    if (!isPlainArkadiumRecord(value) || Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort();
    if (keys.join('\0') !== [...ENVELOPE_KEYS].sort().join('\0')) return null;

    const envelopeVersion = dataDescriptorValue(descriptors.envelopeVersion);
    const updatedAtMs = dataDescriptorValue(descriptors.updatedAtMs);
    const rawPayload = dataDescriptorValue(descriptors.payload);
    if (envelopeVersion !== 1) return null;
    if (typeof updatedAtMs !== 'number' || !Number.isFinite(updatedAtMs) || updatedAtMs < 0) {
      return null;
    }
    if (rawPayload === INVALID_DESCRIPTOR) return null;

    let payload: SerializableValue;
    try {
      payload = cloneArkadiumSerializable(rawPayload);
    } catch {
      return null;
    }
    const envelope: ArkadiumSaveEnvelope = { envelopeVersion: 1, updatedAtMs, payload };
    if (jsonByteLength(envelope) > this.#saveLimitBytes) {
      throw new Error('Arkadium save envelope exceeds the configured save limit.');
    }
    return envelope;
  }

  async #writeLocal(envelope: ArkadiumSaveEnvelope): Promise<void> {
    try {
      await this.#storage.setLocalStorageItem(this.#key, JSON.stringify(envelope));
    } catch {
      throw new Error('Unable to write Arkadium local save.');
    }
  }

  async #writeRemoteBestEffort(envelope: ArkadiumSaveEnvelope): Promise<void> {
    try {
      await this.#storage.setRemoteStorageItem(this.#key, cloneEnvelope(envelope));
    } catch {
      // A valid local save remains the user-safe fallback.
    }
  }
}

const INVALID_DESCRIPTOR = Symbol('invalid descriptor');

function dataDescriptorValue(
  descriptor: PropertyDescriptor | undefined,
): unknown | typeof INVALID_DESCRIPTOR {
  if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
    return INVALID_DESCRIPTOR;
  }
  return descriptor.value;
}

function invalidEnvelopeError(): Error {
  return new Error('Arkadium persistence requires at least one valid save envelope.');
}

function cloneEnvelope(envelope: ArkadiumSaveEnvelope): ArkadiumSaveEnvelope {
  return {
    envelopeVersion: 1,
    updatedAtMs: envelope.updatedAtMs,
    payload: cloneArkadiumSerializable(envelope.payload),
  };
}
