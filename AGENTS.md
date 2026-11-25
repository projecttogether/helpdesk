# AGENTS.md

Helpdesk is ProjectTogether's open-source helpdesk for internal requests:
requesters send one dynamic form (pages and questions with show-if rules),
staff work every ticket on one board, and email and Slack tell people what
happened. User documentation is in `docs/`; contributor setup is in
`CONTRIBUTING.md`; how it works inside is in `docs/architecture.md`.

## Stack

npm workspaces, Node.js 26, strict TypeScript.

- `apps/server`: Hono (API under `/api/v1`), Better Auth (OIDC sign-in under
  `/api/auth`), Drizzle ORM on PostgreSQL, nodemailer, pino logs, Sentry,
  Vitest.
- `apps/web`: Vite + React 19, TanStack Router and Query, Tailwind CSS 4,
  dnd-kit (board), react-hook-form with zod. `src/components/ui/` holds the
  components (shadcn/ui and Radix), the app frame, the page layout, the
  sign-in page and the theme with ProjectTogether's colors (`styles.css`);
  `src/components/brand.tsx` the app icon and ProjectTogether's logo.
  English (US); the request form also in German.
- `packages/shared` (`@helpdesk/shared/*`): zod schemas of the API
  (`api/*.ts`), roles, ticket constants, the form model and its show-if and
  answer rules (`form.ts`, used by both apps), error report redaction.

One Docker image runs every process: `APP_ROLE` = `all | web | worker | migrate`;
its command `cli …` runs the operator command (`cli settings`).

## Layout

```
apps/server/src/
  main.ts          entry; APP_ROLE selects the processes
  cli.ts           entry of the operator command; cli/ has one module per setting name
  instrument.ts    starts Sentry before the app loads (node --import)
  config.ts        every environment variable (zod); read only via config()
  db/schema/       Drizzle schema (auth.ts, app.ts); db/client.ts, db/migrate.ts
  auth/            Better Auth, session → principal
  directory/       roles from groups (index.ts): Keycloak Admin API or groups claim, SUPERADMIN_EMAILS
  tickets/         ticket writes (service.ts), reads (queries.ts), stored answers
  notifications/   outbox (enqueue.ts), templates, transports, delivery
  attachments/     file storage on disk
  worker/          delivery loop and scheduled jobs
  integrations/    email and Slack settings: shared by the routes and cli settings
  http/            app factory, middleware (requireUser/requireStaff/requireAdmin/requireSuperadmin), errors
  modules/         one file per API area: routes
apps/web/src/      web app; modules/<area> holds each area's pages
packages/shared/src/  contracts, roles, tickets, form
```

## Rules

- **Contracts first.** Change a request or response in
  `packages/shared/src/api/` and use it on both sides; routes validate input
  with it (`jsonBody`, `queryOf`).
- **Access:** every route calls `requireUser`, `requireStaff`,
  `requireAdmin` or `requireSuperadmin` first. Requesters only ever see their
  own tickets, never internal notes or their files. Roles come from groups
  only; the app never edits them.
- **The form's rules live in `packages/shared/src/form.ts`.** The browser
  and the server use the same visibility and answer checks; hidden
  questions are never required and their answers are never stored.
- **Ticket changes** go through `tickets/service.ts`: it records events,
  checks the revision (`409 ticket_changed`), and queues notifications in
  the same transaction (`Outbox`). The worker sends them.
- **Restarts:** a deploy may restart `web` and `worker` at any time. The
  worker finishes the send in progress and claims no more (`deliverDue`'s
  stop signal); identity requests are sent under one stored reference. Keep
  that when changing how notifications or identity requests are sent.
- **Secrets** (SMTP password, MailerSend and Slack tokens, IAM's API key)
  are stored with `encryptSecret` (`ENCRYPTION_KEY`) and never returned or
  logged; responses show hints.
- **Settings** of the Integrations page are saved by functions that the
  routes and `cli settings` both call (`integrations/`,
  `identity/settings.ts`); a new setting gets a module in `cli/` too. The
  command takes secrets only on stdin.
- **Environment variables:** document each in `docs/configuration.md`. An
  app setting (not one of the server settings in `docs/deployment.md`,
  Settings) also needs a line in the Deploy workflow's `SETTINGS`.
- **Design:** ProjectTogether's colors and app identity (PT Sky for buttons,
  focus and selected states, with PT Ocean text on it; links in the darker
  `--link`); the tokens are in `apps/web/src/components/ui/styles.css`.
  Keep components close to shadcn/ui (`@/components/ui/<name>`, `cn` from
  `@/components/ui/utils`).
- **Errors:** throw `AppError` helpers (`http/errors.ts`) with short, plain
  messages.
- **Logging:** `logger` with ids and codes; never ticket texts, answers,
  email addresses, tokens or other personal data. No `console.*`, no `any`.
- **Sentry** gets no personal data: `redactErrorReport` and `redactLog`
  decide what reports and logs keep; no session replays.

## Database

Change the schema in `apps/server/src/db/schema/`, then run
`npm run db:generate` and commit the migration. CI fails when they differ.
The running installation's database must keep working: add only migrations
that the previous version survives (new columns with a default), and only
when needed. Stored values (setting keys such as `email`, `slack`, `iam`,
statuses, kinds) stay as they are.

## Tests

- Unit tests next to the code (`*.test.ts`); integration tests
  (`*.int.test.ts`) use the PostgreSQL of `compose.dev.yaml` and
  `src/test/helpers.ts` (`resetDatabase`, `createUser`, `request`).
- API tests sign in with `vi.mock("../auth/resolve", () => import("../test/resolve-mock"))`.
- Email and Slack in tests: stub `fetch` (MailerSend and Slack use
  `MAILERSEND_API_URL` / `SLACK_API_URL`); SMTP against Mailpit. Never call
  real services in tests.
- End-to-end tests (`e2e/`) run a real browser against the built app,
  Keycloak and Mailpit.

## Commands

```sh
docker compose -f compose.dev.yaml up -d   # PostgreSQL (55448), Keycloak (8102), Mailpit (8028)
cp .env.example .env.local
npm ci
npm run dev                                # web app http://localhost:5173, server :3000

node scripts/check-public-repository.mjs
npm run lint && npm run format:check && npm run typecheck && npm test
npm run test:integration
npm run build && npm run test:e2e
```

Deploys: every commit on `main` that passes CI is built and deployed
(`docs/deployment.md`, Builds and deploys). No file holds the version.

## Content

UI text, emails and Slack messages are in US English; short and plain. Only
texts the request form shows have German too (`de`, with "du"), because admins
choose each form's language. Never commit secrets, real personal data or data from a real
organization: use `example.org` addresses. Keep ProjectTogether's internals
(server names, addresses, internal domains, people, vault names) out of this
repository; they belong in its infrastructure repository.
