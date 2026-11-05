import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const target = resolve(process.env.GEOIP_DB || resolve(import.meta.dirname, '..', 'data', 'dbip-country-lite.mmdb'));

function monthStamp(offset) {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - offset);
  return date.toISOString().slice(0, 7);
}

async function download() {
  for (const offset of [0, 1]) {
    const url = `https://download.db-ip.com/free/dbip-country-lite-${monthStamp(offset)}.mmdb.gz`;
    const response = await fetch(url);
    if (response.ok) {
      return { url, bytes: gunzipSync(Buffer.from(await response.arrayBuffer())) };
    }
  }
  throw new Error('Could not download the DB-IP country database');
}

const { url, bytes } = await download();
await mkdir(dirname(target), { recursive: true });
await writeFile(target, bytes);
console.log(`Saved ${url} to ${target} (${Math.round(bytes.length / 1024 / 1024)} MB). IP to Country Lite by DB-IP, CC BY 4.0.`);
