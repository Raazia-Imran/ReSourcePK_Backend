const zlib = require("node:zlib");
const { isUtf8 } = require("node:buffer");
const { AppError } = require("../../lib/errors");
const MAX_EXPANSION = 8 * 1024 * 1024;
function invalid() {
  throw new AppError(
    422,
    "INVALID_FILE",
    "Invalid, encrypted or unsupported XLSX archive",
  );
}
function sizeError() {
  throw new AppError(
    422,
    "IMPORT_SIZE",
    "XLSX expands beyond 8 MB or has too many parts",
  );
}
function footerPosition(buffer) {
  for (
    let offset = buffer.length - 22;
    offset >= Math.max(0, buffer.length - 65557);
    offset--
  ) {
    if (
      buffer.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length
    )
      return offset;
  }
  return invalid();
}
function extract(buffer, cursor, directory, remaining) {
  if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50)
    invalid();
  const flags = buffer.readUInt16LE(cursor + 8),
    method = buffer.readUInt16LE(cursor + 10);
  const compressed = buffer.readUInt32LE(cursor + 20),
    declared = buffer.readUInt32LE(cursor + 24);
  const nameSize = buffer.readUInt16LE(cursor + 28),
    extra = buffer.readUInt16LE(cursor + 30),
    comment = buffer.readUInt16LE(cursor + 32);
  const local = buffer.readUInt32LE(cursor + 42),
    nameBytes = buffer.subarray(cursor + 46, cursor + 46 + nameSize);
  if (
    cursor + 46 + nameSize + extra + comment > buffer.length ||
    nameSize > 1000 ||
    !isUtf8(nameBytes) ||
    flags & 1 ||
    ![0, 8].includes(method) ||
    local + 30 > directory
  )
    invalid();
  const name = nameBytes.toString("utf8");
  if (
    !name ||
    name.includes("\0") ||
    name.startsWith("/") ||
    name.split("/").includes("..")
  )
    invalid();
  if (
    buffer.readUInt32LE(local) !== 0x04034b50 ||
    buffer.readUInt16LE(local + 8) !== method
  )
    invalid();
  const start =
    local +
    30 +
    buffer.readUInt16LE(local + 26) +
    buffer.readUInt16LE(local + 28);
  if (start + compressed > directory || declared > remaining) sizeError();
  let data;
  try {
    data =
      method === 0
        ? buffer.subarray(start, start + compressed)
        : zlib.inflateRawSync(buffer.subarray(start, start + compressed), {
            maxOutputLength: Math.max(1, remaining),
          });
  } catch {
    sizeError();
  }
  if (
    data.length > remaining ||
    data.length !== declared ||
    zlib.crc32(data) !== buffer.readUInt32LE(cursor + 16)
  )
    invalid();
  return {
    name,
    nameBytes,
    data,
    next: cursor + 46 + nameSize + extra + comment,
  };
}
function storedArchive(entries) {
  const files = [],
    directory = [];
  let offset = 0;
  for (const { nameBytes, data } of entries) {
    const local = Buffer.alloc(30),
      central = Buffer.alloc(46),
      crc = zlib.crc32(data);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    files.push(local, nameBytes, data);
    directory.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const central = Buffer.concat(directory),
    footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50);
  footer.writeUInt16LE(entries.length, 8);
  footer.writeUInt16LE(entries.length, 10);
  footer.writeUInt32LE(central.length, 12);
  footer.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, central, footer]);
}
function sanitizeZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) invalid();
  const footer = footerPosition(buffer),
    count = buffer.readUInt16LE(footer + 10),
    directory = buffer.readUInt32LE(footer + 16),
    size = buffer.readUInt32LE(footer + 12);
  if (
    buffer.readUInt16LE(footer + 4) !== 0 ||
    buffer.readUInt16LE(footer + 6) !== 0 ||
    directory + size !== footer ||
    buffer.readUInt16LE(footer + 8) !== count
  )
    invalid();
  if (!count || count > 100) sizeError();
  let cursor = directory,
    total = 0;
  const entries = [],
    names = new Set();
  for (let index = 0; index < count; index++) {
    const entry = extract(buffer, cursor, directory, MAX_EXPANSION - total);
    if (names.has(entry.name)) invalid();
    names.add(entry.name);
    total += entry.data.length;
    cursor = entry.next;
    entries.push(entry);
  }
  if (cursor !== footer) invalid();
  // Only these verified entries reach the downstream streaming ZIP reader.
  // Unlisted local headers and forged expansion sizes are discarded/rejected.
  return storedArchive(entries);
}
module.exports = { sanitizeZip, storedArchive };
