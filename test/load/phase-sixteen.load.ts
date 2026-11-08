import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { arch, cpus, hostname, platform, release, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

type WalletResponse = Readonly<{
  id: string;
  playerId: string;
  balance: { amount: string; currency: string };
}>;

type WagerResponse = Readonly<{
  transactionId: string;
  status: string;
  idempotentReplay: boolean;
}>;

type ReconciliationResponse = Readonly<{
  consistent: boolean;
  checkedEntries: number;
}>;

type LoadOperation = Readonly<{
  idempotencyKey: string;
  payload: Readonly<{
    providerId: string;
    externalTransactionId: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: 'BET';
    money: { amount: string; currency: 'BRL' };
  }>;
}>;

type RequestResult = Readonly<{
  apiUrl: string;
  status: number;
  latencyMs: number;
  businessStatus?: string;
  idempotentReplay?: boolean;
  error?: string;
}>;

type MetricsSnapshot = Readonly<{
  wagerTransactions: number;
  idempotentReplays: number;
  lockConflicts: number;
  outboxLagSeconds: number;
  outboxPending: number;
}>;

const configuration = loadConfiguration();
const startedAt = new Date();
const runId = randomUUID();
let metricScrapeErrors = 0;
let maxOutboxLagSeconds = 0;
let maxOutboxPending = 0;
let metricSamples = 0;

console.log('TCJG phase 16 load test');
console.log(
  JSON.stringify(
    {
      runId,
      apiUrls: configuration.apiUrls,
      requests: configuration.requests,
      concurrency: configuration.concurrency,
      wallets: configuration.wallets,
      duplicateEvery: configuration.duplicateEvery,
    },
    null,
    2,
  ),
);

await assertHealthy(configuration.apiUrls);
const wallets = await createWallets();
await waitForOutboxToSettle(configuration.outboxDrainTimeoutMs);
const metricsBefore = await collectMetrics();
maxOutboxLagSeconds = Math.max(
  maxOutboxLagSeconds,
  metricsBefore.outboxLagSeconds,
);
maxOutboxPending = Math.max(maxOutboxPending, metricsBefore.outboxPending);
const operations = createOperationPlan(wallets);

let sampling = true;
const sampler = sampleMetrics();

const loadStartedAt = performance.now();
const results = await executeLoad(operations);
const loadDurationMs = performance.now() - loadStartedAt;

await waitForOutboxToSettle(configuration.outboxDrainTimeoutMs);
sampling = false;
await sampler;

const metricsAfter = await collectMetrics();
maxOutboxLagSeconds = Math.max(
  maxOutboxLagSeconds,
  metricsAfter.outboxLagSeconds,
);
maxOutboxPending = Math.max(maxOutboxPending, metricsAfter.outboxPending);

const reconciliation = await reconcileWallets(wallets);
const finishedAt = new Date();
const summary = summarize(results, loadDurationMs);
const report = {
  runId,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  gitCommit: currentGitCommit(),
  environment: {
    hostname: hostname(),
    platform: platform(),
    release: release(),
    architecture: arch(),
    cpuModel: cpus()[0]?.model ?? 'unknown',
    cpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    bunVersion: process.versions.bun ?? 'not-running-on-bun',
    nodeCompatibilityVersion: process.versions.node,
    dockerVersion: commandOutput('docker', [
      'version',
      '--format',
      '{{.Server.Version}}',
    ]),
    dockerComposeVersion: commandOutput('docker', [
      'compose',
      'version',
      '--short',
    ]),
    note: process.env.LOAD_ENVIRONMENT_NOTE ?? '',
    apiUrls: configuration.apiUrls,
  },
  methodology: {
    scenario:
      'Concurrent BET requests distributed round-robin across all API instances',
    setupExcludedFromMeasurement: true,
    requests: configuration.requests,
    concurrency: configuration.concurrency,
    wallets: configuration.wallets,
    initialBalance: configuration.initialBalance,
    betAmount: configuration.betAmount,
    duplicateEvery: configuration.duplicateEvery,
    requestTimeoutMs: configuration.requestTimeoutMs,
    outboxDrainTimeoutMs: configuration.outboxDrainTimeoutMs,
    notes: [
      'Every monetary value is sent as a decimal string with two places.',
      'Every Nth request repeats the immediately previous idempotency key and payload when duplicateEvery is greater than zero.',
      'Wallet creation, outbox warm-up and reconciliation are outside the measured request window.',
      'A successful run requires HTTP 200, business status PROCESSED and consistent reconciliation for every test wallet.',
    ],
  },
  results: {
    ...summary,
    metrics: {
      before: metricsBefore,
      after: metricsAfter,
      delta: {
        wagerTransactions: nonNegativeDelta(
          metricsAfter.wagerTransactions,
          metricsBefore.wagerTransactions,
        ),
        idempotentReplays: nonNegativeDelta(
          metricsAfter.idempotentReplays,
          metricsBefore.idempotentReplays,
        ),
        lockConflicts: nonNegativeDelta(
          metricsAfter.lockConflicts,
          metricsBefore.lockConflicts,
        ),
      },
      observed: {
        samples: metricSamples,
        scrapeErrors: metricScrapeErrors,
        maxOutboxLagSeconds,
        maxOutboxPending,
      },
    },
    reconciliation,
  },
};

await mkdir(configuration.reportDirectory, { recursive: true });
const reportPath = resolve(
  configuration.reportDirectory,
  `phase-sixteen-${startedAt.toISOString().replaceAll(':', '-')}.json`,
);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

printSummary(reportPath, summary, report.results.metrics, reconciliation);

if (
  summary.errors > 0 ||
  reconciliation.inconsistent > 0 ||
  metricScrapeErrors > 0
) {
  throw new Error(
    `Load test did not satisfy its acceptance criteria; inspect ${reportPath}`,
  );
}

async function createWallets(): Promise<WalletResponse[]> {
  const created: WalletResponse[] = [];
  for (let index = 0; index < configuration.wallets; index += 1) {
    const apiUrl = configuration.apiUrls[index % configuration.apiUrls.length]!;
    const response = await requestJson<WalletResponse>(apiUrl, '/wallets', {
      method: 'POST',
      body: {
        playerId: randomUUID(),
        initialBalance: {
          amount: configuration.initialBalance,
          currency: 'BRL',
        },
      },
    });
    if (response.status !== 201) {
      throw new Error(
        `Wallet setup failed with HTTP ${response.status}: ${response.rawBody}`,
      );
    }
    created.push(response.body);
  }
  return created;
}

function createOperationPlan(wallets: WalletResponse[]): LoadOperation[] {
  const operations: LoadOperation[] = [];
  let uniqueSequence = 0;

  for (let index = 0; index < configuration.requests; index += 1) {
    if (
      configuration.duplicateEvery > 0 &&
      (index + 1) % configuration.duplicateEvery === 0 &&
      operations.length > 0
    ) {
      operations.push(operations.at(-1)!);
      continue;
    }

    const wallet = wallets[uniqueSequence % wallets.length]!;
    const externalTransactionId = randomUUID();
    operations.push({
      idempotencyKey: `load:${runId}:${externalTransactionId}`,
      payload: {
        providerId: `load-${runId}`,
        externalTransactionId,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: `load-round-${uniqueSequence}`,
        gameId: 'phase-sixteen-load-test',
        kind: 'BET',
        money: { amount: configuration.betAmount, currency: 'BRL' },
      },
    });
    uniqueSequence += 1;
  }

  return operations;
}

async function executeLoad(
  operations: LoadOperation[],
): Promise<RequestResult[]> {
  const results: Array<RequestResult | undefined> = Array.from({
    length: operations.length,
  });
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(configuration.concurrency, operations.length) },
    async () => {
      while (nextIndex < operations.length) {
        const index = nextIndex;
        nextIndex += 1;
        const operation = operations[index]!;
        const apiUrl =
          configuration.apiUrls[index % configuration.apiUrls.length]!;
        const requestStartedAt = performance.now();

        try {
          const response = await requestJson<WagerResponse>(
            apiUrl,
            '/wagering/transactions',
            {
              method: 'POST',
              headers: { 'idempotency-key': operation.idempotencyKey },
              body: operation.payload,
            },
          );
          const accepted =
            response.status === 200 && response.body.status === 'PROCESSED';
          results[index] = {
            apiUrl,
            status: response.status,
            latencyMs: performance.now() - requestStartedAt,
            businessStatus: response.body.status,
            idempotentReplay: response.body.idempotentReplay,
            error: accepted ? undefined : response.rawBody.slice(0, 500),
          };
        } catch (error) {
          results[index] = {
            apiUrl,
            status: 0,
            latencyMs: performance.now() - requestStartedAt,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    },
  );

  await Promise.all(workers);
  return results.map((result, index) => {
    if (!result) throw new Error(`Load operation ${index} produced no result`);
    return result;
  });
}

async function reconcileWallets(wallets: WalletResponse[]): Promise<{
  checked: number;
  consistent: number;
  inconsistent: number;
  checkedLedgerEntries: number;
}> {
  let consistent = 0;
  let checkedLedgerEntries = 0;

  for (let index = 0; index < wallets.length; index += 1) {
    const wallet = wallets[index]!;
    const apiUrl = configuration.apiUrls[index % configuration.apiUrls.length]!;
    const response = await requestJson<ReconciliationResponse>(
      apiUrl,
      `/wallets/${wallet.id}/reconciliation`,
      { method: 'POST' },
    );
    if (response.status === 200 && response.body.consistent) consistent += 1;
    checkedLedgerEntries += response.body.checkedEntries ?? 0;
  }

  return {
    checked: wallets.length,
    consistent,
    inconsistent: wallets.length - consistent,
    checkedLedgerEntries,
  };
}

async function assertHealthy(apiUrls: string[]): Promise<void> {
  const checks = await Promise.all(
    apiUrls.map(async (apiUrl) => ({
      apiUrl,
      response: await fetch(`${apiUrl}/health/ready`, {
        signal: AbortSignal.timeout(configuration.requestTimeoutMs),
      }),
    })),
  );
  const unhealthy = checks.filter(({ response }) => !response.ok);
  if (unhealthy.length > 0) {
    throw new Error(
      `Unhealthy API instances: ${unhealthy.map(({ apiUrl, response }) => `${apiUrl} (${response.status})`).join(', ')}`,
    );
  }
}

async function sampleMetrics(): Promise<void> {
  while (sampling) {
    try {
      const snapshot = await collectMetrics();
      maxOutboxLagSeconds = Math.max(
        maxOutboxLagSeconds,
        snapshot.outboxLagSeconds,
      );
      maxOutboxPending = Math.max(maxOutboxPending, snapshot.outboxPending);
      metricSamples += 1;
    } catch {
      metricScrapeErrors += 1;
    }
    await delay(configuration.metricsSampleIntervalMs);
  }
}

async function waitForOutboxToSettle(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await collectMetrics();
    maxOutboxLagSeconds = Math.max(
      maxOutboxLagSeconds ?? 0,
      snapshot.outboxLagSeconds,
    );
    maxOutboxPending = Math.max(maxOutboxPending ?? 0, snapshot.outboxPending);
    if (snapshot.outboxPending === 0) return;
    await delay(100);
  }
}

async function collectMetrics(): Promise<MetricsSnapshot> {
  const documents = await Promise.all(
    configuration.apiUrls.map(async (apiUrl) => {
      const response = await fetch(`${apiUrl}/metrics`, {
        signal: AbortSignal.timeout(configuration.requestTimeoutMs),
      });
      if (!response.ok) {
        throw new Error(`GET ${apiUrl}/metrics returned ${response.status}`);
      }
      return response.text();
    }),
  );

  return {
    wagerTransactions: sumAcrossDocuments(
      documents,
      'wager_transactions_total',
    ),
    idempotentReplays: sumAcrossDocuments(
      documents,
      'idempotent_replays_total',
      'source="http"',
    ),
    lockConflicts: sumAcrossDocuments(documents, 'lock_conflicts_total'),
    outboxLagSeconds: maxAcrossDocuments(documents, 'outbox_lag_seconds'),
    outboxPending: maxAcrossDocuments(documents, 'outbox_pending'),
  };
}

function summarize(results: RequestResult[], durationMs: number) {
  const latencies = results.map(({ latencyMs }) => latencyMs).sort(numberSort);
  const statusCounts = countBy(results, ({ status }) => String(status));
  const businessStatusCounts = countBy(
    results,
    ({ businessStatus }) => businessStatus ?? 'NO_RESPONSE',
  );
  const perInstance = Object.fromEntries(
    configuration.apiUrls.map((apiUrl) => {
      const instanceResults = results.filter(
        (result) => result.apiUrl === apiUrl,
      );
      return [
        apiUrl,
        {
          requests: instanceResults.length,
          successes: instanceResults.filter((result) => !result.error).length,
          errors: instanceResults.filter((result) => result.error).length,
        },
      ];
    }),
  );
  const errors = results.filter((result) => result.error);

  return {
    durationSeconds: round(durationMs / 1_000),
    attempted: results.length,
    successes: results.length - errors.length,
    errors: errors.length,
    errorRatePercent: round((errors.length / results.length) * 100),
    throughputRequestsPerSecond: round(results.length / (durationMs / 1_000)),
    latencyMs: {
      min: round(latencies[0] ?? 0),
      mean: round(
        latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
      ),
      p50: round(percentile(latencies, 0.5)),
      p95: round(percentile(latencies, 0.95)),
      p99: round(percentile(latencies, 0.99)),
      max: round(latencies.at(-1) ?? 0),
    },
    statusCounts,
    businessStatusCounts,
    observedIdempotentReplays: results.filter(
      ({ idempotentReplay }) => idempotentReplay,
    ).length,
    perInstance,
    errorSamples: errors.slice(0, 20).map(({ apiUrl, status, error }) => ({
      apiUrl,
      status,
      error,
    })),
  };
}

async function requestJson<T>(
  apiUrl: string,
  path: string,
  options: Readonly<{
    method: 'POST';
    headers?: Record<string, string>;
    body?: unknown;
  }>,
): Promise<{ status: number; body: T; rawBody: string }> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method,
    headers: {
      ...(options.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(configuration.requestTimeoutMs),
  });
  const rawBody = await response.text();
  let body: T;
  try {
    body = JSON.parse(rawBody) as T;
  } catch {
    throw new Error(
      `${options.method} ${apiUrl}${path} returned non-JSON HTTP ${response.status}: ${rawBody.slice(0, 500)}`,
    );
  }
  return { status: response.status, body, rawBody };
}

