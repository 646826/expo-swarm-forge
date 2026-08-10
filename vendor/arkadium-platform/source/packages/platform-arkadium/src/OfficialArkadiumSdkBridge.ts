import type { PlatformCapabilities, UserState } from '../../platform-contract/src/index.ts';

import type { ArkadiumBridgeContext, ArkadiumSdkBridge } from './index.ts';
import {
  ArkadiumAnalyticsService,
  type ArkadiumAnalyticsPolicy,
} from './ArkadiumAnalyticsService.ts';
import {
  ArkadiumAdvertisingService,
  type ArkadiumAdPlacementPolicy,
} from './ArkadiumAdvertisingService.ts';
import {
  ArkadiumLeaderboardService,
  type ArkadiumLeaderboardPolicy,
} from './ArkadiumLeaderboardService.ts';
import {
  ArkadiumPersistenceService,
  type ArkadiumPersistencePolicy,
} from './ArkadiumPersistenceService.ts';
import { ArkadiumLocalWalletTransactionLedger } from './ArkadiumWalletTransactionLedger.ts';
import { ArkadiumWalletService, type ArkadiumWalletPolicy } from './ArkadiumWalletService.ts';
import {
  ArkadiumRpcDiagnostics,
  type ArkadiumRpcDiagnosticsPolicy,
} from './ArkadiumRpcDiagnostics.ts';
import {
  OFFICIAL_ARKADIUM_SDK_VERSION,
  loadOfficialArkadiumSdk,
  type ArkadiumSdkEnvironment,
  type OfficialArkadiumSdk,
  type OfficialArkadiumSdkLoader,
} from './official-sdk.ts';

const NO_CAPABILITIES: PlatformCapabilities = Object.freeze({
  persistence: false,
  analytics: false,
  interstitialAds: false,
  rewardedAds: false,
  wallet: false,
  leaderboards: false,
});

export interface OfficialArkadiumSdkBridgeOptions {
  readonly environment: ArkadiumSdkEnvironment;
  readonly fallbackLocale?: string;
  readonly levelNumberForId?: (levelId: string) => number;
  readonly loader?: OfficialArkadiumSdkLoader;
  readonly persistencePolicy?: ArkadiumPersistencePolicy;
  readonly persistenceSaveLimitBytes?: number;
  readonly advertisingPolicy?: ArkadiumAdPlacementPolicy;
  readonly analyticsPolicy?: ArkadiumAnalyticsPolicy;
  readonly leaderboardPolicy?: ArkadiumLeaderboardPolicy;
  readonly walletPolicy?: ArkadiumWalletPolicy;
  readonly rpcDiagnosticsPolicy?: ArkadiumRpcDiagnosticsPolicy;
}

type BridgeState = 'new' | 'initializing' | 'initialized' | 'failed' | 'destroyed';

export class OfficialArkadiumSdkBridge implements ArkadiumSdkBridge {
  readonly persistence?: NonNullable<ArkadiumSdkBridge['persistence']>;
  readonly advertising?: NonNullable<ArkadiumSdkBridge['advertising']>;
  readonly analytics?: NonNullable<ArkadiumSdkBridge['analytics']>;
  readonly leaderboards?: NonNullable<ArkadiumSdkBridge['leaderboards']>;
  readonly wallet?: NonNullable<ArkadiumSdkBridge['wallet']>;

  readonly lifecycle = {
    ready: async () => this.#requireSdk().lifecycle.onTestReady(),
    gameStart: async () => this.#requireSdk().lifecycle.onGameStart(),
    score: async (value: number) => this.#requireSdk().lifecycle.onChangeScore(value),
    levelStart: async (levelId: string) =>
      this.#requireSdk().lifecycle.onLevelStart(this.#resolveLevelNumber(levelId)),
    levelEnd: async (levelId: string) =>
      this.#requireSdk().lifecycle.onLevelEnd(this.#resolveLevelNumber(levelId)),
    gameEnd: async () => this.#requireSdk().lifecycle.onGameEnd(),
  };

