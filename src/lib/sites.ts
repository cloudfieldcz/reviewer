import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { dirname, join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as cheerio from 'cheerio';
import { env } from './env';
import { HttpError } from './http';

/** Upload limits for an uploaded-site project (a built SPA, not a media library). */
export const MAX_SITE_FILES = 3000;
export const MAX_SITE_BYTES = 150 * 1024 * 1024;

export const sitesRoot = (): string => resolve(env('SITES_DIR').trim() || './data/sites');
export const siteDir = (projectId: number): string => join(sitesRoot(), String(projectId));

/**
 * Turns the filename of one uploaded part (`folder/assets/app.js`, from `webkitRelativePath`) into a
 * path inside the site: the picked folder's own name is dropped. Throws on anything that could leave
 * the site folder or is not a plain relative path. Returns null for OS junk that is skipped silently.
 */
export function sanitizeUploadPath(raw: string): string | null {
  if (!raw || raw.includes('\0')) throw new HttpError(400, 'Invalid file path');
  if (raw.startsWith('/') || raw.includes('\\')) throw new HttpError(400, `Invalid file path: ${raw}`);
  const segments = raw.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) throw new HttpError(400, `Invalid file path: ${raw}`);
  const rest = segments.slice(1);
  if (rest.length === 0) throw new HttpError(400, `File is not inside the picked folder: ${raw}`);
  if (rest[rest.length - 1] === '.DS_Store') return null;
  return rest.join('/');
}

export interface UploadFile {
  path: string;
  data: Buffer;
}

/** Writes the files into a fresh sibling folder and swaps it in, so a half-finished upload never serves. */
export async function installSite(projectId: number, files: UploadFile[]): Promise<number> {
  if (!files.some((f) => f.path === 'index.html')) throw new HttpError(400, 'The folder must contain index.html at its root');
  const target = siteDir(projectId);
  const suffix = randomBytes(4).toString('hex');
  const fresh = `${target}.new-${suffix}`;
  const old = `${target}.old-${suffix}`;
  await mkdir(dirname(target), { recursive: true });
  try {
    for (const f of files) {
      const dest = resolve(fresh, f.path);
      if (!dest.startsWith(fresh + sep)) throw new HttpError(400, 'Invalid file path');
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, f.data);
    }
    let hadOld = true;
    await rename(target, old).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e;
      hadOld = false;
    });
    await rename(fresh, target);
    if (hadOld) await rm(old, { recursive: true, force: true });
  } catch (e) {
    await rm(fresh, { recursive: true, force: true });
    throw e;
  }
  return files.length;
}

export async function deleteSite(projectId: number): Promise<void> {
  await rm(siteDir(projectId), { recursive: true, force: true });
}

export async function countSiteFiles(projectId: number): Promise<number> {
  const walk = async (dir: string): Promise<number> => {
    let n = 0;
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      n += e.isDirectory() ? await walk(join(dir, e.name)) : 1;
    }
    return n;
  };
  return walk(siteDir(projectId));
}

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  map: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
};

export function mimeFor(file: string): string {
  const ext = file.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

/** Maps a request path to a file inside `dir`; null when it escapes the folder. */
export function resolveInside(dir: string, rel: string): string | null {
  if (rel.includes('\0')) return null;
  const full = resolve(dir, rel);
  return full === dir || full.startsWith(dir + sep) ? full : null;
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** Reduced shim: tells the review screen where the page is. The site is same-origin and routes its own links. */
export function staticScript(projectId: number): string {
  return `(function(){
var PREFIX='/p/${projectId}';
document.documentElement.setAttribute('data-reviewer','1');
function pagePath(){
  var p=location.pathname;
  if(p===PREFIX||p.indexOf(PREFIX+'/')===0)p=p.slice(PREFIX.length);
  return (p||'/')+location.search;
}
function notify(){
  try{if(window.parent&&window.parent!==window)window.parent.postMessage({type:'reviewer:navigate',path:pagePath()},location.origin);}catch(e){}
}
['pushState','replaceState'].forEach(function(m){
  var orig=history[m];
  history[m]=function(){var r=orig.apply(this,arguments);notify();return r;};
});
window.addEventListener('popstate',notify);
window.addEventListener('hashchange',notify);
notify();
})();`;
}

/** `<base href="/p/{id}/">` first in `<head>` (any existing one removed) plus the reduced script. */
export function injectStaticHtml(html: string, projectId: number): string {
  const $ = cheerio.load(html, { xml: false });
  $('base').remove();
  $('head').prepend(`<base href="${escapeAttr(`/p/${projectId}/`)}">`);
  $('body').append(`<script data-reviewer-ui>${staticScript(projectId)}</script>`);
  return $.html();
}

const HEADERS = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };

const emptyPage = (): Response =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Reviewer – nothing uploaded</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:3rem;color:#333;background:#fafafa}</style></head>
<body><h1 style="font-size:1.25rem">Nothing has been uploaded yet</h1><p>An admin can upload the built site on the project's manage page.</p></body></html>`,
    { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', ...HEADERS } },
  );

async function fileOrNull(p: string | null): Promise<string | null> {
  if (!p) return null;
  const s = await stat(p).catch(() => null);
  if (s?.isDirectory()) return fileOrNull(join(p, 'index.html'));
  return s?.isFile() ? p : null;
}

/** Serves `/p/{id}/{path}` of an uploaded site; `relPath` has no leading slash. */
export async function serveSite(projectId: number, relPath: string): Promise<Response> {
  const dir = siteDir(projectId);
  const indexFile = join(dir, 'index.html');
  if (!(await fileOrNull(indexFile))) return emptyPage();

  let file = await fileOrNull(resolveInside(dir, relPath));
  if (!file) {
    const last = relPath.split('/').pop() ?? '';
    // No extension = a client-side route: the SPA entry answers it. A missing asset stays a 404.
    if (/\.[A-Za-z0-9]+$/.test(last)) return new Response('Not found', { status: 404, headers: HEADERS });
    file = indexFile;
  }
  const type = mimeFor(file);
  if (type.startsWith('text/html')) {
    const html = injectStaticHtml(await readFile(file, 'utf8'), projectId);
    return new Response(html, { headers: { 'content-type': type, ...HEADERS } });
  }
  const body = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream;
  return new Response(body, { headers: { 'content-type': type, ...HEADERS } });
}
