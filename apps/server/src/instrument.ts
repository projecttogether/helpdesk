/*
 * Starts Sentry before anything else loads, so that requests, database
 * queries and outgoing calls can be traced. Production loads it first with
 * `node --import dist/instrument.mjs dist/main.mjs` (docker-entrypoint.sh),
 * development with `tsx --import`. It reads the environment directly: the
 * app's configuration loads later. Off unless SENTRY_DSN is set.
 */
import * as Sentry from "@sentry/node";
import { NO_DATA_COLLECTION, redactErrorReport, redactLog } from "@helpdesk/shared/error-reports";

const env = (name: string) => process.env[name]?.trim() || undefined;

function sampleRate(): number {
  const value = Number(env("SENTRY_TRACES_SAMPLE_RATE") ?? 0);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

const dsn = env("SENTRY_DSN");
if (dsn && !Sentry.isInitialized()) {
  const tracesSampleRate = sampleRate();
  const version = env("APP_VERSION");
  Sentry.init({
    dsn,
    environment: env("SENTRY_ENVIRONMENT") ?? env("NODE_ENV") ?? "development",
    release: env("SENTRY_RELEASE") ?? (version ? `helpdesk@${version}` : undefined),
    defaultIntegrations: false,
    integrations: [
      // Errors logged at error or fatal become issues; warnings and up become logs.
      Sentry.pinoIntegration({
        error: { levels: ["error", "fatal"] },
        log: { levels: ["warn", "error", "fatal"] },
      }),
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration({ mode: "strict" }),
      Sentry.linkedErrorsIntegration(),
      Sentry.nodeContextIntegration(),
      Sentry.contextLinesIntegration(),
      ...(tracesSampleRate > 0
        ? [
            Sentry.httpIntegration({ breadcrumbs: false }),
            Sentry.nativeNodeFetchIntegration({ breadcrumbs: false }),
            Sentry.honoIntegration(),
            Sentry.postgresIntegration(),
          ]
        : []),
    ],
    tracesSampleRate,
    dataCollection: NO_DATA_COLLECTION,
    maxBreadcrumbs: 0,
    beforeSend: (event) => {
      const report = redactErrorReport(event);
      // Failed requests log their route pattern, e.g. `PATCH /api/v1/tickets/:number`.
      const route = report.contexts?.pino?.route;
      if (typeof route === "string") report.transaction = route;
      return report;
    },
    beforeSendLog: redactLog,
  });
  Sentry.getGlobalScope().setTag("role", env("APP_ROLE") ?? "all");
}
