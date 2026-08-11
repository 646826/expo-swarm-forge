import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { verifySandboxEvidenceBundle } from './arkadium-sandbox-evidence-lib.mjs';

const EXPECTED_SDK_VERSION = '2.66.2';
const BUILD_SHA = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTOMATION_KEYS = Object.freeze([
  'launchUrlTemplate',
  'gameFrameSelector',
  'pauseSelector',
  'resumeSelector',
  'rpcDiagnosticsUrl',
]);
const MAX_AUTOMATION_BYTES = 16_384;
const MAX_CONSOLE_RECORDS = 512;
const PAGE_TIMEOUT_MS = 90_000;
const GAME_TIMEOUT_MS = 180_000;
const MAX_GAME_MOVES = 64;

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function safeUrl(value, label, { allowTemplate = false } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_096) {
    throw new Error(`${label} is invalid.`);
  }
  const placeholder = '{{PREVIEW_URL}}';
  const candidate = allowTemplate ? value.replaceAll(placeholder, 'https%3A%2F%2Fexample.invalid%2F') : value;
  if (allowTemplate && !value.includes(placeholder)) throw new Error(`${label} is invalid.`);
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`${label} is invalid.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function safeSelector(value, label) {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > 512
    || /[\r\n\0]/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function parseAutomationConfig(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_AUTOMATION_BYTES) {
    throw new Error('Sandbox automation configuration is invalid.');
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('Sandbox automation configuration is invalid.');
  }
  if (!exactKeys(value, AUTOMATION_KEYS)) {
    throw new Error('Sandbox automation configuration is invalid.');
  }
  const launchUrlTemplate = safeUrl(value.launchUrlTemplate, 'Sandbox launch URL template', {
    allowTemplate: true,
  });
  const rpcDiagnosticsUrl = safeUrl(value.rpcDiagnosticsUrl, 'Sandbox RPC diagnostics URL');
  return Object.freeze({
    launchUrlTemplate,
    gameFrameSelector: safeSelector(value.gameFrameSelector, 'Sandbox game frame selector'),
    pauseSelector: safeSelector(value.pauseSelector, 'Sandbox pause selector'),
    resumeSelector: safeSelector(value.resumeSelector, 'Sandbox resume selector'),
    rpcDiagnosticsUrl,
  });
}

function validatePreviewUrl(value, candidateSha) {
  const source = safeUrl(value, 'Candidate preview URL');
  const url = new URL(source);
  if (url.search || !url.pathname.includes(`/sandbox-candidates/${candidateSha}/`)) {
    throw new Error('Candidate preview URL is invalid.');
  }
  return url.href;
}

function createLaunchUrl(template, previewUrl) {
  const value = template.replaceAll('{{PREVIEW_URL}}', encodeURIComponent(previewUrl));
  safeUrl(value, 'Sandbox launch URL');
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

async function waitFor(label, operation, timeoutMs = PAGE_TIMEOUT_MS, intervalMs = 250) {
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

  async evaluate(expression, contextId, { awaitPromise = true } = {}) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      contextId,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) throw new Error('Sandbox browser evaluation failed.');
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

function structuralConsoleRecord(kind, level, text) {
  const source = typeof text === 'string' ? text : '';
  return Object.freeze({
    observedAtMs: Date.now(),
    kind,
    level,
    characters: source.length,
    sha256: createHash('sha256').update(source).digest('hex'),
  });
}

function serializeConsole(records) {
  return `${records.map((record) => [
    new Date(record.observedAtMs).toISOString(),
    `kind=${record.kind}`,
    `level=${record.level}`,
    `characters=${record.characters}`,
    `sha256=${record.sha256}`,
  ].join(' ')).join('\n')}\n`;
}

async function launchChrome(launchUrl) {
  const userDataDir = await mkdtemp(join(tmpdir(), 'arkadium-sandbox-chrome-'));
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
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const stderrRecords = [];
  chrome.stderr.setEncoding('utf8');
  chrome.stderr.on('data', (chunk) => {
    if (stderrRecords.length < MAX_CONSOLE_RECORDS) {
      stderrRecords.push(structuralConsoleRecord('browser-stderr', 'diagnostic', chunk));
    }
  });

  const activePort = await waitFor('Chrome DevTools port', async () => {
    try {
      return (await readFile(join(userDataDir, 'DevToolsActivePort'), 'utf8')).trim();
    } catch {
      if (chrome.exitCode !== null) throw new Error('Chrome exited before DevTools became ready.');
      return null;
    }
  }, 20_000, 100);
  const [port] = activePort.split(/\r?\n/);
  if (!/^\d+$/.test(port)) throw new Error('Chrome DevTools port is invalid.');

  const target = await waitFor('Sandbox page target', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { cache: 'no-store' });
    if (!response.ok) return null;
    const targets = await response.json();
    return targets.find((value) => value.type === 'page' && value.webSocketDebuggerUrl) ?? null;
  }, 20_000, 100);

  return Object.freeze({
    chrome,
    userDataDir,
    stderrRecords,
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

async function contextWithApi(client, contexts, expression) {
  for (const context of contexts.values()) {
    if (context.auxData?.isDefault !== true) continue;
    try {
      if (await client.evaluate(expression, context.id, { awaitPromise: false })) return context;
    } catch {
      // Contexts may disappear during navigation; the next poll will refresh them.
    }
  }
  return null;
}

async function clickSelector(client, contextId, selector) {
  const clicked = await client.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!(node instanceof HTMLElement)) return false;
    node.click();
    return true;
  })()`, contextId, { awaitPromise: false });
  if (clicked !== true) throw new Error('Required Sandbox control was not found.');
}

