import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import {
  createLocalTelemetryCaptureEvidence,
  validateLocalTelemetryCaptureOutput,
  validateLocalTelemetryCaptureUrl,
} from './local-telemetry-capture-lib.mjs';
import { ROOT } from './project-lib.mjs';

const BUILD_SHA = /^[0-9a-f]{40}$/;
const PAGE_TIMEOUT_MS = 60_000;
const MOVE_TIMEOUT_MS = 20_000;
const REQUIRED_CAPTURE_QUERY = 'seed=12345&telemetryEvidence=1';
const START_SELECTOR = 'button[data-action="start"]';
const PAUSE_SELECTOR = 'button[data-action="pause"]';
const RESUME_SELECTOR = 'button[data-action="resume"]';
let captureStage = 'arguments';

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) throw new Error(`${name} is required.`);
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const result = spawnSync('bash', ['-lc', [
    'command -v google-chrome',
    'command -v chromium',
    'command -v chromium-browser',
  ].join(' || ')], { encoding: 'utf8' });
  const value = result.status === 0 ? result.stdout.trim() : '';
  if (!value) throw new Error('A supported Chrome executable is unavailable.');
  return value;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function waitFor(label, operation, timeoutMs = PAGE_TIMEOUT_MS, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() <= deadline) {
    try {
      const value = await operation();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new Error(`${label} was not observed.${lastError ? ' The final probe failed.' : ''}`);
}

class CdpClient {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveConnection, rejectConnection) => {
      const timer = setTimeout(
        () => rejectConnection(new Error('Chrome DevTools connection timed out.')),
        15_000,
      );
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolveConnection();
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        rejectConnection(new Error('Chrome DevTools connection failed.'));
      }, { once: true });
    });
    return new CdpClient(socket);
  }

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener('message', (event) => this.#receive(event.data));
    socket.addEventListener('close', () => {
      for (const pending of this.#pending.values()) {
        pending.reject(new Error('Chrome DevTools connection closed.'));
      }
      this.#pending.clear();
    });
  }

  on(method, listener) {
    const listeners = this.#listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  send(method, params = {}) {
    const id = this.#nextId++;
    const promise = new Promise((resolveCommand, rejectCommand) => {
      this.#pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
    });
    this.#socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  async evaluate(expression, { awaitPromise = false } = {}) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) throw new Error('Local telemetry browser evaluation failed.');
    return response.result?.value;
  }

  close() {
    this.#socket.close();
  }

  #receive(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.id) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error('Chrome DevTools command failed.'));
      else pending.resolve(message.result ?? {});
      return;
    }
    const listeners = this.#listeners.get(message.method);
    if (!listeners) return;
    for (const listener of listeners) listener(message.params ?? {});
  }
}

async function launchChrome(launchUrl) {
  const userDataDir = await mkdtemp(join(tmpdir(), 'canyon-telemetry-chrome-'));
  const chrome = spawn(findChrome(), [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--window-size=1280,720',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    launchUrl,
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  const activePort = await waitFor('Chrome DevTools port', async () => {
    try {
      return (await readFile(join(userDataDir, 'DevToolsActivePort'), 'utf8')).trim();
    } catch {
      if (chrome.exitCode !== null) throw new Error('Chrome exited before DevTools became ready.');
      return null;
    }
  }, 20_000);
  const [port] = activePort.split(/\r?\n/);
  if (!/^\d+$/.test(port)) throw new Error('Chrome DevTools port is invalid.');

  const target = await waitFor('local telemetry page target', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { cache: 'no-store' });
    if (!response.ok) return null;
    const targets = await response.json();
    return targets.find((value) => value.type === 'page' && value.webSocketDebuggerUrl) ?? null;
  }, 20_000);

  return Object.freeze({
    target,
    async close() {
      if (chrome.exitCode === null) chrome.kill('SIGTERM');
      await new Promise((resolveClose) => {
        if (chrome.exitCode !== null) return resolveClose();
        const timer = setTimeout(() => {
          chrome.kill('SIGKILL');
          resolveClose();
        }, 5_000);
        chrome.once('exit', () => {
          clearTimeout(timer);
          resolveClose();
        });
      });
      await rm(userDataDir, { recursive: true, force: true });
    },
  });
}

