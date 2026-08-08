const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms));

export function createPlatformBridge({ globalObject = window, timeoutMs = 1200 } = {}) {
  let sdk = null;
  return {
    async connect() {
      const candidate = globalObject.arkadium ?? globalObject.ArkadiumGameSDK ?? null;
      sdk = await Promise.race([Promise.resolve(candidate), timeout(timeoutMs)]).catch(() => null);
      return sdk ? 'arkadium' : 'standalone';
    },
    async signal(name, payload = {}) {
      try {
        const method = sdk?.[name];
        if (typeof method === 'function') await method.call(sdk, payload);
      } catch {
        // Platform calls are best effort and never block standalone play.
      }
    },
  };
}
