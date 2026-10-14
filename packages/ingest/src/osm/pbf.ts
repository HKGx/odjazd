import { unzlibSync } from "fflate";

/*
 * Streaming reader for OpenStreetMap PBF files
 * (https://wiki.openstreetmap.org/wiki/PBF_Format): a sequence of
 * length-prefixed blobs, each a zlib-compressed protobuf block of nodes, ways
 * or relations. Hand-rolled because the hot loop decodes millions of
 * delta-coded varints and should stay on plain numbers (ids fit in 2^53).
 */

export class OsmFormatError extends Error {
  override readonly name = "OsmFormatError";
}

export interface OsmHeader {
  readonly requiredFeatures: ReadonlyArray<string>;
  readonly optionalFeatures: ReadonlyArray<string>;
  /** Replication timestamp, epoch seconds, if the file carries one. */
  readonly timestamp: number | undefined;
}

export interface OsmVisitor {
  readonly header?: (header: OsmHeader) => void;
  /** One block of nodes; coordinates in microdegrees (rounded). Reused arrays: copy what you keep. */
  readonly nodes?: (ids: Float64Array, lat: Int32Array, lon: Int32Array, count: number) => void;
  /** `tag(key)` reads this way's tag value. `refs` is reused: copy what you keep. */
  readonly way?: (
    id: number,
    refs: Float64Array,
    count: number,
    tag: (key: string) => string | undefined,
  ) => void;
}

/** Minimal protobuf wire reader over numbers. */
class Reader {
  readonly buf: Uint8Array;
  readonly end: number;
  pos: number;
  constructor(buf: Uint8Array, pos = 0, end = buf.length) {
    this.buf = buf;
    this.pos = pos;
    this.end = end;
  }
  get done() {
    return this.pos >= this.end;
  }
  varint(): number {
    let result = 0;
    let scale = 1;
    for (;;) {
      const byte = this.buf[this.pos++] ?? 0;
      result += (byte & 0x7f) * scale;
      if ((byte & 0x80) === 0) return result;
      scale *= 128;
      if (this.pos > this.end) throw new OsmFormatError("truncated varint");
    }
  }
  sint(): number {
    const v = this.varint();
    return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
  }
  /** int64 that may be negative (ten-byte two's complement varint). */
  int(): number {
    const v = this.varint();
    return v >= 2 ** 63 ? v - 2 ** 64 : v;
  }
  bytes(): Reader {
    const length = this.varint();
    const start = this.pos;
    this.pos += length;
    if (this.pos > this.end) throw new OsmFormatError("truncated field");
    return new Reader(this.buf, start, start + length);
  }
  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) {
      // Not `pos += varint()`: that reads `pos` before the length prefix moves it.
      const length = this.varint();
      this.pos += length;
    } else if (wire === 5) this.pos += 4;
    else throw new OsmFormatError(`unsupported wire type ${wire}`);
  }
  string(): string {
    const field = this.bytes();
    return decoder.decode(field.buf.subarray(field.pos, field.end));
  }
}

const decoder = new TextDecoder();

/** Reads blobs off a byte stream: 4-byte big-endian header length, BlobHeader, Blob. */
async function* blobs(chunks: AsyncIterable<Uint8Array>) {
  let buffer = new Uint8Array(0);
  let start = 0;
  const iterator = chunks[Symbol.asyncIterator]();
  // Chunks wait in a list and are joined once there's enough, so a big blob is copied once.
  const fill = async (bytes: number) => {
    if (buffer.length - start >= bytes) return true;
    const pending: Array<Uint8Array> = [buffer.subarray(start)];
    let length = buffer.length - start;
    let ended = false;
    while (length < bytes) {
      const next = await iterator.next();
      if (next.done === true) {
        ended = true;
        break;
      }
      pending.push(next.value);
      length += next.value.length;
    }
    buffer = new Uint8Array(length);
    let at = 0;
    for (const chunk of pending) {
      buffer.set(chunk, at);
      at += chunk.length;
    }
    start = 0;
    return !ended || length >= bytes;
  };
  for (;;) {
    if (!(await fill(4))) {
      if (buffer.length - start > 0) throw new OsmFormatError("trailing bytes");
      return;
    }
    const headerLength = new DataView(buffer.buffer, buffer.byteOffset + start, 4).getUint32(0);
    start += 4;
    if (!(await fill(headerLength))) throw new OsmFormatError("truncated blob header");
    const header = new Reader(buffer, start, start + headerLength);
    start += headerLength;
    let type = "";
    let dataSize = 0;
    while (!header.done) {
      const tag = header.varint();
      if (tag >> 3 === 1 && (tag & 7) === 2) type = header.string();
      else if (tag >> 3 === 3 && (tag & 7) === 0) dataSize = header.varint();
      else header.skip(tag & 7);
    }
    if (!(await fill(dataSize))) throw new OsmFormatError("truncated blob");
    const blob = new Reader(buffer, start, start + dataSize);
    start += dataSize;
    let data: Uint8Array | undefined;
    while (!blob.done) {
      const tag = blob.varint();
      const field = tag >> 3;
      if (field === 1 && (tag & 7) === 2) {
        const raw = blob.bytes();
        data = raw.buf.slice(raw.pos, raw.end);
      } else if (field === 3 && (tag & 7) === 2) {
        const zlib = blob.bytes();
        data = unzlibSync(zlib.buf.subarray(zlib.pos, zlib.end));
      } else if (field >= 4 && field <= 7 && (tag & 7) === 2) {
        throw new OsmFormatError("only raw and zlib blobs are supported");
      } else blob.skip(tag & 7);
    }
    if (data === undefined) throw new OsmFormatError("empty blob");
    yield { type, data };
  }
}