  #capabilities: PlatformCapabilities = NO_CAPABILITIES;
  #environment: ArkadiumSdkEnvironment;
  #fallbackLocale: string | undefined;
  #levelNumberForId: ((levelId: string) => number) | undefined;
  #loader: OfficialArkadiumSdkLoader;
  #persistencePolicy: ArkadiumPersistencePolicy | undefined;
  #persistenceSaveLimitBytes: number | undefined;
  #persistenceService: ArkadiumPersistenceService | undefined;
  #advertisingPolicy: ArkadiumAdPlacementPolicy | undefined;
  #advertisingService: ArkadiumAdvertisingService | undefined;
  #analyticsPolicy: ArkadiumAnalyticsPolicy | undefined;
  #analyticsService: ArkadiumAnalyticsService | undefined;
  #leaderboardPolicy: ArkadiumLeaderboardPolicy | undefined;
  #leaderboardService: ArkadiumLeaderboardService | undefined;
  #walletPolicy: ArkadiumWalletPolicy | undefined;
  #walletService: ArkadiumWalletService | undefined;
  #rpcDiagnostics: ArkadiumRpcDiagnostics | undefined;
  #sdk: OfficialArkadiumSdk | undefined;
  #state: BridgeState = 'new';
  #pauseHandlers = new Set<() => void>();
  #resumeHandlers = new Set<() => void>();

  constructor(options: OfficialArkadiumSdkBridgeOptions) {
    this.#environment = options.environment;
    this.#fallbackLocale = options.fallbackLocale;
    this.#levelNumberForId = options.levelNumberForId;
    this.#loader = options.loader ?? loadOfficialArkadiumSdk;
    this.#persistencePolicy = options.persistencePolicy;
    this.#persistenceSaveLimitBytes = options.persistenceSaveLimitBytes;
    this.#advertisingPolicy = options.advertisingPolicy;
    this.#analyticsPolicy = options.analyticsPolicy;
    this.#leaderboardPolicy = options.leaderboardPolicy;
    this.#walletPolicy = options.walletPolicy;
    this.#rpcDiagnostics = options.rpcDiagnosticsPolicy
      ? new ArkadiumRpcDiagnostics(options.rpcDiagnosticsPolicy, {
          environment: options.environment,
          sdkVersion: OFFICIAL_ARKADIUM_SDK_VERSION,
        })
      : undefined;

    if (options.persistencePolicy) {
      this.persistence = {
        load: async () => this.#requirePersistence().load(),
        save: async (value) => this.#requirePersistence().save(value),
      };
    }
    if (options.advertisingPolicy) {
      this.advertising = {
        showInterstitial: async (placement) =>
          this.#requireAdvertising().showInterstitial(placement),
        showRewarded: async (placement) => this.#requireAdvertising().showRewarded(placement),
      };
    }
    if (options.analyticsPolicy) {
      this.analytics = {
        track: async (event) => this.#requireAnalytics().track(event),
      };
    }
    if (options.leaderboardPolicy) {
      this.leaderboards = {
        submit: async (entry) => this.#requireLeaderboard().submit(entry),
      };
    }
    if (options.walletPolicy) {
      this.wallet = {
        getBalance: async () => this.#requireWallet().getBalance(),
        consume: async (amount, transactionId) =>
          this.#requireWallet().consume(amount, transactionId),
      };
    }
  }

  get capabilities(): PlatformCapabilities {
    return this.#capabilities;
  }

  get rpcDiagnostics(): ArkadiumRpcDiagnostics | undefined {
    return this.#rpcDiagnostics;
  }

