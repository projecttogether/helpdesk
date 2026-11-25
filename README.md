# Helpdesk

ProjectTogether's open-source helpdesk for internal requests. People send a
request through one form that asks the right questions for each case;
operators work on every request on one shared board, reply to the requester
and keep internal notes; requesters follow their requests and get emails at
each step.

- **One dynamic form**, edited in the app: pages and questions shown only
  when earlier answers match ("show if"), shown one page at a time. Every
  request has a title, a category and an urgency.
- **One board** with a column per status (New, In progress, Waiting for
  requester, Waiting for others, Done, Canceled), drag and drop, filters by
  category, assignee and urgency, and a searchable list.
- **Tickets**: assignment, due dates, replies and internal notes, files,
  activity history. A requester's reply to a done request reopens it for 14
  days.
- **Roles from your sign-in**: requester, operator, admin and superadmin
  come from Keycloak groups (read through the Admin API) or from the groups
  claim of any OpenID Connect provider.
- **Email and Slack**: requesters get emails when a request is received,
  answered and done; new tickets are posted to a Slack channel; assignees
  hear about their tickets by email or Slack direct message. Email over
  SMTP or MailerSend, set up in the app or with `cli settings` on the
  server.
- **Identity requests to [IAM](https://github.com/projecttogether/iam)**:
  staff ask IAM for a new person from a ticket, with a form filled in from
  its answers; the ticket shows IAM's decision and when the accounts are
  ready.
- **Deploys at any time:** a restart lets the email or Slack message on its
  way finish and sends the rest afterwards, so nothing goes out twice or
  gets lost.
- English (US); request forms in English or German. Light and dark, works on
  phones.

Hono server, React web app and PostgreSQL in one Docker image, with error
reports and performance data for Sentry.

## Documentation

- [Deployment](docs/deployment.md): a Linux server (Debian, Ubuntu),
  settings from the command line, sign-in, upgrades, builds and deploys,
  backups, Sentry.
- [Configuration](docs/configuration.md): every environment variable.
- [Identity and access](docs/identity-and-access.md): roles, Keycloak and
  other providers.
- [Admin guide](docs/admin-guide.md): the form, categories, email, Slack
  and IAM.
- [Architecture](docs/architecture.md): how it works inside.
- [Contributing](CONTRIBUTING.md): development setup and checks.

## Quick start (development)

You need Docker and Node.js 26.

```sh
docker compose -f compose.dev.yaml up -d   # PostgreSQL, Keycloak with test users, Mailpit
cp .env.example .env.local
npm ci
npm run dev
```

Open http://localhost:5173 and sign in as `erin@example.org` (requester),
`oscar@example.org` (operator), `alma@example.org` (admin) or
`ada@example.org` (superadmin), password `helpdesk-dev`. Emails land in
Mailpit at http://localhost:8028 once a superadmin sets up SMTP
(`localhost`, port `1028`, no security) under Integrations.

## License

Copyright 2026 ProjectTogether gGmbH

Licensed under the [Apache License 2.0](LICENSE).
