import type {
  AdResult,
  RewardedAdResult,
  UserState,
} from '../../platform-contract/src/index.ts';

import { cloneArkadiumSerializable, isPlainArkadiumRecord } from './ArkadiumSerializable.ts';
import type { OfficialArkadiumSdk } from './official-sdk.ts';

export type ArkadiumAdvertisingBackend = Pick<
  OfficialArkadiumSdk['ads'],
  'showInterstitialAd' | 'showRewardAd'
>;

export interface ArkadiumInterstitialPlacement {
  readonly duration?: number;
}

export type ArkadiumRewardedDataValue = string | number | boolean;

export interface ArkadiumRewardedPlacement {
  readonly duration?: number;
  readonly context?: 'core' | 'default';
  readonly data?: Readonly<Record<string, ArkadiumRewardedDataValue>>;
  readonly allowSubscribers: boolean;
}

export interface ArkadiumAdPlacementPolicy {
  readonly interstitial: Readonly<Record<string, ArkadiumInterstitialPlacement>>;
  readonly rewarded: Readonly<Record<string, ArkadiumRewardedPlacement>>;
}

const SENSITIVE_DATA_KEY =
  /(?:auth|cookie|credential|email|jwt|password|profile|secret|session|token|user)/i;
const MAX_DATA_ENTRIES = 20;
const MAX_DATA_JSON_BYTES = 4_096;

export class ArkadiumAdvertisingService {
  readonly supportsInterstitial: boolean;
  readonly supportsRewarded: boolean;

  #backend: ArkadiumAdvertisingBackend;
  #userState: UserState;
  #interstitial: ReadonlyMap<string, ArkadiumInterstitialPlacement>;
  #rewarded: ReadonlyMap<string, ArkadiumRewardedPlacement>;
  #queue: Promise<void> = Promise.resolve();

  constructor(
    backend: ArkadiumAdvertisingBackend,
    userState: UserState,
    policy: ArkadiumAdPlacementPolicy,
  ) {
    this.#backend = backend;
    this.#userState = userState;
    this.#interstitial = normalizeInterstitialPlacements(policy.interstitial);
    this.#rewarded = normalizeRewardedPlacements(policy.rewarded);

    for (const placementId of this.#interstitial.keys()) {
      if (this.#rewarded.has(placementId)) {
        throw new Error('Arkadium placement IDs cannot be reused across ad kinds.');
      }
    }

    this.supportsInterstitial = userState !== 'subscriber' && this.#interstitial.size > 0;
    this.supportsRewarded = [...this.#rewarded.values()].some(
      (placement) => userState !== 'subscriber' || placement.allowSubscribers,
    );
  }

  async showInterstitial(placementId: string): Promise<AdResult> {
    const placement = this.#interstitial.get(placementId);
    if (!placement || this.#userState === 'subscriber') return { shown: false };

    return this.#serialize(async () => {
      try {
        await this.#backend.showInterstitialAd(optionsForInterstitial(placement));
      } catch {
        throw new Error('Unable to show Arkadium interstitial ad.');
      }
      return { shown: true };
    });
  }

  async showRewarded(placementId: string): Promise<RewardedAdResult> {
    const placement = this.#rewarded.get(placementId);
    if (!placement || (this.#userState === 'subscriber' && !placement.allowSubscribers)) {
      return { completed: false };
    }

    return this.#serialize(async () => {
      let result: { readonly value: number };
      try {
        result = await this.#backend.showRewardAd(optionsForRewarded(placement));
      } catch {
        throw new Error('Unable to show Arkadium rewarded ad.');
      }
      if (result.value === 1) return { completed: true };
      if (result.value === 0) return { completed: false };
      throw new Error('Arkadium rewarded ad returned an unsupported completion value.');
    });
  }

  async #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#queue;
    let release!: () => void;
    this.#queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function normalizeInterstitialPlacements(
  value: Readonly<Record<string, ArkadiumInterstitialPlacement>>,
): ReadonlyMap<string, ArkadiumInterstitialPlacement> {
  const result = new Map<string, ArkadiumInterstitialPlacement>();
  for (const [placementId, rawPlacement] of safeEntries(value)) {
    validatePlacementId(placementId);
    const placement = readPlacementConfiguration(rawPlacement, ['duration']);
    const duration = normalizeDuration(placement.duration as number | undefined);
    result.set(placementId, Object.freeze(duration === undefined ? {} : { duration }));
  }
  return result;
}