  async initialize(): Promise<ArkadiumBridgeContext> {
    if (this.#state !== 'new') {
      throw new Error('Official Arkadium SDK bridge can be initialized only once.');
    }

    this.#state = 'initializing';
    try {
      const sdk = await this.#loader(this.#environment);
      this.#sdk = sdk;
      if (this.#rpcDiagnostics) {
        await this.#rpcDiagnostics.activate((enabled) => sdk.debugMode(enabled));
      }
      const [details, userState] = await Promise.all([
        sdk.host.getDetails(),
        this.#classifyUserState(sdk),
      ]);
      const locale = this.#selectLocale(details.activeLocale);

      if (this.#persistencePolicy) {
        this.#persistenceService = new ArkadiumPersistenceService(
          sdk.persistence,
          userState,
          this.#persistencePolicy,
          this.#persistenceSaveLimitBytes === undefined
            ? {}
            : { saveLimitBytes: this.#persistenceSaveLimitBytes },
        );
      }
      if (this.#advertisingPolicy) {
        this.#advertisingService = new ArkadiumAdvertisingService(
          sdk.ads,
          userState,
          this.#advertisingPolicy,
        );
      }
      if (this.#analyticsPolicy) {
        this.#analyticsService = new ArkadiumAnalyticsService(sdk.analytics, this.#analyticsPolicy);
        await this.#analyticsService.initialize();
      }
      if (this.#leaderboardPolicy) {
        this.#leaderboardService = new ArkadiumLeaderboardService(
          sdk.leaderboard,
          userState,
          this.#leaderboardPolicy,
        );
        await this.#leaderboardService.initialize();
      }
      if (this.#walletPolicy) {
        const ledger = new ArkadiumLocalWalletTransactionLedger(sdk.persistence, {
          keyPrefix: this.#walletPolicy.ledgerKeyPrefix,
          ...(this.#walletPolicy.ledgerMaxRecordBytes === undefined
            ? {}
            : { maxRecordBytes: this.#walletPolicy.ledgerMaxRecordBytes }),
        });
        this.#walletService = new ArkadiumWalletService(sdk.wallet, userState, ledger);
        await this.#walletService.initialize();
      }
      this.#capabilities = Object.freeze({
        ...NO_CAPABILITIES,
        persistence: this.#persistenceService !== undefined,
        analytics: this.#analyticsService?.isInitialized ?? false,
        leaderboards: this.#leaderboardService?.isSupported ?? false,
        wallet: this.#walletService?.isSupported ?? false,
        interstitialAds: this.#advertisingService?.supportsInterstitial ?? false,
        rewardedAds: this.#advertisingService?.supportsRewarded ?? false,
      });
      this.#registerHostLifecycleCallbacks(sdk);
      this.#state = 'initialized';

