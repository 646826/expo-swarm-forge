export type ArkadiumWalletTransactionState = 'pending' | 'applied' | 'rejected';
export type ArkadiumWalletRejectionReason = 'not-accepted';

export interface ArkadiumWalletTransactionRecord {
  readonly recordVersion: 1;
  readonly transactionHash: string;
  readonly amount: number;
  readonly state: ArkadiumWalletTransactionState;
  readonly balance?: number;
  readonly reason?: ArkadiumWalletRejectionReason;
}

export interface ArkadiumWalletLedgerStorage {
  getLocalStorageItem(key: string): Promise<string | null>;
  setLocalStorageItem(key: string, value: string): Promise<void>;
}

export interface ArkadiumWalletTransactionLedger {
  read(transactionHash: string): Promise<ArkadiumWalletTransactionRecord | null>;
  write(record: ArkadiumWalletTransactionRecord): Promise<void>;
}

export interface ArkadiumLocalWalletTransactionLedgerOptions {
  readonly keyPrefix: string;
  readonly maxRecordBytes?: number;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const KEY_PREFIX_PATTERN = /^[a-z][a-z0-9.-]{2,63}$/;
const SENSITIVE_KEY_PART = /(?:credential|password|secret|session|token)/i;
const DEFAULT_MAX_RECORD_BYTES = 1_024;
const RECORD_KEYS = [
  'amount',
  'balance',
  'reason',
  'recordVersion',
  'state',
  'transactionHash',
] as const;

export class ArkadiumLocalWalletTransactionLedger implements ArkadiumWalletTransactionLedger {
  #storage: ArkadiumWalletLedgerStorage;
  #keyPrefix: string;
  #maxRecordBytes: number;

  constructor(
    storage: ArkadiumWalletLedgerStorage,
    options: ArkadiumLocalWalletTransactionLedgerOptions,
  ) {
    const keyPrefix = options.keyPrefix;
    if (
      typeof keyPrefix !== 'string' ||
      keyPrefix !== keyPrefix.trim() ||
      !KEY_PREFIX_PATTERN.test(keyPrefix) ||
      SENSITIVE_KEY_PART.test(keyPrefix)
    ) {
      throw new Error('Arkadium wallet ledger key prefix is invalid.');
    }
    const maxRecordBytes = options.maxRecordBytes ?? DEFAULT_MAX_RECORD_BYTES;
    if (!Number.isSafeInteger(maxRecordBytes) || maxRecordBytes < 128 || maxRecordBytes > 16_384) {
      throw new Error('Arkadium wallet ledger record budget is invalid.');
    }
    this.#storage = storage;
    this.#keyPrefix = keyPrefix;
    this.#maxRecordBytes = maxRecordBytes;
  }

  async read(transactionHash: string): Promise<ArkadiumWalletTransactionRecord | null> {
    assertHash(transactionHash);
    let source: string | null;
    try {
      source = await this.#storage.getLocalStorageItem(this.#key(transactionHash));
    } catch {
      throw new Error('Unable to read Arkadium wallet transaction ledger.');
    }
    if (source === null) return null;
    if (new TextEncoder().encode(source).byteLength > this.#maxRecordBytes) {
      throw invalidRecordError();
    }

    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch {
      throw invalidRecordError();
    }
    const record = normalizeRecord(value, this.#maxRecordBytes);
    if (record.transactionHash !== transactionHash) throw invalidRecordError();
    return cloneRecord(record);
  }

  async write(record: ArkadiumWalletTransactionRecord): Promise<void> {
    const normalized = normalizeRecord(record, this.#maxRecordBytes);
    const source = JSON.stringify(normalized);
    try {
      await this.#storage.setLocalStorageItem(this.#key(normalized.transactionHash), source);
    } catch {
      throw new Error('Unable to write Arkadium wallet transaction ledger.');
    }
  }

  #key(transactionHash: string): string {
    return `${this.#keyPrefix}:${transactionHash}`;
  }
}

function normalizeRecord(value: unknown, maxRecordBytes: number): ArkadiumWalletTransactionRecord {
  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) {
    throw invalidRecordError();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.keys(descriptors)) {
    if (!(RECORD_KEYS as readonly string[]).includes(key)) throw invalidRecordError();
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) throw invalidRecordError();
  }

  const recordVersion = dataValue(descriptors.recordVersion);
  const transactionHash = dataValue(descriptors.transactionHash);
  const amount = dataValue(descriptors.amount);
  const state = dataValue(descriptors.state);
  const balance = dataValue(descriptors.balance);
  const reason = dataValue(descriptors.reason);

  if (recordVersion !== 1 || typeof transactionHash !== 'string') throw invalidRecordError();
  assertHash(transactionHash);
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
    throw invalidRecordError();
  }
  if (state !== 'pending' && state !== 'applied' && state !== 'rejected') {
    throw invalidRecordError();
  }

  let normalized: ArkadiumWalletTransactionRecord;
  if (state === 'pending') {
    if (balance !== undefined || reason !== undefined) throw invalidRecordError();
    normalized = { recordVersion: 1, transactionHash, amount, state };
  } else if (state === 'applied') {
    if (
      typeof balance !== 'number' ||
      !Number.isSafeInteger(balance) ||
      balance < 0 ||
      reason !== undefined
    ) {
      throw invalidRecordError();
    }
    normalized = { recordVersion: 1, transactionHash, amount, state, balance };
  } else {
    if (reason !== 'not-accepted' || balance !== undefined) throw invalidRecordError();
    normalized = { recordVersion: 1, transactionHash, amount, state, reason };
  }

  if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > maxRecordBytes) {
    throw invalidRecordError();
  }
  return Object.freeze(normalized);
}

function assertHash(value: string): void {
  if (!HASH_PATTERN.test(value)) throw invalidRecordError();
}

function dataValue(descriptor: PropertyDescriptor | undefined): unknown {
  return descriptor && descriptor.enumerable && 'value' in descriptor
    ? descriptor.value
    : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneRecord(record: ArkadiumWalletTransactionRecord): ArkadiumWalletTransactionRecord {
  return Object.freeze({ ...record });
}

function invalidRecordError(): Error {
  return new Error('Arkadium wallet transaction record is invalid.');
}
