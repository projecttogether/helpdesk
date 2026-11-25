# Architecture

How the helpdesk works inside, for contributors. `AGENTS.md` has the code
rules.

## Processes

One Docker image, one Node.js entry point (`apps/server/src/main.ts`);
`APP_ROLE` picks what runs:

- **web**: the Hono server: the JSON API under `/api/v1`, sign-in under
  `/api/auth` (Better Auth), health checks under `/-/`, and the built web
  app. It also removes unused uploads every hour.
- **worker**: sends queued emails and Slack messages (woken by PostgreSQL
  `NOTIFY`, at least every 5 seconds), syncs roles from Keycloak
  (`DIRECTORY=keycloak`), asks IAM about identity requests every
  5 minutes and removes old notifications.
- **migrate**: applies the Drizzle migrations under an advisory lock and
  creates the default form and category.
- **all**: web and worker in one process.

`node --import dist/instrument.mjs` starts Sentry before the app loads, so
HTTP, Hono, database and outgoing calls can be traced.

The image's command `cli` runs the operator command (`src/cli.ts`, bundled
as `dist/cli.mjs`; `/usr/local/bin/cli` in the image): `cli settings`
lists, shows, applies and tests the settings of the Integrations page. The
routes and the command call the same functions (`src/integrations/`,
`src/identity/settings.ts`); the command acts as the `operator`
(`OperatorPrincipal`), which only it creates, with a superadmin's rights.
It reads bodies from stdin, prints only its output on stdout and logs to
stderr, starts no server or worker, and loads without Sentry.

## Data

PostgreSQL holds everything except uploaded files, which live in
`ATTACHMENTS_DIR` under generated names.

- `users` (+ Better Auth's `sessions`, `accounts`, `verifications`):
  everyone the sign-in or the directory sync knows, with their `role`
  (null: no access), where it came from, and how they want to be notified.
- `form_versions`: every published version of the form (JSON, with its
  language). The highest version is the form; tickets point to the version
  they were sent with.
- `categories`: the category question's answers, with a default assignee.
- `tickets`: number (identity), title, status, urgency, category,
  requester, assignee, due date, board rank, revision, and the answers as
  asked (`StoredAnswer[]`, labels included).
- `ticket_messages` (public replies and internal notes), `ticket_events`
  (activity, ordered by `seq`), `attachments`.
- `notifications`: the outbox of emails and Slack messages.
- `settings`: email, Slack and IAM settings (secrets encrypted with
  `ENCRYPTION_KEY`), the last directory sync.
- `identity_requests`: requests to IAM sent from a ticket, with what IAM
  last said.
- `audit_log`: changes by admins, superadmins and the operator command.

## The form

`packages/shared/src/form.ts` holds the model and its rules, used by the web
app (page by page) and the server (the whole submission):

- `visibleForm(definition, answers)`: the shown pages and questions, in one
  pass; conditions may only look back, and a hidden question counts as
  unanswered.
- `validateAnswers`: checks the shown questions only and drops everything
  else, so hidden questions are never required or stored.
- `definitionProblems`: what keeps a definition from being published (system
  questions on page 1, rules referring to earlier questions, choices).

## Tickets

`apps/server/src/tickets/service.ts` makes every change in one transaction:
it locks the ticket, checks the revision the person saw (`409
ticket_changed`), writes the change and its `ticket_events`, and queues the
notifications (`notifications/enqueue.ts`, `Outbox`). Creating a ticket uses
a submission key, so a repeated send creates one ticket. Board moves
renumber the target column's ranks without touching the revision (a layout
change).

## Identity requests

