# End-to-end tests

A real browser against the built app, signing in through Keycloak.

```sh
docker compose -f compose.dev.yaml up -d   # PostgreSQL, Keycloak, Mailpit
npm run build
npx playwright install chromium            # once
npm run test:e2e
```

The app runs on port 3000 with a fresh database (`helpdesk_e2e`) and
`DIRECTORY=keycloak`; emails go to Mailpit (http://localhost:8028). The test
users are listed in `compose.dev.yaml`.