      return {
        userState,
        locale,
        capabilities: this.capabilities,
      };
    } catch (error) {
      if (this.#rpcDiagnostics?.isActive && this.#sdk) {
        try {
          await this.#rpcDiagnostics.deactivate((enabled) => this.#sdk!.debugMode(enabled));
        } catch {
          // Preserve the original initialization failure while leaving no sensitive SDK details.
        }
      }
      this.#sdk = undefined;
      this.#persistenceService = undefined;
      this.#advertisingService = undefined;
      this.#analyticsService = undefined;
      this.#leaderboardService = undefined;
      this.#walletService = undefined;
      this.#capabilities = NO_CAPABILITIES;
      this.#state = 'failed';
      throw error;
    }
  }

  onPause(handler: () => void): () => void {
    return this.#subscribe(this.#pauseHandlers, handler);
  }

  onResume(handler: () => void): () => void {
    return this.#subscribe(this.#resumeHandlers, handler);
  }

  async destroy(): Promise<void> {
    if (this.#state === 'destroyed') return;
    const sdk = this.#sdk;
    this.#state = 'destroyed';
    try {
      if (sdk && this.#rpcDiagnostics?.isActive) {
        await this.#rpcDiagnostics.deactivate((enabled) => sdk.debugMode(enabled));
      }
    } finally {
      this.#sdk = undefined;
      this.#persistenceService = undefined;
      this.#advertisingService = undefined;
      this.#analyticsService = undefined;
      this.#leaderboardService = undefined;
      this.#walletService = undefined;
      this.#capabilities = NO_CAPABILITIES;
      this.#pauseHandlers.clear();
      this.#resumeHandlers.clear();
    }
  }

  async #classifyUserState(sdk: OfficialArkadiumSdk): Promise<UserState> {
    if (!(await sdk.host.isAuthSupported())) return 'anonymous';
    if (!(await sdk.auth.isUserAuthorized())) return 'anonymous';
    const profile = await sdk.auth.getUserProfile();
    return profile?.isUserSubscriber === true ? 'subscriber' : 'registered';
  }

  #selectLocale(activeLocale: string): string {
    const hostLocale = activeLocale.trim();
    if (hostLocale.length > 0) return hostLocale;

    const fallback = this.#fallbackLocale?.trim() ?? '';
    if (fallback.length > 0) return fallback;
    throw new Error('Arkadium host must provide a non-empty locale or explicit fallback.');
  }

  #resolveLevelNumber(levelId: string): number {
    const value = this.#levelNumberForId
      ? this.#levelNumberForId(levelId)
      : /^[1-9]\d*$/.test(levelId)
        ? Number(levelId)
        : Number.NaN;

    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error('Arkadium level mapping must return a positive safe integer.');
    }
    return value;
  }

  #registerHostLifecycleCallbacks(sdk: OfficialArkadiumSdk): void {
    sdk.lifecycle.registerEventCallback(sdk.lifecycle.LifecycleEvent.GAME_PAUSE, () => {
      this.#dispatch(this.#pauseHandlers);
    });
    sdk.lifecycle.registerEventCallback(sdk.lifecycle.LifecycleEvent.GAME_RESUME, () => {
      this.#dispatch(this.#resumeHandlers);
    });
  }

  #dispatch(handlers: ReadonlySet<() => void>): void {
    if (this.#state !== 'initialized') return;
    for (const handler of [...handlers]) handler();
  }

  #subscribe(handlers: Set<() => void>, handler: () => void): () => void {
    if (this.#state === 'destroyed' || this.#state === 'failed') return () => undefined;
    handlers.add(handler);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      handlers.delete(handler);
    };
  }

  #requirePersistence(): ArkadiumPersistenceService {
    if (this.#state !== 'initialized' || !this.#persistenceService) {
      throw new Error('Official Arkadium persistence is not initialized.');
    }
    return this.#persistenceService;
  }

  #requireAdvertising(): ArkadiumAdvertisingService {
    if (this.#state !== 'initialized' || !this.#advertisingService) {
      throw new Error('Official Arkadium advertising is not initialized.');
    }
    return this.#advertisingService;
  }

  #requireAnalytics(): ArkadiumAnalyticsService {
    if (this.#state !== 'initialized' || !this.#analyticsService?.isInitialized) {
      throw new Error('Official Arkadium analytics is not initialized.');
    }
    return this.#analyticsService;
  }

  #requireLeaderboard(): ArkadiumLeaderboardService {
    if (this.#state !== 'initialized' || !this.#leaderboardService?.isSupported) {
      throw new Error('Official Arkadium leaderboard is not initialized or supported.');
    }
    return this.#leaderboardService;
  }

  #requireWallet(): ArkadiumWalletService {
    if (this.#state !== 'initialized' || !this.#walletService?.isSupported) {
      throw new Error('Official Arkadium wallet is not initialized or supported.');
    }
    return this.#walletService;
  }

  #requireSdk(): OfficialArkadiumSdk {
    if (this.#state !== 'initialized' || !this.#sdk) {
      throw new Error('Official Arkadium SDK bridge is not initialized.');
    }
    return this.#sdk;
  }
}
