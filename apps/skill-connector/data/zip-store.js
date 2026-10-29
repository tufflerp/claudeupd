/**
 * Minimal ZIP writer shared by Node (packaging) and the Skill Connector browser
 * app (downloading skills). Copied to apps/skill-connector/data/zip-store.js by
 * scripts/skill-connector-build.js. No Node or DOM dependencies.
 *
 * Entries are stored uncompressed unless a synchronous `deflateRaw` function is
 * supplied (Node passes zlib.deflateRawSync). File names are UTF-8.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ZipStore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
  }

  function utf8(text) {
    return new TextEncoder().encode(text);
  }

  /**
   * Build a ZIP archive.
   *
   * @param {Array<{ path: string, data: Uint8Array }>} entries - Forward-slash relative paths
   * @param {{ deflateRaw?: (data: Uint8Array) => Uint8Array, date?: Date }} [options]
   * @returns {Uint8Array}
   */
  function createZip(entries, options = {}) {
    const { time, day } = dosDateTime(options.date || new Date());
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const entry of entries) {
      if (!entry.path || entry.path.startsWith('/') || entry.path.split('/').includes('..')) {
        throw new Error(`Unsafe zip path: ${entry.path}`);
      }
      const name = utf8(entry.path);
      const data = entry.data;
      const crc = crc32(data);
      let method = 0;
      let body = data;
      if (options.deflateRaw && data.length > 64) {
        const packed = options.deflateRaw(data);
        if (packed.length < data.length) {
          method = 8;
          body = packed;
        }
      }

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 file names
      local.setUint16(8, method, true);
      local.setUint16(10, time, true);
      local.setUint16(12, day, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, body.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), name, body);

      const dir = new DataView(new ArrayBuffer(46));
      dir.setUint32(0, 0x02014b50, true);
      dir.setUint16(4, 20, true);
      dir.setUint16(6, 20, true);
      dir.setUint16(8, 0x0800, true);
      dir.setUint16(10, method, true);
      dir.setUint16(12, time, true);
      dir.setUint16(14, day, true);
      dir.setUint32(16, crc, true);
      dir.setUint32(20, body.length, true);
      dir.setUint32(24, data.length, true);
      dir.setUint16(28, name.length, true);
      dir.setUint32(42, offset, true);
      central.push(new Uint8Array(dir.buffer), name);

      offset += 30 + name.length + body.length;
    }

    const centralSize = central.reduce((sum, part) => sum + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    const parts = chunks.concat(central, [new Uint8Array(end.buffer)]);
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  return { createZip, crc32 };
});
