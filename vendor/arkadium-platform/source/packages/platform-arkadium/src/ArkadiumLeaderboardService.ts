import type { LeaderboardSubmission, UserState } from '../../platform-contract/src/index.ts';

import type { OfficialArkadiumSdk } from './official-sdk.ts';

export type ArkadiumLeaderboardBackend = Pick<
  OfficialArkadiumSdk['leaderboard'],
  'isSupported' | 'postScore'
>;

export interface ArkadiumLeaderboardPolicy {
  readonly defaultBoard: string;
}

const BOARD_PATTERN = /^[a-z][a-z0-9.-]{1,63}$/;
const MUTABLE_BOARD_ALIAS = /^(?:current|latest|main|preview|staging|test)$/;

export class ArkadiumLeaderboardService {
  #backend: ArkadiumLeaderboardBackend;
  #userState: UserState;
  #defaultBoard: string;
  #state: 'new' | 'initialized' | 'failed' = 'new';
  #supported = false;

  constructor(
    backend: ArkadiumLeaderboardBackend,
    userState: UserState,
    policy: ArkadiumLeaderboardPolicy,
  ) {
    const defaultBoard = policy.defaultBoard;
    if (
      typeof defaultBoard !== 'string' ||
      defaultBoard !== defaultBoard.trim() ||
      !BOARD_PATTERN.test(defaultBoard) ||
      MUTABLE_BOARD_ALIAS.test(defaultBoard)
    ) {
      throw new Error('Arkadium leaderboard default board is invalid.');
    }
    this.#backend = backend;
    this.#userState = userState;
    this.#defaultBoard = defaultBoard;
  }

  get isSupported(): boolean {
    return this.#state === 'initialized' && this.#supported;
  }

  async initialize(): Promise<void> {
    if (this.#state === 'initialized') return;
    if (this.#state === 'failed') {
      throw new Error('Arkadium leaderboard initialization previously failed.');
    }
    if (this.#userState === 'anonymous') {
      this.#state = 'initialized';
      this.#supported = false;
      return;
    }

    try {
      this.#supported = await this.#backend.isSupported();
      this.#state = 'initialized';
    } catch {
      this.#state = 'failed';
      throw new Error('Unable to determine Arkadium leaderboard support.');
    }
  }

  async submit(entry: LeaderboardSubmission): Promise<void> {
    if (this.#state !== 'initialized' || !this.#supported) {
      throw new Error('Arkadium leaderboard is not supported.');
    }
    if (entry.board !== this.#defaultBoard) {
      throw new Error('Arkadium leaderboard submission must use the configured default board.');
    }
    if (entry.metadata !== undefined) {
      throw new Error('Arkadium leaderboard metadata is not supported by SDK 2.66.2.');
    }
    if (!Number.isSafeInteger(entry.score) || entry.score < 0) {
      throw new Error('Arkadium leaderboard score must be a non-negative safe integer.');
    }

    try {
      await this.#backend.postScore(entry.score);
    } catch {
      throw new Error('Unable to submit Arkadium leaderboard score.');
    }
  }
}
