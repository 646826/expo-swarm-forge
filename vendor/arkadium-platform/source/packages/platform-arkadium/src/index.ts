import {
  LifecycleGuard,
  err,
  ok,
  redactAnalyticsProperties,
  sdkFailure,
  validateSavePayload,
  type AdResult,
  type AnalyticsEvent,
  type LeaderboardSubmission,
  type LifecycleState,
  type PlatformCapabilities,
  type PlatformContext,
  type PublisherPlatform,
  type Result,
  type RewardedAdResult,
  type SerializableValue,
  type UserState,
  type WalletResult,
} from '../../platform-contract/src/index.ts';

export interface ArkadiumBridgeContext {
  readonly userState: UserState;
  readonly locale: string;
  readonly capabilities?: PlatformCapabilities;
}

export interface ArkadiumSdkBridge {
  readonly capabilities: PlatformCapabilities;
  initialize(): Promise<ArkadiumBridgeContext>;
  readonly lifecycle: {
    ready(): Promise<void>;
    gameStart(): Promise<void>;
    score(value: number): Promise<void>;
    levelStart(levelId: string): Promise<void>;
    levelEnd(levelId: string): Promise<void>;
    gameEnd(reason: string): Promise<void>;
  };
  readonly persistence?: {
    load(): Promise<unknown>;
    save(value: SerializableValue): Promise<void>;
  };
  readonly analytics?: {
    track(event: AnalyticsEvent): Promise<void>;
  };
  readonly advertising?: {
    showInterstitial?(placement: string): Promise<AdResult>;
    showRewarded?(placement: string): Promise<RewardedAdResult>;
  };
  readonly wallet?: {
    getBalance(): Promise<number>;
    consume(amount: number, transactionId: string): Promise<WalletResult>;
  };
  readonly leaderboards?: {
    submit(entry: LeaderboardSubmission): Promise<void>;
  };
  onPause?(handler: () => void): () => void;
  onResume?(handler: () => void): () => void;
  destroy?(): Promise<void>;
}

export interface ArkadiumPublisherPlatformOptions {
  readonly saveLimitBytes?: number;
}

export class ArkadiumPublisherPlatform implements PublisherPlatform {
  #bridge: ArkadiumSdkBridge;
  #capabilities: PlatformCapabilities;
  #guard = new LifecycleGuard();
  #lifecycleBusy = false;
  #saveLimitBytes: number;
  #subscriptions = new Set<() => void>();

  constructor(bridge: ArkadiumSdkBridge, options: ArkadiumPublisherPlatformOptions = {}) {
    this.#bridge = bridge;
    this.#capabilities = Object.freeze({ ...bridge.capabilities });
    this.#saveLimitBytes = options.saveLimitBytes ?? 512_000;
  }

  get capabilities(): PlatformCapabilities {
    return this.#capabilities;
  }

