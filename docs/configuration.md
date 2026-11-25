# Configuration

Every environment variable. Blank values count as unset. Email, Slack,
IAM, the form and the categories are set up in the app, not here
([Admin guide](admin-guide.md)); email, Slack and IAM also with
`cli settings` on the server
([Deployment](deployment.md#settings-from-the-command-line)).

## Required

| Variable             | Description                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection, e.g. `postgres://helpdesk:secret@db:5432/helpdesk`.                  |
| `APP_URL`            | The public address, e.g. `https://helpdesk.example.org`. Links in emails use it.            |
| `AUTH_SECRET`        | Signs sessions; at least 32 characters (`openssl rand -base64 32`).                         |
| `ENCRYPTION_KEY`     | Encrypts the stored SMTP password and tokens; 32 bytes, base64 (`openssl rand -base64 32`). |
| `OIDC_ISSUER`        | The sign-in provider's issuer URL, e.g. `https://auth.example.org/realms/acme`.             |
| `OIDC_CLIENT_ID`     | The client registered there.                                                                |
| `OIDC_CLIENT_SECRET` | Its secret.                                                                                 |

## Sign-in and roles

See [Identity and access](identity-and-access.md).

| Variable                 | Default                 | Description                                                                                             |
| ------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `DIRECTORY`              | `oidc`                  | Where roles come from: `keycloak` (Admin API) or `oidc` (the groups claim of the sign-in).              |
| `GROUP_REQUESTERS`       | `/helpdesk/employees`   | Members (and members of subgroups) may send requests. `-` turns the role off.                           |
| `GROUP_OPERATORS`        | `/helpdesk/operators`   | Operators work on tickets.                                                                              |
| `GROUP_ADMINS`           | `/helpdesk/admins`      | Admins also edit the form and categories.                                                               |
| `GROUP_SUPERADMINS`      | `/helpdesk/superadmins` | Superadmins also set up email, Slack and the directory.                                                 |
| `SUPERADMIN_EMAILS`      |                         | Comma-separated addresses that are always superadmins: the first sign-in and the way back in.           |
| `OIDC_GROUPS_CLAIM`      | `groups`                | `DIRECTORY=oidc`: the claim with the groups; a dotted name reads a nested claim (`realm_access.roles`). |
| `KEYCLOAK_CLIENT_ID`     | `OIDC_CLIENT_ID`        | `DIRECTORY=keycloak`: the client whose service account reads users and groups.                          |
| `KEYCLOAK_CLIENT_SECRET` | `OIDC_CLIENT_SECRET`    | Its secret.                                                                                             |
| `DIRECTORY_SYNC_MINUTES` | `15`                    | `DIRECTORY=keycloak`: how often everyone's roles are synced (also at each sign-in).                     |
| `OIDC_PROVIDER_NAME`     | `single sign-on`        | Shown on the sign-in button ("Sign in with …").                                                         |
| `OIDC_SCOPES`            | `openid email profile`  | Scopes to request; add `groups` if your provider needs it for the groups claim.                         |
| `OIDC_PKCE`              | `true`                  | Proof Key for Code Exchange; turn off only for providers that reject it.                                |

## The app

| Variable                | Default                              | Description                                                                                       |
| ----------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `APP_NAME`              | `Helpdesk`                           | Shown in the app, emails and Slack messages.                                                      |
| `ATTACHMENTS_DIR`       | `.data/attachments`                  | Where uploaded files are stored; `/data/attachments` in the image. Keep it on a backed-up volume. |
| `APP_ROLE`              | `all`                                | `all`, `web`, `worker` or `migrate`; the image's command sets it.                                 |
| `RUN_MIGRATIONS`        | `false`                              | Apply migrations at start (single-container setups).                                              |
| `TRUST_PROXY`           | `false`                              | Reverse proxies in front that append to `X-Forwarded-For`: `true` (one), a number, or `false`.    |
| `PORT`, `HOST`          | `3000`, `0.0.0.0`                    | Where the web process listens.                                                                    |
| `DATABASE_POOL_SIZE`    | `10`                                 | Database connections per process.                                                                 |
| `LOG_LEVEL`             | `info`                               | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`.                                   |
| `WORKER_HEARTBEAT_FILE` | `/tmp/worker-heartbeat` in the image | The worker touches it for health checks.                                                          |
| `APP_VERSION`           | the commit in the image              | The version: the first 12 characters of the commit; the Deploy workflow builds it in.             |
| `TZ`                    | `UTC`                                | The containers' time zone.                                                                        |

## Sentry

| Variable                    | Default              | Description                                                              |
| --------------------------- | -------------------- | ------------------------------------------------------------------------ |
| `SENTRY_DSN`                |                      | Error reports, logs and performance data to Sentry; off when unset.      |
| `SENTRY_ENVIRONMENT`        | `NODE_ENV`           | E.g. `production`.                                                       |
| `SENTRY_RELEASE`            | `helpdesk@<version>` | The images of the Deploy workflow set the version (`APP_VERSION`).       |
| `SENTRY_TRACES_SAMPLE_RATE` | `0`                  | Share of requests and page loads traced (0 to 1); `0` turns tracing off. |

## Docker Compose

| Variable             | Description                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `HELPDESK_IMAGE_TAG` | The image to run: `latest` (the newest commit on `main`, the default) or `sha-<commit>` for one build. |
| `HELPDESK_PORT`      | Host port of `web` on `127.0.0.1` (default `3000`), for the reverse proxy.                             |
| `POSTGRES_PASSWORD`  | With `compose.postgres.yaml`.                                                                          |

Which of these settings a ProjectTogether server writes itself and which
come with each deploy: [Deployment](deployment.md#settings).

## Tests only

`SLACK_API_URL` and `MAILERSEND_API_URL` point Slack and MailerSend at
stand-ins.
