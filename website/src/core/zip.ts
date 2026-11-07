export interface ZipEntry {
  name: string;
  data: Blob;
}

interface Stamp {
  time: number;
  day: number;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});
const UTF8_FLAG = 0x0800;
const VERSION = 20;
const LOCAL_SIZE = 30;
const CENTRAL_SIZE = 46;
const END_SIZE = 22;

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosStamp(date: Date): Stamp {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function header(size: number, write: (view: DataView) => void): Uint8Array<ArrayBuffer> {
  const view = new DataView(new ArrayBuffer(size));
  write(view);
  return new Uint8Array(view.buffer);
}

function describeFile(view: DataView, at: number, stamp: Stamp, crc: number, size: number, nameLength: number): void {
  view.setUint16(at, UTF8_FLAG, true);
  view.setUint16(at + 2, 0, true);
  view.setUint16(at + 4, stamp.time, true);
  view.setUint16(at + 6, stamp.day, true);
  view.setUint32(at + 8, crc, true);
  view.setUint32(at + 12, size, true);
  view.setUint32(at + 16, size, true);
  view.setUint16(at + 20, nameLength, true);
}

export async function makeZip(entries: ZipEntry[], date = new Date()): Promise<Blob> {
  const stamp = dosStamp(date);
  const encoder = new TextEncoder();
  const files: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0;
  let centralSize = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(new Uint8Array(await entry.data.arrayBuffer()));
    const size = entry.data.size;
    const local = header(LOCAL_SIZE, (view) => {
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, VERSION, true);
      describeFile(view, 6, stamp, crc, size, name.length);
    });
    const record = header(CENTRAL_SIZE, (view) => {
      view.setUint32(0, 0x02014b50, true);
      view.setUint16(4, VERSION, true);
      view.setUint16(6, VERSION, true);
      describeFile(view, 8, stamp, crc, size, name.length);
      view.setUint32(42, offset, true);
    });
    files.push(local, name, entry.data);
    central.push(record, name);
    offset += LOCAL_SIZE + name.length + size;
    centralSize += CENTRAL_SIZE + name.length;
  }
  const end = header(END_SIZE, (view) => {
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, entries.length, true);
    view.setUint16(10, entries.length, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, offset, true);
  });
  return new Blob([...files, ...central, end], { type: 'application/zip' });
}
