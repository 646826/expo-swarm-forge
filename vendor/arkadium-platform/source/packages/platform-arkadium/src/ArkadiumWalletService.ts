import type { UserState, WalletResult } from '../../platform-contract/src/index.ts';

import type { OfficialArkadiumSdk } from './official-sdk.ts';
import type {
  ArkadiumWalletTransactionLedger,
  ArkadiumWalletTransactionRecord,
} from './ArkadiumWalletTransactionLedger.ts';

export interface ArkadiumWalletPolicy {
  readonly ledgerKeyPrefix: string;
  readonly ledgerMaxRecordBytes?: number;
}

export interface ArkadiumWalletBackend extends Pick<
  OfficialArkadiumSdk['wallet'],
  'getGems' | 'consumeGems'
> {
  readonly isGemsSupported?: () => Promise<boolean>;
}

const TRANSACTION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export class ArkadiumWalletService {
  #backend: ArkadiumWalletBackend;
  #userState: UserState;
  #ledger: ArkadiumWalletTransactionLedger;
  #state: 'new' | 'initialized' | 'failed' = 'new';
  #supported = false;

  constructor(
    backend: ArkadiumWalletBackend,
    userState: UserState,
    ledger: ArkadiumWalletTransactionLedger,
  ) {
    this.#backend = backend;
    this.#userState = userState;
    this.#ledger = ledger;
  }

  get isSupported(): boolean {
    return this.#state === 'initialized' && this.#supported;
  }

  async initialize(): Promise<void> {
    if (this.#state === 'initialized') return;
    if (this.#state === 'failed') {
      throw new Error('Arkadium wallet initialization previously failed.');
    }
    if (this.#userState === 'anonymous') {
      this.#supported = false;
      this.#state = 'initialized';
      return;
    }

    const supportProbe = this.#backend.isGemsSupported;
    if (!supportProbe) {
      this.#supported = false;
      this.#state = 'initialized';
      return;
    }

    try {
      this.#supported = await supportProbe.call(this.#backend);
      this.#state = 'initialized';
    } catch {
      this.#state = 'failed';
      throw new Error('Unable to determine Arkadium Gems support.');
    }
  }

  async getBalance(): Promise<number> {
    this.#requireSupported();
    let balance: number;
    try {
      balance = await this.#backend.getGems();
    } catch {
      throw new Error('Unable to read Arkadium Gems balance.');
    }
    if (!Number.isSafeInteger(balance) || balance < 0) {
      throw new Error('Arkadium Gems balance must be a non-negative safe integer.');
    }
    return balance;
  }

  async consume(amount: number, transactionId: string): Promise<WalletResult> {
    this.#requireSupported();
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error('Arkadium Gems amount must be a positive safe integer.');
    }
    if (
      typeof transactionId !== 'string' ||
      transactionId !== transactionId.trim() ||
      !TRANSACTION_ID_PATTERN.test(transactionId)
    ) {
      throw new Error('Arkadium wallet transaction ID is invalid.');
    }

    const transactionHash = await this.hashTransactionId(transactionId);
    const existing = await this.#readLedger(transactionHash);
    if (existing) return this.#replay(existing, amount);

    await this.#writeLedger({
      recordVersion: 1,
      transactionHash,
      amount,
      state: 'pending',
    });

    let accepted: boolean;
    try {
      accepted = await this.#backend.consumeGems(amount);
    } catch {
      throw new Error(
        'Unable to consume Arkadium Gems; transaction remains pending and ambiguous.',
      );
    }

    if (!accepted) {
      await this.#writeLedger({
        recordVersion: 1,
        transactionHash,
        amount,
        state: 'rejected',
        reason: 'not-accepted',
      });
      throw new Error('Arkadium Gems transaction was not accepted.');
    }

    const balance = await this.getBalance();
    await this.#writeLedger({
      recordVersion: 1,
      transactionHash,
      amount,
      state: 'applied',
      balance,
    });
    return { balance };
  }

  async hashTransactionId(transactionId: string): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error('Secure transaction hashing is unavailable.');
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(transactionId));
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  async #readLedger(transactionHash: string): Promise<ArkadiumWalletTransactionRecord | null> {
    try {
      return await this.#ledger.read(transactionHash);
    } catch {
      throw new Error('Unable to read Arkadium wallet transaction ledger.');
    }
  }

  async #writeLedger(record: ArkadiumWalletTransactionRecord): Promise<void> {
    try {
      await this.#ledger.write(record);
    } catch {
      throw new Error('Unable to write Arkadium wallet transaction ledger.');
    }
  }

  #replay(record: ArkadiumWalletTransactionRecord, amount: number): WalletResult {
    if (record.amount !== amount) {
      throw new Error('Arkadium wallet transaction amount does not match the existing record.');
    }
    if (record.state === 'applied') return { balance: record.balance! };
    if (record.state === 'rejected') {
      throw new Error('Arkadium wallet transaction was previously rejected and not accepted.');
    }
    throw new Error(
      'Arkadium wallet transaction is pending and ambiguous; automatic replay is forbidden.',
    );
  }

  #requireSupported(): void {
    if (this.#state !== 'initialized' || !this.#supported) {
      throw new Error('Arkadium Gems wallet is not supported.');
    }
  }
}