const readHeader = (data: Uint8Array): OsmHeader => {
  const r = new Reader(data);
  const requiredFeatures: Array<string> = [];
  const optionalFeatures: Array<string> = [];
  let timestamp: number | undefined;
  while (!r.done) {
    const tag = r.varint();
    const field = tag >> 3;
    if (field === 4 && (tag & 7) === 2) requiredFeatures.push(r.string());
    else if (field === 5 && (tag & 7) === 2) optionalFeatures.push(r.string());
    else if (field === 32 && (tag & 7) === 0) timestamp = r.int();
    else r.skip(tag & 7);
  }
  return { requiredFeatures, optionalFeatures, timestamp };
};

const supportedFeatures = new Set(["OsmSchema-V0.6", "DenseNodes", "HistoricalInformation"]);

/** Growable scratch for one block's decoded columns. */
class Scratch {
  ids = new Float64Array(8192);
  lat = new Int32Array(8192);
  lon = new Int32Array(8192);
  refs = new Float64Array(1024);
  ensureNodes(size: number) {
    if (size <= this.ids.length) return;
    const grown = Math.max(size, this.ids.length * 2);
    this.ids = new Float64Array(grown);
    this.lat = new Int32Array(grown);
    this.lon = new Int32Array(grown);
  }
  ensureRefs(size: number) {
    if (size > this.refs.length) this.refs = new Float64Array(Math.max(size, this.refs.length * 2));
  }
}

