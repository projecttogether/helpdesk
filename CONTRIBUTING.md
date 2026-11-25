# Contributing

Thanks for helping. This guide covers the development setup, the checks a
change must pass, and how builds and deploys work. `AGENTS.md` has the code
rules; `docs/architecture.md` explains how the parts fit together.

## Development setup

You need Node.js 26 and Docker.

```sh
docker compose -f compose.dev.yaml up -d   # PostgreSQL 18, Keycloak, Mailpit
cp .env.example .env.local
npm ci
npm run dev
```

Open http://localhost:5173 and sign in with one of the test users of
`compose.dev.yaml` (password `helpdesk-dev`): `erin@example.org` is a
requester, `oscar@example.org` an operator, `alma@example.org` an admin and
`ada@example.org` a superadmin; `nora@example.org` has no access. The
Keycloak admin console is at http://localhost:8102 (admin / admin); emails
land in Mailpit at http://localhost:8028 once SMTP is set up in the app
(host `localhost`, port `1028`, security none).

`npm run dev` starts the Vite dev server and the server with `APP_ROLE=all`,
so the worker runs too (emails, Slack, the Keycloak sync every 15 minutes).
Use a test workspace and a separate Slack app for Slack.

`npm run cli -- settings list` runs the operator command against the
development database (`cli help` lists the commands).

## Checks

```sh
node scripts/check-public-repository.mjs
npm run lint
npm run format:check      # npm run format fixes it
npm run typecheck
npm test                  # unit tests
npm run test:integration  # needs the PostgreSQL (and for SMTP, Mailpit) of compose.dev.yaml
npm run build
npm run test:e2e          # needs the whole compose.dev.yaml and a build; see e2e/README.md
```

CI (`.github/workflows/ci.yaml`) runs all of them, scans the history for
secrets, checks that the migrations match the schema, audits the production
dependencies, runs the browser tests against Keycloak, and builds and starts
the Docker image.

## Database changes

Edit `apps/server/src/db/schema/`, run `npm run db:generate`, and commit the
generated migration in `apps/server/drizzle/`. Migrations run before the new
version starts (`migrate` service), so they must work while the old version
still runs for a moment, and after a deploy that fails puts the old version
back: add columns with defaults, don't rename in place.

## Tests

Unit tests sit next to the code (`*.test.ts`). Integration tests
(`*.int.test.ts`) get a fresh database (`TEST_DATABASE_URL`, default
`helpdesk_test` on the development PostgreSQL). Tests never call real
email providers or Slack: stub `fetch`; the SMTP test uses Mailpit when
`MAILPIT_API_URL` is set. End-to-end tests in `e2e/` sign in through the
development Keycloak in a real browser.

## Pull requests

Write the title as one plain line of what changes. Label a pull request
`breaking` when the people who run the helpdesk must act on it, and describe
the steps in it; merging deploys it. Update the docs when behavior or
configuration changes.

## Builds and deploys

Every commit on `main` that passes CI is built and deployed; there are no
releases (`docs/deployment.md`, Builds and deploys). The Deploy workflow
uploads the source maps to the Sentry project `projecttogether/helpdesk`
with the secret `SENTRY_AUTH_TOKEN` (Dockerfile); without the secret, it
uploads nothing.

## Data, secrets and privacy

Never commit secrets, real personal data or data from a real organization,
also not in tests and fixtures. Use `example.org` addresses and invented
content. `scripts/check-public-repository.mjs` rejects private file types,
unknown hosts and email domains, internal names and token formats; add a
host there only when it is public and intended.