  async initialize(): Promise<Result<PlatformContext>> {
    if (this.#guard.state !== 'new') {
      return err('INVALID_LIFECYCLE', 'Platform can be initialized only once.', false);
    }
    try {
      const context = await this.#bridge.initialize();
      const transition = this.#guard.markInitialized();
      if (!transition.ok) return transition;
      this.#capabilities = Object.freeze({
        ...(context.capabilities ?? this.#bridge.capabilities),
      });
      return ok({
        userState: context.userState,
        locale: context.locale,
        capabilities: this.capabilities,
      });
    } catch {
      return sdkFailure();
    }
  }

  async signalReady(): Promise<Result<void>> {
    return this.#lifecycleTransition(
      'initialized',
      () => this.#bridge.lifecycle.ready(),
      () => this.#guard.markReady(),
    );
  }

  async signalGameStart(): Promise<Result<void>> {
    return this.#lifecycleTransition(
      'ready',
      () => this.#bridge.lifecycle.gameStart(),
      () => this.#guard.markGameStarted(),
    );
  }

  async signalScore(score: number): Promise<Result<void>> {
    if (!Number.isFinite(score)) return err('INVALID_ARGUMENT', 'Score must be finite.', false);
    return this.#gameplayCall(() => this.#bridge.lifecycle.score(score));
  }

  async signalLevelStart(levelId: string): Promise<Result<void>> {
    return this.#gameplayCall(() => this.#bridge.lifecycle.levelStart(levelId));
  }

  async signalLevelEnd(levelId: string): Promise<Result<void>> {
    return this.#gameplayCall(() => this.#bridge.lifecycle.levelEnd(levelId));
  }

  async signalGameEnd(reason: string): Promise<Result<void>> {
    return this.#lifecycleTransition(
      'started',
      () => this.#bridge.lifecycle.gameEnd(reason),
      () => this.#guard.markGameEnded(),
    );
  }

  onPause(handler: () => void): () => void {
    return this.#subscribe(this.#bridge.onPause, handler);
  }

  onResume(handler: () => void): () => void {
    return this.#subscribe(this.#bridge.onResume, handler);
  }

  async loadSave<T extends SerializableValue>(): Promise<Result<T | null>> {
    const capability = this.#requireCapability('persistence');
    if (!capability.ok) return capability;
    if (!this.#bridge.persistence) return this.#unsupported('persistence');
    try {
      const value = await this.#bridge.persistence.load();
      return ok(value === null ? null : (structuredClone(value) as T));
    } catch {
      return sdkFailure();
    }
  }

  async writeSave<T extends SerializableValue>(save: T): Promise<Result<void>> {
    const capability = this.#requireCapability('persistence');
    if (!capability.ok) return capability;
    if (!this.#bridge.persistence) return this.#unsupported('persistence');
    const valid = validateSavePayload(save, this.#saveLimitBytes);
    if (!valid.ok) return valid;
    try {
      await this.#bridge.persistence.save(structuredClone(save));
      return ok(undefined);
    } catch {
      return sdkFailure();
    }
  }

  async track(event: AnalyticsEvent): Promise<Result<void>> {
    const capability = this.#requireCapability('analytics');
    if (!capability.ok) return capability;
    if (!this.#bridge.analytics) return this.#unsupported('analytics');
    const sanitized: AnalyticsEvent = {
      name: event.name,
      ...(event.version === undefined ? {} : { version: event.version }),
      ...(event.properties === undefined
        ? {}
        : {
            properties: redactAnalyticsProperties(event.properties) as Readonly<
              Record<string, unknown>
            >,
          }),
    };
    try {
      await this.#bridge.analytics.track(sanitized);
      return ok(undefined);
    } catch {
      return sdkFailure();
    }
  }

  async showInterstitial(placement: string): Promise<Result<AdResult>> {
    const capability = this.#requireCapability('interstitialAds');
    if (!capability.ok) return capability;
    const operation = this.#bridge.advertising?.showInterstitial;
    if (!operation) return this.#unsupported('interstitialAds');
    try {
      return ok(await operation.call(this.#bridge.advertising, placement));
    } catch {
      return sdkFailure();
    }
  }

  async showRewarded(placement: string): Promise<Result<RewardedAdResult>> {
    const capability = this.#requireCapability('rewardedAds');
    if (!capability.ok) return capability;
    const operation = this.#bridge.advertising?.showRewarded;
    if (!operation) return this.#unsupported('rewardedAds');
    try {
      return ok(await operation.call(this.#bridge.advertising, placement));
    } catch {
      return sdkFailure();
    }
  }

  async getWalletBalance(): Promise<Result<number>> {
    const capability = this.#requireCapability('wallet');
    if (!capability.ok) return capability;
    if (!this.#bridge.wallet) return this.#unsupported('wallet');
    try {
      return ok(await this.#bridge.wallet.getBalance());
    } catch {
      return sdkFailure();
    }
  }

  async consumeCurrency(amount: number, transactionId: string): Promise<Result<WalletResult>> {
    const capability = this.#requireCapability('wallet');
    if (!capability.ok) return capability;
    if (!this.#bridge.wallet) return this.#unsupported('wallet');
    if (!Number.isSafeInteger(amount) || amount <= 0 || transactionId.length === 0) {
      return err('INVALID_ARGUMENT', 'Amount and transaction ID are invalid.', false);
    }
    try {
      return ok(await this.#bridge.wallet.consume(amount, transactionId));
    } catch {
      return sdkFailure();
    }
  }

  async submitLeaderboard(entry: LeaderboardSubmission): Promise<Result<void>> {
    const capability = this.#requireCapability('leaderboards');
    if (!capability.ok) return capability;
    if (!this.#bridge.leaderboards) return this.#unsupported('leaderboards');
    try {
      await this.#bridge.leaderboards.submit(structuredClone(entry));
      return ok(undefined);
    } catch {
      return sdkFailure();
    }
  }

  async destroy(): Promise<void> {
    if (this.#guard.state === 'destroyed') return;
    for (const unsubscribe of this.#subscriptions) unsubscribe();
    this.#subscriptions.clear();
    try {
      await this.#bridge.destroy?.();
    } finally {
      this.#guard.markDestroyed();
    }
  }

  async #gameplayCall(operation: () => Promise<void>): Promise<Result<void>> {
    const active = this.#guard.assertGameplayActive();
    if (!active.ok) return active;
    try {
      await operation();
      return ok(undefined);
    } catch {
      return sdkFailure();
    }
  }

  async #lifecycleTransition(
    expected: LifecycleState,
    operation: () => Promise<void>,
    commit: () => Result<void>,
  ): Promise<Result<void>> {
    const allowed = this.#guard.assertState(expected);
    if (!allowed.ok) return allowed;
    if (this.#lifecycleBusy) {
      return err('INVALID_LIFECYCLE', 'Another lifecycle transition is in progress.', true);
    }
    this.#lifecycleBusy = true;
    try {
      await operation();
      return commit();
    } catch {
      return sdkFailure();
    } finally {
      this.#lifecycleBusy = false;
    }
  }

  #subscribe(
    subscribe: ((handler: () => void) => () => void) | undefined,
    handler: () => void,
  ): () => void {
    if (this.#guard.state === 'destroyed' || !subscribe) return () => undefined;
    const upstream = subscribe.call(this.#bridge, handler);
    let active = true;
    const unsubscribe = () => {
      if (!active) return;
      active = false;
      this.#subscriptions.delete(unsubscribe);
      upstream();
    };
    this.#subscriptions.add(unsubscribe);
    return unsubscribe;
  }

  #requireCapability(capability: keyof PlatformCapabilities): Result<void> {
    if (this.#guard.state === 'destroyed') {
      return err('DESTROYED', 'Platform has been destroyed.', false);
    }
    if (this.#guard.state === 'new') {
      return err('NOT_INITIALIZED', 'Platform has not been initialized.', true);
    }
    if (!this.capabilities[capability]) return this.#unsupported(capability);
    return ok(undefined);
  }

  #unsupported(capability: keyof PlatformCapabilities): Result<never> {
    return err('UNSUPPORTED_CAPABILITY', `Capability ${capability} is unavailable.`, true);
  }
}

export {
  OFFICIAL_ARKADIUM_SDK_VERSION,
  createOfficialArkadiumSdkLoader,
  loadOfficialArkadiumSdk,
  type ArkadiumSdkEnvironment,
  type OfficialArkadiumSdk,
  type OfficialArkadiumSdkLoader,
  type OfficialArkadiumSdkModule,
} from './official-sdk.ts';

export {
  OfficialArkadiumSdkBridge,
  type OfficialArkadiumSdkBridgeOptions,
} from './OfficialArkadiumSdkBridge.ts';

export {
  ARKADIUM_REMOTE_SAVE_LIMIT_BYTES,
  ArkadiumPersistenceService,
  type ArkadiumPersistencePolicy,
  type ArkadiumPersistenceServiceOptions,
  type ArkadiumPersistenceStorage,
  type ArkadiumSaveEnvelope,
} from './ArkadiumPersistenceService.ts';

export {
  ArkadiumRpcDiagnostics,
  verifyArkadiumRpcDiagnosticEvidence,
  type ArkadiumRpcDiagnosticEnvironment,
  type ArkadiumRpcDiagnosticEvidence,
  type ArkadiumRpcDiagnosticsContext,
  type ArkadiumRpcDiagnosticsPolicy,
  type ArkadiumRpcEvidenceVerificationOptions,
  type ArkadiumRpcEvidenceVerificationResult,
  type ArkadiumRpcPhase,
  type ArkadiumRpcTargetState,
  type ArkadiumRpcTraceEvidence,
  type ArkadiumRpcTraceInput,
  type ArkadiumRpcViolation,
  type ArkadiumRpcViolationCode,
} from './ArkadiumRpcDiagnostics.ts';

export {
  ArkadiumAdvertisingService,
  type ArkadiumAdvertisingBackend,
  type ArkadiumAdPlacementPolicy,
  type ArkadiumInterstitialPlacement,
  type ArkadiumRewardedDataValue,
  type ArkadiumRewardedPlacement,
} from './ArkadiumAdvertisingService.ts';

export {
  arkadiumSerializableEqual,
  cloneArkadiumSerializable,
  isPlainArkadiumRecord,
} from './ArkadiumSerializable.ts';

export {
  ArkadiumAnalyticsService,
  type ArkadiumAnalyticsBackend,
  type ArkadiumAnalyticsEventRule,
  type ArkadiumAnalyticsPolicy,
  type ArkadiumAnalyticsPropertyRule,
  type ArkadiumAnalyticsPropertyType,
} from './ArkadiumAnalyticsService.ts';

export {
  ArkadiumLeaderboardService,
  type ArkadiumLeaderboardBackend,
  type ArkadiumLeaderboardPolicy,
} from './ArkadiumLeaderboardService.ts';

export {
  ArkadiumLocalWalletTransactionLedger,
  type ArkadiumLocalWalletTransactionLedgerOptions,
  type ArkadiumWalletLedgerStorage,
  type ArkadiumWalletRejectionReason,
  type ArkadiumWalletTransactionLedger,
  type ArkadiumWalletTransactionRecord,
  type ArkadiumWalletTransactionState,
} from './ArkadiumWalletTransactionLedger.ts';

export {
  ArkadiumWalletService,
  type ArkadiumWalletBackend,
  type ArkadiumWalletPolicy,
} from './ArkadiumWalletService.ts';
