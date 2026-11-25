import os from "node:os";
import path from "node:path";

/**
 * Environment of every test process. Integration tests use TEST_DATABASE_URL
 * (default: the helpdesk_test database of compose.dev.yaml).
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://helpdesk:helpdesk@localhost:55448/helpdesk_test";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.APP_URL = "http://localhost:3000";
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-1234";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.LOG_LEVEL = "silent";
process.env.OIDC_ISSUER ??= "http://localhost:8102/realms/helpdesk";
process.env.OIDC_CLIENT_ID ??= "helpdesk";
process.env.OIDC_CLIENT_SECRET ??= "test-client-secret";
process.env.SUPERADMIN_EMAILS ??= "root@example.org";
process.env.ATTACHMENTS_DIR ??= path.join(os.tmpdir(), `helpdesk-test-${process.pid}`);
process.env.SLACK_API_URL ??= "http://slack.test/api/";
process.env.MAILERSEND_API_URL ??= "http://mailersend.test/v1/";
