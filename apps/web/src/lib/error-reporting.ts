import { NO_DATA_COLLECTION, redactErrorReport } from "@helpdesk/shared/error-reports";

/**
 * Reports of web app errors to Sentry, only when the server sets SENTRY_DSN:
 * it passes the settings in index.html, and the SDK loads only then.
 * `redactErrorReport` decides what a report keeps.
 */
type Settings = { dsn: string; environment: string; release?: string; tracesSampleRate?: number };

let report: ((error: unknown) => void) | undefined;
/** Errors caught while the SDK loads, for example during the first render. */
let pending: unknown[] | undefined;

function readSettings(): Settings | undefined {
  const content = document.querySelector<HTMLMetaElement>('meta[name="helpdesk-error-reporting"]')?.content;
  if (!content) return undefined;
  try {
    return JSON.parse(content) as Settings;
  } catch {
    return undefined;
  }
}

/** Page addresses with ticket numbers and ids replaced, for performance data. */
export function routeName(path: string): string {
  return path.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}(?=\/|$)/gi, "/:id").replace(/\/\d+(?=\/|$)/g, "/:number");
}

/** `currentRoute` names the route in reports, e.g. `/tickets/$number`, never the address. */
export async function startErrorReporting(currentRoute: () => string | undefined) {
  const settings = readSettings();
  if (!settings) return;
  pending = [];
  const {
    init,
    captureException,
    browserTracingIntegration,
    dedupeIntegration,
    globalHandlersIntegration,
    linkedErrorsIntegration,
  } = await import("@sentry/browser");
  const tracesSampleRate = settings.tracesSampleRate ?? 0;
  init({
    dsn: settings.dsn,
    environment: settings.environment,
    release: settings.release,
    // Uncaught errors, and page loads and navigations when tracing is on: no
    // breadcrumbs, request data, sessions or replays.
    defaultIntegrations: false,
    integrations: [
      globalHandlersIntegration(),
      linkedErrorsIntegration(),
      dedupeIntegration(),
      ...(tracesSampleRate > 0
        ? [
            browserTracingIntegration({
              beforeStartSpan: (options) => ({ ...options, name: routeName(window.location.pathname) }),
            }),
          ]
        : []),
    ],
    tracesSampleRate,
    // The app's own API joins the server's traces; no other site gets the headers.
    tracePropagationTargets: [/^\/api\//],
    dataCollection: NO_DATA_COLLECTION,
    maxBreadcrumbs: 0,
    beforeSend: (event) => {
      // The server reports failed API requests itself.
      if (event.exception?.values?.some((value) => value.type === "ApiError")) return null;
      return { ...redactErrorReport(event), transaction: currentRoute() };
    },
  });
  report = (error) => captureException(error);
  for (const error of pending.splice(0)) report(error);
}

/** Errors that an error screen (error boundary) caught; they never reach `window.onerror`. */
export function reportCaughtError(error: unknown) {
  if (report) report(error);
  else pending?.push(error);
}
