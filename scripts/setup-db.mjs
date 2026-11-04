// Creates the notes table, its access policy and realtime publication.
// Run once after `vercel env pull`: npm run db:setup
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";

for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const conn = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!conn) {
  console.error("setup-db: POSTGRES_URL missing. Run `vercel env pull .env.local --yes` first.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: conn.replace(/[?&]sslmode=[^&]*/, ""), ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
await client.end();
console.log("setup-db: notes table ready");
