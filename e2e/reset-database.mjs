// Creates an empty helpdesk_e2e database on the PostgreSQL of compose.dev.yaml.
import pg from "pg";

const client = new pg.Client({ connectionString: "postgres://helpdesk:helpdesk@localhost:55448/postgres" });
await client.connect();
await client.query("drop database if exists helpdesk_e2e with (force)");
await client.query("create database helpdesk_e2e");
await client.end();