function normalizeRewardedPlacements(
  value: Readonly<Record<string, ArkadiumRewardedPlacement>>,
): ReadonlyMap<string, ArkadiumRewardedPlacement> {
  const result = new Map<string, ArkadiumRewardedPlacement>();
  for (const [placementId, rawPlacement] of safeEntries(value)) {
    validatePlacementId(placementId);
    const placement = readPlacementConfiguration(rawPlacement, [
      'allowSubscribers',
      'context',
      'data',
      'duration',
    ]);
    const duration = normalizeDuration(placement.duration as number | undefined);
    const context = placement.context;
    if (context !== undefined && context !== 'core' && context !== 'default') {
      throw new Error('Arkadium rewarded placement context is invalid.');
    }
    if (typeof placement.allowSubscribers !== 'boolean') {
      throw new Error('Arkadium rewarded placement allowSubscribers must be boolean.');
    }
    const data =
      placement.data === undefined
        ? undefined
        : normalizeRewardedData(
            placement.data as Readonly<Record<string, ArkadiumRewardedDataValue>>,
          );
    result.set(
      placementId,
      Object.freeze({
        ...(duration === undefined ? {} : { duration }),
        ...(context === undefined ? {} : { context }),
        ...(data === undefined ? {} : { data }),
        allowSubscribers: placement.allowSubscribers,
      }),
    );
  }
  return result;
}

function safeEntries<T>(value: Readonly<Record<string, T>>): ReadonlyArray<readonly [string, T]> {
  if (!isPlainArkadiumRecord(value) || Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error('Arkadium advertising placement policy must be a plain object.');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries: Array<readonly [string, T]> = [];
  for (const key of Object.keys(descriptors).sort()) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new Error('Arkadium advertising placement policy must contain data properties only.');
    }
    entries.push([key, descriptor.value as T]);
  }
  return entries;
}

function readPlacementConfiguration(
  value: unknown,
  allowedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (!isPlainArkadiumRecord(value) || Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error('Arkadium placement configuration must be a plain object.');
  }
  const allowed = new Set(allowedKeys);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(descriptors).sort()) {
    const descriptor = descriptors[key];
    if (!allowed.has(key)) {
      throw new Error(`Arkadium placement configuration contains unsupported field ${key}.`);
    }
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new Error('Arkadium placement configuration must contain data properties only.');
    }
    normalized[key] = descriptor.value;
  }
  return normalized;
}

function validatePlacementId(value: string): void {
  if (value.length === 0 || value !== value.trim()) {
    throw new Error('Arkadium placement IDs must be non-empty and trimmed.');
  }
}

function normalizeDuration(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Arkadium ad duration must be a positive finite number.');
  }
  return value;
}

function normalizeRewardedData(
  value: Readonly<Record<string, ArkadiumRewardedDataValue>>,
): Readonly<Record<string, ArkadiumRewardedDataValue>> {
  let cloned: unknown;
  try {
    cloned = cloneArkadiumSerializable(value);
  } catch {
    throw new Error('Arkadium rewarded placement data is invalid.');
  }
  if (!isPlainArkadiumRecord(cloned)) {
    throw new Error('Arkadium rewarded placement data is invalid.');
  }
  const keys = Object.keys(cloned);
  if (keys.length > MAX_DATA_ENTRIES || keys.some((key) => SENSITIVE_DATA_KEY.test(key))) {
    throw new Error('Arkadium rewarded placement data is invalid.');
  }
  const normalized: Record<string, ArkadiumRewardedDataValue> = {};
  for (const key of keys.sort()) {
    const item = cloned[key];
    if (
      (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') ||
      (typeof item === 'number' && !Number.isFinite(item))
    ) {
      throw new Error('Arkadium rewarded placement data is invalid.');
    }
    normalized[key] = item;
  }
  if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > MAX_DATA_JSON_BYTES) {
    throw new Error('Arkadium rewarded placement data is invalid.');
  }
  return Object.freeze(normalized);
}

function optionsForInterstitial(
  placement: ArkadiumInterstitialPlacement,
): { readonly duration?: number } {
  return placement.duration === undefined ? {} : { duration: placement.duration };
}

function optionsForRewarded(placement: ArkadiumRewardedPlacement): {
  readonly duration?: number;
  readonly context?: 'core' | 'default';
  readonly data?: Readonly<Record<string, ArkadiumRewardedDataValue>>;
} {
  return {
    ...(placement.duration === undefined ? {} : { duration: placement.duration }),
    ...(placement.context === undefined ? {} : { context: placement.context }),
    ...(placement.data === undefined ? {} : { data: placement.data }),
  };
}