async function readEvidence(client, contextId) {
  return client.evaluate('globalThis.__CANYON_SANDBOX_EVIDENCE__()', contextId, {
    awaitPromise: false,
  });
}

async function readDriverSnapshot(client, contextId) {
  return client.evaluate('globalThis.__CANYON_SANDBOX_DRIVER__.snapshot()', contextId, {
    awaitPromise: false,
  });
}

async function frameOffset(client, contextId, selector) {
  return client.evaluate(`(() => {
    const frame = document.querySelector(${JSON.stringify(selector)});
    if (!(frame instanceof HTMLIFrameElement)) return null;
    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: rect.left + frame.clientLeft,
      y: rect.top + frame.clientTop,
    };
  })()`, contextId, { awaitPromise: false });
}

async function dispatchClick(client, x, y) {
  if (![x, y].every((value) => Number.isFinite(value) && value >= 0 && value <= 10_000)) {
    throw new Error('Sandbox game coordinates are invalid.');
  }
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
}

async function playOneMove(client, hostContextId, gameContextId, frameSelector) {
  const before = await readDriverSnapshot(client, gameContextId);
  const move = await client.evaluate('globalThis.__CANYON_SANDBOX_DRIVER__.nextMove()', gameContextId, {
    awaitPromise: false,
  });
  if (!isPlainObject(move) || !isPlainObject(move.first) || !isPlainObject(move.second)) {
    throw new Error('Sandbox driver did not return a legal move.');
  }
  const offset = await frameOffset(client, hostContextId, frameSelector);
  if (!isPlainObject(offset)) throw new Error('Sandbox game frame was not found.');

  await dispatchClick(client, offset.x + move.first.x, offset.y + move.first.y);
  await dispatchClick(client, offset.x + move.second.x, offset.y + move.second.y);
  return waitFor('Sandbox move resolution', async () => {
    const after = await readDriverSnapshot(client, gameContextId);
    if (!isPlainObject(after)) return null;
    return after.status !== before.status
      || after.moves < before.moves
      || after.score > before.score
      ? after
      : null;
  }, 15_000, 100);
}

async function readOfficialRpcDiagnostics(client, hostContextId, rpcDiagnosticsUrl) {
  const evidence = await client.evaluate(`(async () => {
    const response = await fetch(${JSON.stringify(rpcDiagnosticsUrl)}, {
      credentials: 'include',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error('RPC diagnostics request failed.');
    return response.json();
  })()`, hostContextId);
  if (!isPlainObject(evidence)) throw new Error('Official RPC diagnostics are invalid.');
  return evidence;
}

