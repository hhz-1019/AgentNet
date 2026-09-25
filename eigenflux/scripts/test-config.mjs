import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { randomBytes } from "node:crypto";
const env = parseEnv(
  await readFile(new URL("../runtime.env.example", import.meta.url), "utf8"),
);
for (const key of [
  "POSTGRES_PASSWORD",
  "CONSOLE_V2_BOOTSTRAP_SECRET",
  "CONSOLE_V2_OTP_PEPPER",
])
  env[key] = randomBytes(32).toString("hex");
Object.assign(env, {
  APP_ENV: "test",
  PUBLIC_BASE_URL: "http://127.0.0.1:4326",
  CONSOLE_V2_PUBLIC_URL: "http://127.0.0.1:4326",
  LLM_BASE_URL: "http://127.0.0.1:9/v1",
  EMBEDDING_BASE_URL: "http://127.0.0.1:9/v1",
  SAFETY_LLM_BASE_URL: "http://127.0.0.1:9/v1",
});
await writeFile(
  ".env.eigenflux.verify",
  Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n",
  { mode: 0o600 },
);
console.log(
  "Created isolated loopback-only test configuration. Never deploy this file publicly.",
);