async function clickSelector(client, selector) {
  const clicked = await client.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!(node instanceof HTMLButtonElement)) return false;
    node.click();
    return true;
  })()`);
  if (clicked !== true) throw new Error('Required local telemetry control was not found.');
}

async function readDriverSnapshot(client) {
  return client.evaluate('globalThis.__CANYON_SANDBOX_DRIVER__.snapshot()');
}

async function dispatchClick(client, point) {
  if (!point
    || !Number.isFinite(point.x)
    || !Number.isFinite(point.y)
    || point.x < 0
    || point.y < 0
    || point.x > 10_000
    || point.y > 10_000) {
    throw new Error('Local telemetry game coordinates are invalid.');
  }
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
}

function requestKind(value) {
  if (typeof value !== 'string') return Object.freeze({ official: false, gameEvent: false });
  let url;
  try {
    url = new URL(value);
  } catch {
    return Object.freeze({ official: false, gameEvent: false });
  }
  return Object.freeze({
    official: /(?:arkadium-sdk|official-platform)/i.test(url.pathname),
    gameEvent: url.pathname === '/v1/game-events',
  });
}

async function capture() {
  captureStage = 'arguments';
  const launchUrl = validateLocalTelemetryCaptureUrl(option('--url'));
  if (!launchUrl.includes(REQUIRED_CAPTURE_QUERY)) {
    throw new Error('Local telemetry capture query is invalid.');
  }
  const expectedBuildSha = option('--expected-build-sha');
  if (!BUILD_SHA.test(expectedBuildSha)) {
    throw new Error('Expected local telemetry build SHA is invalid.');
  }
  const output = validateLocalTelemetryCaptureOutput(ROOT, option('--output'));

  captureStage = 'launch';
  const browser = await launchChrome(launchUrl);
  let client = null;

  try {
    captureStage = 'connect';
    client = await CdpClient.connect(browser.target.webSocketDebuggerUrl);
    let officialRuntimeRequests = 0;
    let gameEventPostCount = 0;
    let consoleErrorCount = 0;

    client.on('Network.requestWillBeSent', ({ request } = {}) => {
      const kind = requestKind(request?.url);
      if (kind.official) officialRuntimeRequests += 1;
      if (kind.gameEvent && request?.method === 'POST') gameEventPostCount += 1;
    });
    client.on('Runtime.exceptionThrown', () => {
      consoleErrorCount += 1;
    });
    client.on('Runtime.consoleAPICalled', ({ type } = {}) => {
      if (type === 'error' || type === 'assert') consoleErrorCount += 1;
    });

    captureStage = 'domains';
    await Promise.all([
      client.send('Page.enable'),
      client.send('Runtime.enable'),
      client.send('Network.enable'),
    ]);

    captureStage = 'browser-apis';
    await waitFor('local telemetry browser APIs', async () => client.evaluate(`(() => (
      typeof globalThis.__CANYON_TELEMETRY_EVIDENCE__ === 'function'
      && typeof globalThis.__CANYON_SANDBOX_DRIVER__ === 'object'
      && document.documentElement.dataset.runtimeMode === 'standalone'
      && document.documentElement.dataset.runtimeBuildSha === ${JSON.stringify(expectedBuildSha)}
      && document.querySelector('[data-role="boot-error"]')?.hidden === true
    ))()`));

    captureStage = 'start';
    await clickSelector(client, START_SELECTOR);
    const beforeMove = await waitFor('playing telemetry driver', async () => {
      const value = await readDriverSnapshot(client);
      return value?.mode === 'playing' && value?.status === 'playing' ? value : null;
    });

    captureStage = 'move';
    const move = await client.evaluate(
      'globalThis.__CANYON_SANDBOX_DRIVER__.nextMove()',
    );
    if (!move?.first || !move?.second) {
      throw new Error('Local telemetry driver did not return a legal move.');
    }
    await dispatchClick(client, move.first);
    await dispatchClick(client, move.second);
    const afterMove = await waitFor('local telemetry move resolution', async () => {
      const value = await readDriverSnapshot(client);
      return value?.moves < beforeMove.moves || value?.score > beforeMove.score
        ? value
        : null;
    }, MOVE_TIMEOUT_MS);

    captureStage = 'pause';
    await clickSelector(client, PAUSE_SELECTOR);
    const paused = await waitFor('local telemetry pause', async () => {
      const value = await readDriverSnapshot(client);
      return value?.mode === 'paused' ? true : null;
    });

    captureStage = 'resume';
    await clickSelector(client, RESUME_SELECTOR);
    const resumed = await waitFor('local telemetry resume', async () => {
      const value = await readDriverSnapshot(client);
      return value?.mode === 'playing' ? true : null;
    });

    captureStage = 'delivery';
    const telemetry = await waitFor('delivered local telemetry evidence', async () => {
      const value = await client.evaluate(
        'globalThis.__CANYON_TELEMETRY_EVIDENCE__()',
      );
      return value?.buildSha === expectedBuildSha
        && value?.platformMode === 'standalone'
        && value?.sdkVersion === null
        && value?.phase === 'playing'
        && value?.queueCount === 0
        && value?.droppedCount === 0
        && value?.inFlight === false
        && value?.lastDelivery?.outcome === 'delivered'
        && value?.lastDelivery?.httpStatus === 202
        ? value
        : null;
    });
    const title = await client.evaluate('document.title');

    captureStage = 'evidence';
    const evidence = createLocalTelemetryCaptureEvidence({
      capturedAt: new Date().toISOString(),
      expectedBuildSha,
      title,
      telemetry,
      beforeMove,
      afterMove,
      paused,
      resumed,
      officialRuntimeRequests,
      gameEventPostCount,
      consoleErrorCount,
    });

    captureStage = 'write';
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    captureStage = 'complete';
    console.log(JSON.stringify({
      source: evidence.source,
      buildSha: evidence.expectedBuildSha,
      sessionId: evidence.telemetry.sessionId,
      eventCount: evidence.telemetry.eventCount,
    }));
  } finally {
    client?.close();
    await browser.close();
  }
}

try {
  await capture();
} catch {
  console.error(`Local telemetry browser capture failed at ${captureStage}.`);
  process.exit(1);
}
