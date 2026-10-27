import { createHash } from 'node:crypto';
import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../dist/public/', import.meta.url));
// Deliberately copy only application assets: legacy promotional and diagnostic
// files in the upstream public directory must never ship with this edition.
for (const name of ['favicon.svg', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png']) {
  await copyFile(new URL('../client/public/' + name, import.meta.url), path.join(directory, name));
}
async function listFiles(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'sw.js') continue;
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) files.push(...await listFiles(path.join(dir, entry.name), `${relative}/`));
    else files.push(relative);
  }
  return files.sort();
}

const files = await listFiles(directory);
const hash = createHash('sha256');
for (const file of files) hash.update(file).update(await readFile(path.join(directory, file)));
const version = hash.digest('hex').slice(0, 16);
const worker = `// Generated from the final build. Public application files only.
const ASSETS = ${JSON.stringify(files)};
const ROOT = new URL('./', self.location.href);
const PREFIX = 'hanweb-catholic-shell-' + ROOT.pathname + '-';
const CACHE = PREFIX + ${JSON.stringify(version)};
const URLS = ASSETS.map(file => new URL(file, ROOT).href);
const ALLOWED = new Set(URLS);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(URLS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      if (!response.ok) throw new Error('Navigation unavailable');
      return response;
    }).catch(() => caches.open(CACHE).then(cache => cache.match(new URL('index.html', ROOT).href))));
    return;
  }
  if (!ALLOWED.has(url.href)) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request)) || fetch(event.request)));
});
`;
await writeFile(path.join(directory, 'sw.js'), worker);
await writeFile(path.join(directory, '.nojekyll'), '');
console.log(`Offline shell ready: ${files.length} files, version ${version}`);
