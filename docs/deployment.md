# Deployment

For the person who runs the helpdesk on a Linux server, such as a VPS with
Debian or Ubuntu: requirements, [setup](#setup),
[settings from the command line](#settings-from-the-command-line),
[upgrades](#upgrades), [builds and deploys](#builds-and-deploys), backups,
Sentry and logs. Every environment variable is described in
[Configuration](configuration.md); the form, categories, email and Slack
are set up afterwards in the app ([Admin guide](admin-guide.md)).

## Requirements

- **A server with Debian 12 or later** (or a similar system with systemd and
  apt, such as Ubuntu 24.04), with Docker Engine and its Compose plugin, and
  a domain name that points at it.
- **PostgreSQL 16 or later**: a database of your own, or the one
  `compose.postgres.yaml` adds.
- **Caddy** (or another reverse proxy on the server) that terminates HTTPS.
- **An OpenID Connect provider** for sign-in whose groups decide the roles:
  Keycloak, or any provider that puts groups into the sign-in
  ([Identity and access](identity-and-access.md)).
- **Disk space for uploaded files** (a volume; up to 10 MB per file).
- Outgoing connections to your mail server or MailerSend, and to Slack.

## What runs

The [Deploy workflow](#builds-and-deploys) builds the image
`ghcr.io/projecttogether/helpdesk` (linux/amd64) from every commit on `main`
that passes CI, tagged `sha-<commit>` and `latest`. There are no numbered
releases: the commit is the version. `HELPDESK_IMAGE_TAG` in `.env` picks
the image: `latest` (the default) or `sha-<commit>` for one build.

| File                    | Contains                                                                          |
| ----------------------- | --------------------------------------------------------------------------------- |
| `Dockerfile`            | The image. Its command (`all`, `web`, `worker`, `migrate`, `cli`) picks the role. |
| `compose.yaml`          | A one-off `migrate`, the web app (`web`) and the `worker`.                        |
| `compose.postgres.yaml` | Adds a PostgreSQL 18 container, for servers without a database of their own.      |

The image runs as an unprivileged user (uid 1000). `web` listens on port
3000, published on `127.0.0.1:3000` for a reverse proxy on the same machine;
`HELPDESK_PORT` changes the host port. With several apps on one server, give
each its own port and its own site in the Caddyfile. Uploaded files are
stored in the volume `attachments` (`/data/attachments` in the container),
the database of `compose.postgres.yaml` in the volume `postgres`.

### One container

Platforms that run a single image (no Compose) can use the command `all`
with `RUN_MIGRATIONS=true`: the web app and the worker then share one
process. Mount a volume at `/data/attachments`.

## Setup

On a server with Debian 12 or later, or a similar system such as Ubuntu,
run the commands as root (`sudo -i`).

1. **Docker:** install Docker Engine and the Compose plugin from Docker's
   apt repository ([Debian](https://docs.docker.com/engine/install/debian/),
   [Ubuntu](https://docs.docker.com/engine/install/ubuntu/)), and Git:
   `apt install git`.
2. **Get the files:**

   ```sh
   git clone https://github.com/projecttogether/helpdesk.git /srv/helpdesk
   cd /srv/helpdesk
   ```

3. **Register the app at your provider** with the redirect URL
   `<APP_URL>/api/auth/callback/oidc` ([Identity and access](identity-and-access.md)).
4. **Create `.env`** from `.env.example` (`cp .env.example .env`,
   `chmod 600 .env`) and set production values: `APP_URL`, `DATABASE_URL`,
   new secrets (`openssl rand -base64 32` for `AUTH_SECRET` and
   `ENCRYPTION_KEY`), the `OIDC_*` values, `DIRECTORY` and the groups
   ([Identity and access](identity-and-access.md)), and your address in
   `SUPERADMIN_EMAILS`. Remove `NODE_ENV=development` and `RUN_MIGRATIONS`.
   Without a database of your own, add
   `COMPOSE_FILE=compose.yaml:compose.postgres.yaml`, a `POSTGRES_PASSWORD`
   (`openssl rand -hex 32`) and
   `DATABASE_URL=postgres://helpdesk:<POSTGRES_PASSWORD>@postgres:5432/helpdesk`.
5. **Start:** `docker compose up -d --pull always`.
6. **HTTPS:** point the domain's DNS at the server, install Caddy
   (`apt install caddy`), and put this site into `/etc/caddy/Caddyfile`, in
   place of the package's example site `:80` and next to the sites of other
   apps:

   ```text
   helpdesk.example.org {
   	reverse_proxy 127.0.0.1:3000
   }
   ```

   Then `systemctl reload caddy`. Caddy gets the certificate itself. With
   `HELPDESK_PORT` set, use that port instead of 3000.

7. Open `APP_URL` and sign in.
8. **Continue in the app** ([Admin guide](admin-guide.md)): set up email and
   Slack, then the categories and the form. Email, Slack and IAM can also
   be set on the server instead:
   [Settings from the command line](#settings-from-the-command-line).

## Settings from the command line

What superadmins set under **Integrations** (email, Slack, IAM)
can also be set on the server, without a browser, with `cli settings`. It
runs the same code as the page: the same checks, the same encryption, and
an entry in the audit log with the actor `operator` and the command. In
`/srv/helpdesk`:

```sh
docker compose run --rm -T migrate cli settings list
```

In a running container, the command is just `cli …`
(`docker compose exec web cli settings list`).

| Command                                  | What it does                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `cli settings list [--json]`             | Each setting: `set`, `not set` or `incomplete`, with hints such as `password …a1b2`  |
| `cli settings show <name>`               | The setting as JSON, as the page reads it: secrets only as hints                     |
| `cli settings show slack --channels`     | The channels the Slack bot can see, with their IDs                                   |
| `cli settings apply <name>`              | Saves the JSON body on stdin, as the page's **Save** does; prints what `show` prints |
| `cli settings test <name>`               | What the page's test button does                                                     |
| `cli settings test email --to <address>` | Sends a test email to the address                                                    |
| `cli help`                               | The commands and the setting names                                                   |

- Secrets go only in the body on stdin, never in an argument (arguments show
  in `ps` and the shell history). Nothing prints a saved secret.
- `apply` replaces the whole setting, as the page does: start from what
  `show` prints. As on the page, an empty or missing secret keeps the saved
  one.
- Exit codes: `0` done; `1` refused, with the page's message and the field
  on stderr; `2` a wrong command or a body that is not JSON.
- The helpdesk has no lists of settings and issues no tokens, so there is no
  `cli settings remove` and no `cli tokens`.

The bodies, as the Integrations page sends them:

`email` over SMTP (`security`: `tls` on port 465, `starttls` on 587, or
`none`). `{"provider": "none"}` turns email off.

```json
{
  "provider": "smtp",
  "fromAddress": "helpdesk@example.org",
  "fromName": "Helpdesk",
  "smtp": {
    "host": "mail.example.org",
    "port": 587,
    "security": "starttls",
    "username": "helpdesk@example.org",
    "password": "<password>"
  }
}
```

`email` over MailerSend:

```json
{
  "provider": "mailersend",
  "fromAddress": "helpdesk@example.org",
  "fromName": "Helpdesk",
  "mailersend": { "token": "<API token>" }
}
```

`slack`: the bot token (`xoxb-…`) and the channel for new tickets, an ID
from `cli settings show slack --channels`. `"botToken": ""` keeps the saved
token; `"botToken": null` disconnects Slack.

```json
{ "botToken": "<bot token>", "channelId": "C0123456789" }
```

`iam`: IAM's address, the API key (`iam_…`) and which question of the form
fills which field of a request (question IDs; `cli settings show iam` shows
the current ones, and the fields left out stay empty). `"apiKey": null`
removes the key.

```json
{
  "url": "https://iam.example.org",
  "apiKey": "<API key>",
  "mapping": { "firstName": "first_name", "lastName": "last_name", "personType": "person_type" }
}
```

Then test it: `cli settings test slack`, `cli settings test iam`, or
`cli settings test email --to you@example.org`.

An AI with access to the server sets a key this way: it receives the secret
as a file, pipes the body into `cli settings apply`, runs
`cli settings test` and deletes the file. With `jq`, the secret never
appears in an argument:

```sh
jq -n --rawfile token slack-token '{botToken: ($token | rtrimstr("\n")), channelId: "C0123456789"}' \
  | docker compose run --rm -T migrate cli settings apply slack
docker compose run --rm -T migrate cli settings test slack
rm slack-token
```

## Health checks

- `GET /-/livez`: the web process runs.
- `GET /-/readyz`: it reaches the database.
- The worker touches `/tmp/worker-heartbeat` every few seconds (at least
  every 30 seconds while PostgreSQL restarts); `compose.yaml` checks its age.

## Upgrades

An upgrade pulls a newer image. In `/srv/helpdesk`:

1. Read the pull requests merged since the running commit (superadmins see
   it in **My settings** under **About**). A pull request labeled
   `breaking` says what to do; take those steps.
2. Run `git pull` for the newest `compose.yaml`, then
   `docker compose up -d --pull always`. With `HELPDESK_IMAGE_TAG` pinned to
   `sha-<commit>`, set the new commit first.

The `migrate` service applies database migrations before `web` and
`worker` start.

### Restarts

An upgrade or a deploy may restart `web` and `worker` at any time:

- **Emails and Slack messages** wait in the database until the worker has
  sent them. A stop lets the message on its way finish and be recorded,
  then the worker takes no other; `compose.yaml` gives it a minute for that
  (`stop_grace_period`). The next worker sends the rest. Only when a
  message's send outlasts that minute, and the worker is killed after the
  mail server or Slack took it, can that message arrive twice.
- **Identity requests** are saved before IAM is asked, and always sent
  under the same reference, so IAM keeps one request whatever a restart
  cuts short; the worker sends what is not confirmed yet.
- **Requests and replies** are saved in one transaction each; a request
  cut short by the restart saves nothing, and sending the form again creates
  one ticket.

## Builds and deploys

Every commit on `main` that passes CI is built and, at ProjectTogether,
deployed. There are no numbered releases: the commit is the version.

- **CI** (`.github/workflows/ci.yaml`, on every pull request and on `main`):
  the history for secrets (Gitleaks), the files for private artifacts,
  internal names and credential formats (`scripts/check-public-repository.mjs`),
  lint, formatting, types, unit tests, migration drift, the build, the audit
  of the production dependencies, the integration tests (PostgreSQL,
  Mailpit), the browser tests (Keycloak), and the image (started with
  `compose.yaml`).
- **Deploy** (`.github/workflows/deploy.yml`), when CI passes on `main`, or
  by hand (Actions → Deploy → Run workflow), for example after a setting
  changed:
  1. It builds `ghcr.io/projecttogether/helpdesk` with `APP_VERSION` set to
     the first 12 characters of the commit and pushes it as `sha-<commit>`
     and `latest`.
  2. It sends the image and the app's settings to the server of the GitHub
     environment `production` over SSH. The server's deploy script pulls the
     image, writes the settings, runs the migrations, starts `web` and
     `worker`, waits until both are healthy, and puts the previous image and
     settings back when they do not become healthy. One deploy runs at a
     time; a newer one waits.

Without the variable `DEPLOY_HOST` in the environment `production`, step 2
deploys nothing. Label a pull request `breaking` when the people who run the
app must act on it, and write the steps into its description; merging
deploys it, so take steps that must come first before merging.

The package `helpdesk` in GitHub's container registry must be public, so
that servers can pull it without a token: an owner of the organization sets
that once, after the first build.

### Settings

The settings come from two places:

- **Server settings**, written on the server by its own configuration
  (ProjectTogether's infrastructure repository): `APP_URL`, `DATABASE_URL`,
  `TZ`, `TRUST_PROXY`, `ENCRYPTION_KEY`, `AUTH_SECRET`, and
  `POSTGRES_PASSWORD` with `compose.postgres.yaml`. They win over the app
  settings.
- **App settings**, sent by the Deploy workflow at each deploy from the
  environment `production`: every other variable of
  [Configuration](configuration.md) that the app reads, as the workflow's
  `SETTINGS` list names them. Empty values are left out, so the app's
  default applies. A new setting needs a line in `SETTINGS` and its own line
  below it.

| Kind      | Names                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secrets   | `DEPLOY_SSH_KEY`, `OIDC_CLIENT_SECRET`, `KEYCLOAK_CLIENT_SECRET`, `SUPERADMIN_EMAILS`, `SENTRY_DSN`                                                                                                                                                                                                                                                                                                                             |
| Variables | `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS`, `APP_URL` (the environment's link only), `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_PROVIDER_NAME`, `OIDC_SCOPES`, `OIDC_PKCE`, `DIRECTORY`, `OIDC_GROUPS_CLAIM`, `GROUP_REQUESTERS`, `GROUP_OPERATORS`, `GROUP_ADMINS`, `GROUP_SUPERADMINS`, `KEYCLOAK_CLIENT_ID`, `DIRECTORY_SYNC_MINUTES`, `APP_NAME`, `LOG_LEVEL`, `DATABASE_POOL_SIZE`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE` |

`SUPERADMIN_EMAILS` is a secret although it holds no key: run logs show
variables, and it holds people's addresses. The build reads one more
secret, of the repository or the organization, not of the environment:
`SENTRY_AUTH_TOKEN` ([Sentry](#error-reports-and-performance-data-sentry)).
Elsewhere, `compose.yaml` with a plain `.env` holds both kinds of settings
([Setup](#setup)).

### Rollbacks

A deploy that does not become healthy puts the previous image back by
itself. To go back by hand, revert the change on `main`, or run the server's
rollback. Neither undoes database migrations, so a migration keeps the
previous version working: add columns with a database default.

## Backups

Back up together:

- the PostgreSQL database (`pg_dump`, or the `postgres` volume),
- the `attachments` volume (uploaded files; the database refers to them),
- `ENCRYPTION_KEY`, kept separately. Without it the database still works,
  but the stored SMTP password, the MailerSend and Slack tokens and IAM's
  API key must be entered again.

## Error reports and performance data (Sentry)

With `SENTRY_DSN` set, the server and the web app send error reports to
Sentry (or a compatible service). The release is `helpdesk@<commit>` for
the images of the Deploy workflow, unless `SENTRY_RELEASE` is set, so
reports link to the code. The Deploy workflow uploads the source maps to the
Sentry project `projecttogether/helpdesk` when the secret
`SENTRY_AUTH_TOKEN` (an organization token) is set; without it, nothing is
uploaded.

- **Errors:** crashes, failed requests and errors the server logs, from the
  server and from browsers.
- **Performance:** set `SENTRY_TRACES_SAMPLE_RATE` (e.g. `0.2`) to trace
  that share of requests and page loads: server routes, database queries,
  calls to Slack and the mail service, and the page loads and navigations
  that started them.
- **Logs:** warnings and errors of the server.
- **Cron monitors:** the scheduled jobs check in (`helpdesk-directory-sync`,
  `helpdesk-prune-uploads`, `helpdesk-prune-notifications`,
  `helpdesk-identity-requests`), so Sentry
  raises an alert when one stops running or keeps failing. Sentry creates
  the monitors at the first check-in.

Reports never contain ticket texts, answers, names, email addresses,
request data or variables; error messages are left out because database
errors can quote values. There are no session replays.

## Logs

Every process logs JSON lines to standard output (`docker compose logs
worker`). Logs carry identifiers (ticket, notification, error codes), never
ticket texts or email addresses. Useful lines: `directory synced`, `access
checked at sign-in` (with the role), `notification handled` and
`notification not sent` (with the channel and the provider's error code).

The superadmins' **Integrations** page lists recent deliveries with their
state and last error.

## Hardening

- Serve the app over HTTPS only.
- Use your organization's own identity provider, where people cannot choose
  their email address or groups themselves.
- Keep `SUPERADMIN_EMAILS` to one or two people: they always have full
  access, whatever their groups.
- Uploaded files are always downloaded, never shown in the browser, and
  only file types on an allow list are accepted.