`identity/iam.ts` calls the API that
[IAM](https://github.com/projecttogether/iam) offers other apps
(`<url>/api/integration/v1/identity-requests`, IAM's `docs/api.md`) with
the stored API key. `identity/service.ts` saves a send before calling IAM
(status `sending`, the exact details in `payload`; the dialog's submission
key is the row's id and IAM's `externalId`, `helpdesk:<id>`) and delivers
it: the send itself, "Send again", and the worker every 5 minutes, always
with the stored details, so IAM keeps one request (IAM also refuses the
reference with other details). Each delivery holds the row's lock while it
asks IAM and writes the answer, so two deliveries of one request never
overlap (the worker skips a locked row). IAM's confirmation sets `iam_id`, drops the
payload and records `identity_requested`; a refusal (422, or 409
`reference_reused` / `request_closed`) marks it `refused` (never deleted;
the send answers `iam_refused` with IAM's field messages, and the dialog
sends the corrected details under a new key); no
clear answer keeps it `sending` with `last_error`, and after a day Sentry
gets one error. `syncIdentityRequests` (worker) also asks IAM about
requests that are open or approved without ready accounts (`active`). Each
answer is saved under the row's lock and only when it is about this row
(`externalId`) and not older than what the row knows (a decided request
never opens again). A cancel first checks that the request at that ID is
still this row's. The stored API key goes only to the address it was
entered for: changing the address needs the key again.

## Notifications

`Outbox.flush` writes the rows (leaving out channels that are not set up)
and calls `pg_notify`. The worker claims due rows with `FOR UPDATE SKIP
LOCKED` and a lease, sends them through `notifications/transports.ts` (SMTP
with nodemailer, MailerSend's API, Slack's Web API), and retries temporary
failures with backoff (5 attempts); permanent ones (a bad token, a rejected
address) fail at once. A Slack direct message finds the person by email and
falls back to an email.

## Restarts and deploys

A deploy may restart `web` and `worker` at any time (SIGTERM, then SIGKILL
after `stop_grace_period`).

- **web** stops taking connections, lets the requests in progress finish,
  and closes the database pool. Every change is one transaction, so a
  request cut short saves nothing; creating a ticket uses a submission key,
  so sending again creates one ticket.
- **worker** stops claiming notifications (`deliverDue` gets its stop
  signal): the send in progress finishes and its outcome is saved, the rest
  stay `pending` for the next worker. A row whose process was killed during
  its send keeps its lease and is sent again when the lease ends (2
  minutes); this is the only case in which a message can arrive twice.
  Scheduled jobs stop after the run in progress. Identity requests need
  nothing more: each delivery sends the stored details under the same
  reference.

## Database restarts

PostgreSQL restarts now and then, for example during a server's updates.
The worker (sending, directory sync, removing old notifications) and the
web process's removal of unused uploads then log a warning and try again
after 5, 10, 20, then every 30 seconds (`db/outage.ts`); a scheduled job
tries for up to 5 minutes, then waits for its next run. A notification
claimed when the connection dropped keeps its lease and is sent again when
the lease ends (2 minutes). A database unreachable for more than 5 minutes
is an error in Sentry, once per outage. Other errors are reported as
before.

## Sign-in and roles

Better Auth runs the OpenID Connect flow (generic OAuth, PKCE). Before a
session starts, the directory module (`directory/index.ts`) decides the role:
from the Keycloak Admin API (`DIRECTORY=keycloak`) or from the groups claim of
the verified ID token or the userinfo response (`DIRECTORY=oidc`), with
`SUPERADMIN_EMAILS` first. No role, no session. With Keycloak, it also syncs
everyone in the groups every 15 minutes. Only this module reads `DIRECTORY`.
`auth/resolve.ts` turns a session into the request's principal and checks the
role on every request.

## Web app

`apps/web/src/modules/<area>` holds each area's routes, pages, queries and
texts (`requests`, `board`, `tickets`, `form-editor`, `people`,
`integrations`, `audit`, `profile`). `routes/app.tsx` loads the signed-in
person and gates pages by role (`requireRole`); the server checks access
again on every request.

## Sentry

Errors, warnings and errors as logs, traces (with
`SENTRY_TRACES_SAMPLE_RATE`) and cron check-ins. `redactErrorReport` and
`redactLog` in `packages/shared/src/error-reports.ts` keep only code
locations, error types, ids and codes: no personal data, request data or
error messages. The Deploy workflow's builds upload source maps found by
debug IDs (`scripts/inject-debug-ids.mjs`).