function sumAcrossDocuments(
  documents: string[],
  metricName: string,
  requiredLabel?: string,
): number {
  return documents.reduce(
    (sum, document) =>
      sum + metricValues(document, metricName, requiredLabel).reduce(add, 0),
    0,
  );
}

function maxAcrossDocuments(documents: string[], metricName: string): number {
  return Math.max(
    0,
    ...documents.flatMap((document) => metricValues(document, metricName)),
  );
}

function metricValues(
  document: string,
  metricName: string,
  requiredLabel?: string,
): number[] {
  return document.split('\n').flatMap((line) => {
    if (
      (!line.startsWith(`${metricName}{`) &&
        !line.startsWith(`${metricName} `)) ||
      (requiredLabel && !line.includes(requiredLabel))
    ) {
      return [];
    }
    const value = Number(line.trim().split(/\s+/).at(-1));
    return Number.isFinite(value) ? [value] : [];
  });
}

function percentile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.max(0, Math.ceil(sortedValues.length * fraction) - 1);
  return sortedValues[index] ?? 0;
}

function countBy<T>(
  values: T[],
  keyFor: (value: T) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = keyFor(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function loadConfiguration() {
  const apiUrls = (
    process.env.LOAD_API_URLS ??
    'http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:3002'
  )
    .split(',')
    .map((url) => url.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (new Set(apiUrls).size < 3) {
    throw new Error('LOAD_API_URLS must contain at least three distinct URLs');
  }

  return Object.freeze({
    apiUrls,
    requests: integerEnvironment('LOAD_REQUESTS', 1_000, 1),
    concurrency: integerEnvironment('LOAD_CONCURRENCY', 50, 1),
    wallets: integerEnvironment('LOAD_WALLETS', 25, 1),
    duplicateEvery: integerEnvironment('LOAD_DUPLICATE_EVERY', 10, 0),
    requestTimeoutMs: integerEnvironment('LOAD_REQUEST_TIMEOUT_MS', 10_000, 1),
    metricsSampleIntervalMs: integerEnvironment(
      'LOAD_METRICS_SAMPLE_INTERVAL_MS',
      250,
      10,
    ),
    outboxDrainTimeoutMs: integerEnvironment(
      'LOAD_OUTBOX_DRAIN_TIMEOUT_MS',
      10_000,
      0,
    ),
    initialBalance: moneyEnvironment('LOAD_INITIAL_BALANCE', '10000.00'),
    betAmount: moneyEnvironment('LOAD_BET_AMOUNT', '1.00'),
    reportDirectory: resolve(process.env.LOAD_REPORT_DIR ?? 'load-results'),
  });
}

function integerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(
      `${name} must be an integer greater than or equal to ${minimum}`,
    );
  }
  return value;
}

function moneyEnvironment(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  if (!/^(0|[1-9]\d*)\.\d{2}$/.test(value) || value === '0.00') {
    throw new Error(
      `${name} must be a positive decimal string with two places`,
    );
  }
  return value;
}

function currentGitCommit(): string {
  return commandOutput('git', ['rev-parse', 'HEAD']);
}

function commandOutput(command: string, arguments_: string[]): string {
  try {
    return execFileSync(command, arguments_, { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function printSummary(
  reportPath: string,
  summary: ReturnType<typeof summarize>,
  metrics: {
    delta: {
      wagerTransactions: number;
      idempotentReplays: number;
      lockConflicts: number;
    };
    observed: {
      maxOutboxLagSeconds: number;
      maxOutboxPending: number;
      scrapeErrors: number;
    };
  },
  reconciliation: Awaited<ReturnType<typeof reconcileWallets>>,
): void {
  console.log('\nLoad test result');
  console.table({
    requests: summary.attempted,
    successes: summary.successes,
    errors: summary.errors,
    errorRatePercent: summary.errorRatePercent,
    throughputRps: summary.throughputRequestsPerSecond,
    p50Ms: summary.latencyMs.p50,
    p95Ms: summary.latencyMs.p95,
    p99Ms: summary.latencyMs.p99,
    lockConflicts: metrics.delta.lockConflicts,
    idempotentReplays: metrics.delta.idempotentReplays,
    maxOutboxLagSeconds: metrics.observed.maxOutboxLagSeconds,
    maxOutboxPending: metrics.observed.maxOutboxPending,
    consistentWallets: `${reconciliation.consistent}/${reconciliation.checked}`,
  });
  console.log(`Report: ${reportPath}`);
}

function nonNegativeDelta(after: number, before: number): number {
  return Math.max(0, after - before);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function numberSort(left: number, right: number): number {
  return left - right;
}

function add(left: number, right: number): number {
  return left + right;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
