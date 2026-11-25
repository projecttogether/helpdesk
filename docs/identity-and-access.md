# Identity and access

People sign in through one OpenID Connect provider. Their groups there
decide their role; the app never edits roles.

## Roles

| Role       | May                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------ |
| Requester  | Send requests, see their own requests (not internal notes), reply.                         |
| Operator   | Also: the board and every ticket, assignment, replies and internal notes, record requests. |
| Admin      | Also: edit the form and the categories, see people and the directory status.               |
| Superadmin | Also: set up email and Slack, sync the directory, read the audit log.                      |

Each role has a group (`GROUP_REQUESTERS`, `GROUP_OPERATORS`, `GROUP_ADMINS`,
`GROUP_SUPERADMINS`). Members of a group and of its subgroups get its role;
a person in several groups gets the highest. Someone in none of the groups
cannot sign in. Operators, admins and superadmins can be assigned to
tickets; every one of them sees every ticket.

Addresses in `SUPERADMIN_EMAILS` are always superadmins, whatever their
groups: use it for the first sign-in and as the way back in.

## Sign-in

Register a client at the provider with this redirect URL:

```
<APP_URL>/api/auth/callback/oidc
```

and set `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`. The
provider must return an ID token and the email address (scopes `openid email
profile`). Helpdesk keeps the account tied to the same provider subject. Its
discovery document must include `issuer` and `jwks_uri` so the app can verify
ID tokens.

The app trusts the provider's email address and groups. Use your
organization's own provider, where people cannot choose their address or
groups themselves.

## Keycloak (`DIRECTORY=keycloak`)

The app reads the role groups through the Keycloak Admin API: every
`DIRECTORY_SYNC_MINUTES` (default 15) for everyone, and at each sign-in for
the person signing in. Everyone in the groups can be assigned to tickets
right away, before their first sign-in; someone removed from the groups
loses access at the next sync or sign-in.

1. Create the groups, e.g. `/helpdesk/employees`, `/helpdesk/operators`,
   `/helpdesk/admins` and `/helpdesk/superadmins`, and set the `GROUP_*`
   variables to their paths. To let the whole organization send requests,
   point `GROUP_REQUESTERS` at a group everyone is in.
2. Create a confidential OpenID Connect client (standard flow) with the
   redirect URL above.
3. In the client, turn on **Service account roles**, and under **Service
   account roles** assign the role `view-users` of the client
   `realm-management`. (Or use another client for this:
   `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`.)
4. Keycloak 26.8.2 and later: under that client's **Client scopes**, add
   `kc-admin-api` as a **Default** scope. The Admin API refuses tokens
   without the audience it adds (HTTP 401).
5. Set `DIRECTORY=keycloak` and `OIDC_ISSUER=https://<host>/realms/<realm>`.

Superadmins can check the connection and start a sync on the **People**
page. When the Admin API cannot be reached at a sign-in, the person keeps
the role they had; someone the app does not know yet cannot sign in.

Upgrading Keycloak to 26.8.2 or later does not add `kc-admin-api` to
existing clients. Add it (step 4) when you upgrade; until then roles stop
changing, the sync fails with HTTP 401, and people the app does not know
yet cannot sign in.

## Other providers (`DIRECTORY=oidc`)

The app reads the groups claim of each sign-in (`OIDC_GROUPS_CLAIM`, default
`groups`), from the ID token or, when it is not there, from the userinfo
endpoint. UserInfo must identify the same person as the ID token. If the
app cannot verify the groups from UserInfo, it refuses the new sign-in.
People appear in the app, and can be assigned, after their first
sign-in. A changed group takes effect at the next sign-in, which the app
requires after at most a week.

Set the `GROUP_*` variables to the values the claim holds:

| Provider           | Groups claim                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Keycloak           | Client scope or mapper "Group Membership", claim `groups`, full group path on: values like `/helpdesk/operators`.                     |
| Microsoft Entra ID | Token configuration → groups claim: values are group object IDs (set `GROUP_*` to them), or app roles with `OIDC_GROUPS_CLAIM=roles`. |
| Authentik          | Scope `profile` includes `groups` (group names).                                                                                      |
| Authelia, Zitadel  | Request the groups scope (`OIDC_SCOPES=openid email profile groups`); check the claim name in the provider's documentation.           |

A group value counts for a configured group when it is the same, or a
subgroup path below it (`/helpdesk/operators/finance` counts for
`/helpdesk/operators`). Leading and trailing slashes do not matter.
