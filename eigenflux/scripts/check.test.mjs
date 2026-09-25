import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { checkConfig } from "./check.mjs";
const env = parseEnv(
  readFileSync(new URL("../runtime.env.example", import.meta.url), "utf8"),
);
Object.assign(env, {
  POSTGRES_PASSWORD: "1".repeat(64),
  REDIS_PASSWORD: "2".repeat(64),
  CONSOLE_V2_BOOTSTRAP_SECRET: "3".repeat(64),
  CONSOLE_V2_OTP_PEPPER: "4".repeat(64),
});
await test("deferred providers permit building, never mark activation ready", () => {
  assert.deepEqual(checkConfig(env, { providers: false }), []);
  assert(checkConfig(env).some((e) => e.includes("LLM_API_KEY")));
  assert(checkConfig(env).some((e) => e.includes("SMTP_PASSWORD")));
});
await test("domestic providers need SMTP credentials, not a Resend key", () => {
  const configured = {
    ...env,
    LLM_API_KEY: "test-key",
    LLM_MODEL: "ep-test",
    EMBEDDING_API_KEY: "test-vector-key",
    EMBEDDING_BASE_URL:
      "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    SMTP_USERNAME: "login@example.com",
    SMTP_PASSWORD: "smtp-test-password",
    SMTP_FROM_EMAIL: "AgentNet <login@example.com>",
  };
  assert.deepEqual(checkConfig(configured), []);
  assert(checkConfig({ ...configured, SMTP_PORT: "25" }).length);
  assert(
    checkConfig({ ...configured, SMTP_FROM_EMAIL: "other@example.com" }).length,
  );
  assert(
    checkConfig({
      ...configured,
      SMTP_FROM_EMAIL: "login@example.com\r\nBcc: other@example.com",
    }).length,
  );
  assert(checkConfig({ ...configured, EMAIL_PROVIDER: "unknown" }).length);
  assert(
    checkConfig({
      ...configured,
      EMBEDDING_BASE_URL:
        "https://<workspace-id>.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    }).length,
  );
  assert(
    checkConfig({ ...configured, EMAIL_PROVIDER: "resend" }).some((e) =>
      e.includes("RESEND_API_KEY"),
    ),
  );
});
await test("defer mode still rejects test OTP and disabled ownership verification", () => {
  assert(
    checkConfig({ ...env, OFFICIAL_TEST_OTP: "654321" }, { providers: false })
      .length,
  );
  assert(
    checkConfig(
      { ...env, ENABLE_EMAIL_VERIFICATION: "false" },
      { providers: false },
    ).length,
  );
});
await test("secrets and origin validation remain mandatory", () => {
  assert(
    checkConfig(
      { ...env, CONSOLE_V2_OTP_PEPPER: env.CONSOLE_V2_BOOTSTRAP_SECRET },
      { providers: false },
    ).length,
  );
  assert(
    checkConfig(
      { ...env, PUBLIC_BASE_URL: "https://example.org/path" },
      { providers: false },
    ).length,
  );
});
