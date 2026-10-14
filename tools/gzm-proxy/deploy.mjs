// Deploys `tools/gzm-proxy/worker.js` to Cloudflare Workers via the REST API
// (no wrangler dependency). Needs CF_ACCOUNT_ID and CF_API_TOKEN in the env.
import { readFileSync } from "node:fs";

const accountId = process.env["CF_ACCOUNT_ID"];
const token = process.env["CF_API_TOKEN"];
const name = process.env["CF_WORKER_NAME"] || "odjazd-gzm-proxy";

if (!accountId || !token) {
  console.log("CF_ACCOUNT_ID or CF_API_TOKEN not set; skipping gzm-proxy deploy.");
  process.exit(0);
}

const source =
  process.env["WORKER_SOURCE"] || readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const api = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
const headers = { Authorization: `Bearer ${token}` };

const form = new FormData();
form.set(
  "metadata",
  new Blob(
    [
      JSON.stringify({
        main_module: "worker.js",
        compatibility_date: "2026-01-01",
      }),
    ],
    { type: "application/json" },
  ),
);
form.set("worker.js", new Blob([source], { type: "application/javascript+module" }), "worker.js");

const upload = await fetch(`${api}/workers/scripts/${name}`, {
  method: "PUT",
  headers,
  body: form,
});
if (!upload.ok) {
  throw new Error(`Worker upload failed (${upload.status}): ${await upload.text()}`);
}

await fetch(`${api}/workers/scripts/${name}/subdomain`, {
  method: "POST",
  headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify({ enabled: true }),
});

console.log(`Deployed worker ${name}`);
