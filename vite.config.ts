import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import path from 'node:path';
import {
  analyzeBeatsOnDisk,
  probeHardwareCapabilities,
  readLutFilePayload,
  runHardwareExport,
  runVideoStabilization,
  saveCubeLutToColorstudies,
  scanColorstudiesLuts,
  stageUploadedMedia,
} from './electron/backend';

function readJsonBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const shaCache = new Map<string, { mtimeMs: number; sha256: string }>();

function getFileSha256(filePath: string): string {
  const stat = fsSync.statSync(filePath);
  const cached = shaCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.sha256;
  const hash = crypto.createHash('sha256');
  const fd = fsSync.openSync(filePath, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  try {
    let bytesRead = 0;
    while ((bytesRead = fsSync.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead));
    }
  } finally {
    fsSync.closeSync(fd);
  }
  const sha256 = hash.digest('hex').toUpperCase();
  shaCache.set(filePath, { mtimeMs: stat.mtimeMs, sha256 });
  return sha256;
}

function listLocalReleaseBinaries() {
  const releaseDir = path.resolve(process.cwd(), 'release');
  let version = '0.1.0';
  try {
    const pkg = JSON.parse(fsSync.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'));
    if (pkg.version) version = pkg.version;
  } catch {
    // ignore
  }
  if (!fsSync.existsSync(releaseDir)) {
    return { version, installer: null, portable: null };
  }
  const files = fsSync.readdirSync(releaseDir).filter((f) => f.toLowerCase().endsWith('.exe'));
  const makeEntry = (fileName: string | undefined) => {
    if (!fileName) return null;
    const full = path.join(releaseDir, fileName);
    const stat = fsSync.statSync(full);
    return {
      fileName,
      sizeBytes: stat.size,
      sizeMb: (stat.size / (1024 * 1024)).toFixed(1),
      sha256: getFileSha256(full),
      url: `/api/fifilm/download/${encodeURIComponent(fileName)}`,
    };
  };
  const installerFile = files.find((f) => /setup.*\.exe$/i.test(f));
  const portableFile = files.find((f) => /portable.*\.exe$/i.test(f));
  return {
    version,
    installer: makeEntry(installerFile),
    portable: makeEntry(portableFile),
  };
}

function fifilmDevApiPlugin(): Plugin {
  return {
    name: 'fifilm-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');

        // Serve the React NLE editor at / (rewritten to app.html) and static GitHub Pages download page at /download
        if ((url.pathname === '/' || url.pathname === '/index.html') && req.method === 'GET') {
          req.url = '/app.html';
          return next();
        }
        if ((url.pathname === '/download' || url.pathname === '/download/') && req.method === 'GET') {
          const pagePath = path.resolve(process.cwd(), 'index.html');
          if (fsSync.existsSync(pagePath)) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            fsSync.createReadStream(pagePath).pipe(res);
            return;
          }
        }

        if (!url.pathname.startsWith('/api/fifilm/')) return next();

        const sendJson = (status: number, data: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        };

        try {
          if (url.pathname === '/api/fifilm/releases' && req.method === 'GET') {
            return sendJson(200, listLocalReleaseBinaries());
          }
          if (url.pathname.startsWith('/api/fifilm/download/') && (req.method === 'GET' || req.method === 'HEAD')) {
            const rawName = decodeURIComponent(url.pathname.slice('/api/fifilm/download/'.length));
            const safeName = path.basename(rawName);
            const releaseDir = path.resolve(process.cwd(), 'release');
            const target = path.join(releaseDir, safeName);
            if (!safeName.toLowerCase().endsWith('.exe') || !fsSync.existsSync(target)) {
              return sendJson(404, { error: 'Release binary not found. Run npm run dist:win first.' });
            }
            const stat = fsSync.statSync(target);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Length', String(stat.size));
            res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
            if (req.method === 'HEAD') {
              res.end();
              return;
            }
            fsSync.createReadStream(target).pipe(res);
            return;
          }
          if (url.pathname === '/api/fifilm/capabilities' && req.method === 'GET') {
            return sendJson(200, await probeHardwareCapabilities());
          }
          if (url.pathname === '/api/fifilm/luts' && req.method === 'GET') {
            return sendJson(200, await scanColorstudiesLuts());
          }
          if (url.pathname === '/api/fifilm/lut-content' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const payload = await readLutFilePayload(String(body.filePath || ''));
            return sendJson(200, payload);
          }
          if (url.pathname === '/api/fifilm/save-lut' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const saved = await saveCubeLutToColorstudies(
              String(body.name || 'Fifilm Custom'),
              String(body.content || '')
            );
            return sendJson(200, saved);
          }
          if (url.pathname === '/api/fifilm/stabilize' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const result = await runVideoStabilization({
              inputPath: String(body.inputPath || ''),
              mode: (body.mode as 'smooth' | 'lock') || 'smooth',
              engine: (body.engine as 'hybrid' | 'vidstab' | 'opencv') || 'hybrid',
              smoothness: Number(body.smoothness ?? 18),
              strength: Number(body.strength ?? 75),
              autoCropZoom: Number(body.autoCropZoom ?? 6),
              rollingShutter: Number(body.rollingShutter ?? 35),
            });
            return sendJson(200, result);
          }
          if (url.pathname === '/api/fifilm/analyze-beats' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const result = await analyzeBeatsOnDisk(String(body.inputPath || ''));
            return sendJson(200, result);
          }
          if (url.pathname === '/api/fifilm/stage-media' && req.method === 'POST') {
            const fileName = url.searchParams.get('name') || 'clip.mp4';
            const chunks: Buffer[] = [];
            await new Promise<void>((resolve, reject) => {
              req.on('data', (c: Buffer) => chunks.push(c));
              req.on('end', () => resolve());
              req.on('error', reject);
            });
            const stagedPath = await stageUploadedMedia(fileName, Buffer.concat(chunks));
            return sendJson(200, { filePath: stagedPath });
          }
          if (url.pathname === '/api/fifilm/export' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const result = await runHardwareExport(
              body as unknown as Parameters<typeof runHardwareExport>[0]
            );
            return sendJson(200, result);
          }
          if (url.pathname === '/api/fifilm/media' && req.method === 'GET') {
            const target = url.searchParams.get('path');
            if (!target || !fsSync.existsSync(target)) {
              return sendJson(404, { error: 'Media file not found' });
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'video/mp4');
            fsSync.createReadStream(target).pipe(res);
            return;
          }
          return sendJson(404, { error: 'Unknown API route' });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return sendJson(500, { error: msg });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), fifilmDevApiPlugin()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: path.resolve(__dirname, 'app.html'),
    },
  },
  base: './',
});