const readBlock = (data: Uint8Array, visitor: OsmVisitor, scratch: Scratch) => {
  const r = new Reader(data);
  const strings: Array<readonly [number, number]> = [];
  const groups: Array<Reader> = [];
  let granularity = 100;
  let latOffset = 0;
  let lonOffset = 0;
  while (!r.done) {
    const tag = r.varint();
    const field = tag >> 3;
    if (field === 1 && (tag & 7) === 2) {
      const table = r.bytes();
      while (!table.done) {
        const t = table.varint();
        if (t >> 3 === 1 && (t & 7) === 2) {
          const s = table.bytes();
          strings.push([s.pos, s.end]);
        } else table.skip(t & 7);
      }
    } else if (field === 2 && (tag & 7) === 2) groups.push(r.bytes());
    else if (field === 17 && (tag & 7) === 0) granularity = r.varint();
    else if (field === 19 && (tag & 7) === 0) latOffset = r.int();
    else if (field === 20 && (tag & 7) === 0) lonOffset = r.int();
    else r.skip(tag & 7);
  }
  const decoded: Array<string | undefined> = [];
  const string = (i: number) => {
    let s = decoded[i];
    if (s === undefined) {
      const [from, to] = strings[i] ?? [0, 0];
      s = decoder.decode(data.subarray(from, to));
      decoded[i] = s;
    }
    return s;
  };
  // Nanodegrees to microdegrees.
  const micro = (offset: number, value: number) =>
    Math.round((offset + granularity * value) / 1000);

  for (const group of groups) {
    while (!group.done) {
      const tag = group.varint();
      const field = tag >> 3;
      if (field === 2 && (tag & 7) === 2 && visitor.nodes !== undefined) {
        const dense = group.bytes();
        let count = 0;
        let ids: Reader | undefined;
        let lats: Reader | undefined;
        let lons: Reader | undefined;
        while (!dense.done) {
          const t = dense.varint();
          const f = t >> 3;
          if (f === 1 && (t & 7) === 2) ids = dense.bytes();
          else if (f === 8 && (t & 7) === 2) lats = dense.bytes();
          else if (f === 9 && (t & 7) === 2) lons = dense.bytes();
          else dense.skip(t & 7);
        }
        if (ids === undefined || lats === undefined || lons === undefined) continue;
        // Count first: varints are at least a byte, so the id field's length bounds it.
        scratch.ensureNodes(ids.end - ids.pos);
        let id = 0;
        let lat = 0;
        let lon = 0;
        while (!ids.done) {
          if (lats.done || lons.done)
            throw new OsmFormatError("dense nodes: fewer coordinates than ids");
          id += ids.sint();
          lat += lats.sint();
          lon += lons.sint();
          scratch.ids[count] = id;
          scratch.lat[count] = micro(latOffset, lat);
          scratch.lon[count] = micro(lonOffset, lon);
          count++;
        }
        visitor.nodes(scratch.ids, scratch.lat, scratch.lon, count);
      } else if (field === 1 && (tag & 7) === 2 && visitor.nodes !== undefined) {
        const node = group.bytes();
        let id = 0;
        let lat = 0;
        let lon = 0;
        while (!node.done) {
          const t = node.varint();
          const f = t >> 3;
          if (f === 1 && (t & 7) === 0) id = node.sint();
          else if (f === 8 && (t & 7) === 0) lat = node.sint();
          else if (f === 9 && (t & 7) === 0) lon = node.sint();
          else node.skip(t & 7);
        }
        scratch.ensureNodes(1);
        scratch.ids[0] = id;
        scratch.lat[0] = micro(latOffset, lat);
        scratch.lon[0] = micro(lonOffset, lon);
        visitor.nodes(scratch.ids, scratch.lat, scratch.lon, 1);
      } else if (field === 3 && (tag & 7) === 2 && visitor.way !== undefined) {
        const way = group.bytes();
        let id = 0;
        let keys: Reader | undefined;
        let vals: Reader | undefined;
        let refs: Reader | undefined;
        while (!way.done) {
          const t = way.varint();
          const f = t >> 3;
          if (f === 1 && (t & 7) === 0) id = way.int();
          else if (f === 2 && (t & 7) === 2) keys = way.bytes();
          else if (f === 3 && (t & 7) === 2) vals = way.bytes();
          else if (f === 8 && (t & 7) === 2) refs = way.bytes();
          else way.skip(t & 7);
        }
        const keyIndexes: Array<number> = [];
        const valIndexes: Array<number> = [];
        while (keys !== undefined && !keys.done) keyIndexes.push(keys.varint());
        while (vals !== undefined && !vals.done) valIndexes.push(vals.varint());
        const tagOf = (key: string) => {
          for (let i = 0; i < keyIndexes.length; i++) {
            if (string(keyIndexes[i] ?? 0) === key) return string(valIndexes[i] ?? 0);
          }
          return undefined;
        };
        let count = 0;
        if (refs !== undefined) {
          scratch.ensureRefs(refs.end - refs.pos);
          let ref = 0;
          while (!refs.done) {
            ref += refs.sint();
            scratch.refs[count++] = ref;
          }
        }
        visitor.way(id, scratch.refs, count, tagOf);
      } else group.skip(tag & 7);
    }
  }
};

/** Reads a whole PBF stream, calling `visitor` for the header, node blocks and ways in file order. */
export const readOsmPbf = async (
  chunks: AsyncIterable<Uint8Array>,
  visitor: OsmVisitor,
): Promise<void> => {
  const scratch = new Scratch();
  for await (const { type, data } of blobs(chunks)) {
    if (type === "OSMHeader") {
      const header = readHeader(data);
      const unsupported = header.requiredFeatures.filter((f) => !supportedFeatures.has(f));
      if (unsupported.length > 0) {
        throw new OsmFormatError(`unsupported features: ${unsupported.join(", ")}`);
      }
      visitor.header?.(header);
    } else if (type === "OSMData") readBlock(data, visitor, scratch);
  }
};