async function capture() {
  const candidateSha = option('--candidate-sha');
  if (typeof candidateSha !== 'string' || !BUILD_SHA.test(candidateSha)) {
    throw new Error('--candidate-sha must be an exact lowercase commit SHA.');
  }
  const previewUrl = validatePreviewUrl(option('--preview-url'), candidateSha);
  const outputDir = resolve(option('--output', 'evidence/arkadium-sandbox'));
  const automation = parseAutomationConfig(process.env.ARKADIUM_SANDBOX_AUTOMATION_JSON);
  const launchUrl = createLaunchUrl(automation.launchUrlTemplate, previewUrl);
  if (new URL(automation.rpcDiagnosticsUrl).origin !== new URL(launchUrl).origin) {
    throw new Error('RPC diagnostics must use the official Sandbox origin.');
  }

  await mkdir(outputDir, { recursive: true });
  const browser = await launchChrome(launchUrl);
  const consoleRecords = [...browser.stderrRecords];
  const client = await CdpClient.connect(browser.target.webSocketDebuggerUrl);
  const contexts = new Map();
  let consoleErrorCount = 0;
  let startedAtMs = null;

  const record = (kind, level, text) => {
    if (consoleRecords.length < MAX_CONSOLE_RECORDS) {
      consoleRecords.push(structuralConsoleRecord(kind, level, text));
    }
    if (level === 'error') consoleErrorCount += 1;
  };
  client.on('Runtime.executionContextCreated', ({ context }) => contexts.set(context.id, context));
  client.on('Runtime.executionContextDestroyed', ({ executionContextId }) => contexts.delete(executionContextId));
  client.on('Runtime.executionContextsCleared', () => contexts.clear());
  client.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    record('exception', 'error', exceptionDetails?.text ?? 'runtime exception');
  });
  client.on('Runtime.consoleAPICalled', ({ type, args }) => {
    const text = Array.isArray(args)
      ? args.map((arg) => String(arg.description ?? arg.value ?? '')).join(' ')
      : '';
    record('console', type === 'error' ? 'error' : 'diagnostic', text);
  });
  client.on('Log.entryAdded', ({ entry }) => {
    record('log', entry?.level === 'error' ? 'error' : 'diagnostic', entry?.text ?? '');
  });

  try {
    await Promise.all([
      client.send('Runtime.enable'),
      client.send('Page.enable'),
      client.send('Log.enable'),
    ]);
    const frameTree = await client.send('Page.getFrameTree');
    const mainFrameId = frameTree.frameTree?.frame?.id;
    const hostContext = await waitFor('Official Sandbox execution context', async () => {
      return [...contexts.values()].find((context) => context.auxData?.frameId === mainFrameId
        && context.auxData?.isDefault === true) ?? null;
    });
    const gameContext = await waitFor('Canyon Sandbox evidence context', async () => {
      const context = await contextWithApi(client, contexts,
        "typeof globalThis.__CANYON_SANDBOX_EVIDENCE__ === 'function' && typeof globalThis.__CANYON_SANDBOX_DRIVER__ === 'object'");
      if (context && startedAtMs === null) startedAtMs = Date.now();
      return context;
    });

    await clickSelector(client, gameContext.id, '[data-action="start"]');
    await waitFor('Canyon gameplay start', async () => {
      const snapshot = await readDriverSnapshot(client, gameContext.id);
      return snapshot?.mode === 'playing' ? snapshot : null;
    });

    await clickSelector(client, hostContext.id, automation.pauseSelector);
    await waitFor('Official host pause callback', async () => {
      const evidence = await readEvidence(client, gameContext.id);
      return evidence?.hostPauseObserved === true ? evidence : null;
    });
    await clickSelector(client, hostContext.id, automation.resumeSelector);
    await waitFor('Official host resume callback', async () => {
      const evidence = await readEvidence(client, gameContext.id);
      return evidence?.hostResumeObserved === true ? evidence : null;
    });

    let snapshot = await readDriverSnapshot(client, gameContext.id);
    const gameDeadline = Date.now() + GAME_TIMEOUT_MS;
    for (let move = 0; snapshot?.status === 'playing' && move < MAX_GAME_MOVES; move += 1) {
      if (Date.now() > gameDeadline) throw new Error('Sandbox gameplay timed out.');
      snapshot = await playOneMove(
        client,
        hostContext.id,
        gameContext.id,
        automation.gameFrameSelector,
      );
    }
    if (snapshot?.status === 'playing') throw new Error('Sandbox gameplay did not reach game end.');

    const runtimeEvidence = await waitFor('Complete Sandbox lifecycle evidence', async () => {
      const evidence = await readEvidence(client, gameContext.id);
      return Array.isArray(evidence?.observedCalls)
        && evidence.observedCalls.at(-1) === 'gameEnd'
        ? evidence
        : null;
    });
    if (runtimeEvidence.buildSha !== candidateSha
      || runtimeEvidence.sdkVersion !== EXPECTED_SDK_VERSION
      || typeof runtimeEvidence.sessionId !== 'string'
      || !UUID_V4.test(runtimeEvidence.sessionId)) {
      throw new Error('Sandbox runtime evidence does not match the exact candidate.');
    }

    const rpcDiagnostics = await readOfficialRpcDiagnostics(
      client,
      hostContext.id,
      automation.rpcDiagnosticsUrl,
    );
    const generatedAtMs = rpcDiagnostics.generatedAtMs;
    if (!Number.isSafeInteger(generatedAtMs) || generatedAtMs < startedAtMs) {
      throw new Error('Official RPC diagnostics timestamp is invalid.');
    }
    const status = Object.freeze({
      schemaVersion: 1,
      source: 'official-arkadium-sandbox',
      sessionId: runtimeEvidence.sessionId,
      buildSha: candidateSha,
      sdkVersion: EXPECTED_SDK_VERSION,
      startedAtMs,
      generatedAtMs,
      hostPauseObserved: runtimeEvidence.hostPauseObserved,
      hostResumeObserved: runtimeEvidence.hostResumeObserved,
      bootErrorVisible: runtimeEvidence.bootErrorVisible,
      consoleErrorCount,
    });
    const events = Object.freeze({
      schemaVersion: 1,
      source: 'official-arkadium-sandbox',
      sessionId: runtimeEvidence.sessionId,
      buildSha: candidateSha,
      sdkVersion: EXPECTED_SDK_VERSION,
      generatedAtMs,
      observedCalls: runtimeEvidence.observedCalls,
    });
    const report = verifySandboxEvidenceBundle({
      status,
      events,
      rpcDiagnostics,
    }, {
      expectedBuildSha: candidateSha,
      expectedSdkVersion: EXPECTED_SDK_VERSION,
      nowMs: Date.now(),
      maxAgeMs: 15 * 60_000,
    });
    if (!report.ok) {
      throw new Error(`Sandbox evidence failed structural verification: ${report.errors.join(' ')}`);
    }

    const screenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    if (typeof screenshot.data !== 'string' || screenshot.data.length === 0) {
      throw new Error('Sandbox screenshot capture failed.');
    }
    await Promise.all([
      writeFile(join(outputDir, 'sandbox-status.json'), `${JSON.stringify(status, null, 2)}\n`),
      writeFile(join(outputDir, 'sandbox-events.json'), `${JSON.stringify(events, null, 2)}\n`),
      writeFile(join(outputDir, 'rpc-diagnostics.json'), `${JSON.stringify(rpcDiagnostics, null, 2)}\n`),
      writeFile(join(outputDir, 'sandbox-console.log'), serializeConsole(consoleRecords), 'utf8'),
      writeFile(join(outputDir, 'sandbox-page.png'), Buffer.from(screenshot.data, 'base64')),
    ]);
  } finally {
    client.close();
    await browser.close();
  }
}

await capture();
console.log('Official Arkadium Sandbox evidence captured for the exact candidate.');
