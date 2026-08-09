import { err, ok } from './result.js';

export class LifecycleGuard {
  #state = 'new';

  get state() {
    return this.#state;
  }

  assertState(...allowed) {
    if (this.#state === 'destroyed') {
      return err('DESTROYED', 'Platform has been destroyed.', false);
    }
    if (!allowed.includes(this.#state)) {
      return err(
        'INVALID_LIFECYCLE',
        `Lifecycle state ${this.#state} is not valid for this operation.`,
        false,
      );
    }
    return ok(undefined);
  }

  markInitialized() {
    return this.#transition(['new'], 'initialized');
  }

  markReady() {
    return this.#transition(['initialized'], 'ready');
  }

  markGameStarted() {
    return this.#transition(['ready'], 'started');
  }

  markGameEnded() {
    return this.#transition(['started'], 'ended');
  }

  assertGameplayActive() {
    return this.assertState('started');
  }

  markDestroyed() {
    if (this.#state === 'destroyed') {
      return err('DESTROYED', 'Platform has already been destroyed.', false);
    }
    this.#state = 'destroyed';
    return ok(undefined);
  }

  #transition(allowed, next) {
    const current = this.assertState(...allowed);
    if (!current.ok) return current;
    this.#state = next;
    return ok(undefined);
  }
}
