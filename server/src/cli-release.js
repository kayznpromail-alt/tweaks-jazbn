import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';

// Serves CLI release manifests and binaries from a local releases/ directory.
// Structure: releases/manifest.json + releases/<filename>.exe (or .zip)
//
// manifest.json example:
// {
//   "version": "1.0.2",
//   "assets": {
//     "win32-x64": { "file": "edgey-1.0.2-win-x64.exe", "sha256": "abc…", "bytes": 142548992 }
//   }
// }

const VALID_PLATFORM = /^[a-z0-9]+-[a-z0-9]+$/;
const VALID_VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

let cached = null;
let cachedAt = 0;
const CACHE_TTL = 30_000;

async function loadManifest(dir) {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL) return cached;
  const path = join(dir, 'manifest.json');
  if (!existsSync(path)) return null;
  try {
    cached = JSON.parse(await readFile(path, 'utf8'));
    cachedAt = now;
    return cached;
  } catch {
    return null;
  }
}

export function cliReleaseRoutes(releasesDir) {
  const routes = new Hono();

  routes.get('/v1/cli-release', async (c) => {
    const manifest = await loadManifest(releasesDir);
    if (!manifest) return c.json({ release: null });

    const version = c.req.query('version');
    const platform = c.req.query('platform');

    // Binary download: ?version=X&platform=Y
    if (version && platform) {
      if (!VALID_VERSION.test(version) || !VALID_PLATFORM.test(platform))
        return c.json({ error: 'invalid_parameters' }, 400);
      if (version !== manifest.version) return c.json({ error: 'version_not_found' }, 404);
      const asset = manifest.assets?.[platform];
      if (!asset) return c.json({ error: 'platform_not_found' }, 404);
      const filePath = join(releasesDir, asset.file);
      if (!existsSync(filePath)) return c.json({ error: 'file_not_found' }, 404);
      const stat = statSync(filePath);
      c.header('Content-Type', 'application/octet-stream');
      c.header('Content-Length', String(stat.size));
      c.header('Content-Disposition', `attachment; filename="${asset.file}"`);
      c.header('Cache-Control', 'public, max-age=86400, immutable');
      return stream(c, async (s) => {
        const rs = createReadStream(filePath);
        for await (const chunk of rs) await s.write(chunk);
      });
    }

    // Manifest request (no version/platform, or schema=2)
    const origin = c.req.query('schema') === '2'
      ? buildSchemaV2(manifest, c.req.query('channel') ?? 'stable', c.req.query('platform') ?? '')
      : buildSchemaV1(manifest);

    return c.json({ release: origin });
  });

  return routes;
}

function buildSchemaV1(m) {
  const origin = 'https://api.edgey.shop';
  const assets = {};
  for (const [platform, asset] of Object.entries(m.assets ?? {})) {
    assets[platform] = {
      url: `${origin}/v1/cli-release?version=${m.version}&platform=${platform}`,
      sha256: asset.sha256,
      bytes: asset.bytes,
    };
  }
  return { version: m.version, assets };
}

function buildSchemaV2(m, channel, platform) {
  const origin = 'https://api.edgey.shop';
  const asset = m.assets?.[platform];
  if (!asset) return null;
  return {
    schemaVersion: 2,
    channel,
    platform,
    minimumLauncher: m.minimumLauncher ?? '0.0.0',
    application: {
      version: m.version,
      asset: {
        url: `${origin}/v1/cli-release?version=${m.version}&platform=${platform}`,
        sha256: asset.sha256,
        bytes: asset.bytes,
      },
    },
  };
}
