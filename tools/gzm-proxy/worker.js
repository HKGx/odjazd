import { connect } from "cloudflare:sockets";
import { DurableObject } from "cloudflare:workers";

/*
 * Cloudflare Worker relay for ZTM GZM's GTFS-RT feeds on :5443.
 *
 * GZM's firewall drops German (`DE`) egress IPs — including Cloudflare's
 * Frankfurt PoP when invoked from a Frankfurt server — while allowing `US` and
 * `PL`. A Durable Object created with `locationHint: "enam"` pins the outbound
 * `cloudflare:sockets` TLS connection to US-East.
 */

const host = "gtfsrt.transportgzm.pl";
const port = 5443;
const allowed = new Set(["/gtfsrt/gzm/vehiclePositions", "/gtfsrt/gzm/tripUpdates"]);

const findHeaderEnd = (bytes) => {
  for (let i = 0; i <= bytes.length - 4; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) {
      return i;
    }
  }
  return -1;
};

const fetchUpstream = async (pathname) => {
  const socket = connect({ hostname: host, port }, { secureTransport: "on" });
  await socket.opened;
  const writer = socket.writable.getWriter();
  await writer.write(
    new TextEncoder().encode(
      `GET ${pathname} HTTP/1.0\r\nHost: ${host}\r\nConnection: close\r\n\r\n`,
    ),
  );
  writer.releaseLock();

  const chunks = [];
  let total = 0;
  for await (const chunk of socket.readable) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const raw = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    raw.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const headerEnd = findHeaderEnd(raw);
  if (headerEnd < 0) return new Response("bad upstream response", { status: 502 });
  const statusLine = new TextDecoder().decode(raw.subarray(0, headerEnd)).split("\r\n")[0] ?? "";
  const status = Number(statusLine.split(" ")[1]) || 502;
  return new Response(raw.subarray(headerEnd + 4), {
    status,
    headers: {
      "content-type": "application/x-protobuf",
      "cache-control": "public, max-age=15",
    },
  });
};

export class Relay extends DurableObject {
  async fetch(request) {
    return fetchUpstream(new URL(request.url).pathname);
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (!allowed.has(pathname)) return new Response("not found", { status: 404 });
    if (env.RELAY !== undefined) {
      const id = env.RELAY.idFromName("enam");
      return env.RELAY.get(id, { locationHint: "enam" }).fetch(request);
    }
    return fetchUpstream(pathname);
  },
};
