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

const putWorker = async (extra) => {
  const metadata = {
    main_module: "worker.js",
    compatibility_date: "2026-01-01",
    ...extra,
  };
  const form = new FormData();
  form.set("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.set("worker.js", new Blob([source], { type: "application/javascript+module" }), "worker.js");
  return fetch(`${api}/workers/scripts/${name}`, { method: "PUT", headers, body: form });
};

// Step 1: create the SQLite Durable Object namespace on first deploy (no-op if
// migration v1 is already applied). Cloudflare requires the migration to land
// before a self-binding to the class is attached.
await putWorker({
  migrations: { new_tag: "v1", new_sqlite_classes: ["Relay"] },
});

// Step 2: attach the `RELAY` Durable Object binding.
const upload = await putWorker({
  bindings: [{ type: "durable_object_namespace", name: "RELAY", class_name: "Relay" }],
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
