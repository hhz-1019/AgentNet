import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const file = resolve(".env.eigenflux");
let source;
try {
  source = await readFile(file, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  source = await readFile(
    new URL("../runtime.env.example", import.meta.url),
    "utf8",
  );
}
for (const name of [
  "POSTGRES_PASSWORD",
  "REDIS_PASSWORD",
  "CONSOLE_V2_BOOTSTRAP_SECRET",
  "CONSOLE_V2_OTP_PEPPER",
]) {
  source = source.replace(
    new RegExp(`^${name}=\\s*$`, "m"),
    `${name}=${randomBytes(32).toString("hex")}`,
  );
}
await writeFile(file, source, { mode: 0o600 });
console.log(
  `Private configuration prepared: ${file}\nFill the DeepSeek API key and Bailian embedding fields (UID accounts need no email service), then run npm run core:check. Generated secrets are not printed.`,
);
