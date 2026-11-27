#!/usr/bin/env node
// Explicit local developer pilot. No production route or recurring process.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import WebSocket, {WebSocketServer} from 'ws';
import {createLivePilotSession, fundingApprovalValid, LIVE_PILOT} from '../src/ai/live-voice-session.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marker = path.join(root, 'docs/private/live-voice-pilot-attempt.json');
const approvalPath = path.join(root, 'docs/private/live-voice-pilot-approval.json');
const port = 4199;
const origin = `http://127.0.0.1:${port}`;
const staticFiles = new Map([
  ['/unified-styles.css', 'text/css'], ['/webmcp-tools.js', 'text/javascript'],
  ['/voice-commands.js', 'text/javascript'], ['/src/ai/live-voice-client.js', 'text/javascript'],
  ['/src/ai/live-voice-capture.js', 'text/javascript']
]);

export function localPilotStaticFile(pathname) {
  return staticFiles.has(pathname) ? {path: path.join(root, pathname.slice(1)), type: staticFiles.get(pathname)} : null;
}

export function localPilotRequestAllowed(request, expectedOrigin) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket?.remoteAddress) &&
    request.headers?.host === new URL(expectedOrigin).host && request.headers?.origin === expectedOrigin &&
    !request.headers?.['x-forwarded-for'];
}

const page = enabled => `<!doctype html><html lang="en" class="future"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ArtSoul local voice pilot</title>
<link rel="stylesheet" href="/unified-styles.css"><style>
body{margin:0;background:var(--c-bg);color:var(--c-text);font:16px/1.6 system-ui}main{max-width:50rem;margin:auto;padding:clamp(1rem,5vw,3rem)}
button,select{font:inherit;color:var(--c-text);background:var(--c-surface);border:1px solid var(--c-border);border-radius:.7rem;padding:.65rem 1rem;min-height:44px;margin:.3rem .4rem .3rem 0}button:disabled{opacity:.5}p{overflow-wrap:anywhere}
</style></head><body class="future"><main><h1>ArtSoul local voice pilot</h1>
<p>Speak naturally, ask about public artwork, or request navigation. Site actions require your review. Wallet actions remain in the ordinary assistant.</p>
<p>This developer test is off by default. One provider connection, at most four short responses and 60 seconds. It is not a guarantee of zero charges or a public service.</p>
${enabled ? `<div id="pilot"></div></main><script src="/webmcp-tools.js"></script><script src="/voice-commands.js"></script>
<script type="module">import {mountLiveVoicePilot} from '/src/ai/live-voice-client.js';
window.ArtSoulSearch={query:async input=>{const q=new URLSearchParams({q:input.query,category:input.category||'all'});const r=await fetch('/api/public/search?'+q);if(!r.ok)throw new Error('Search unavailable');return r.json();}};
mountLiveVoicePilot(document.getElementById('pilot'));</script>` : '<p role="status">Live voice is off. The microphone is closed.</p></main>'}</body></html>`;

export async function serveLiveVoicePilot({enabled = false} = {}) {
  let approval = null;
  if (enabled) {
    try { approval = JSON.parse(fs.readFileSync(approvalPath, 'utf8')); } catch {}
    if (!fundingApprovalValid(approval)) throw new Error('A fresh, independently verified promotional funding approval with cash overage disabled is required.');
    if (fs.existsSync(marker)) throw new Error('This local pilot already consumed its one provisioning attempt. Review the recorded attempt before authorizing another.');
  }
  const sessions = new Set();
  let spent = false, publicReads = 0;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress) || req.headers.host !== new URL(origin).host) {
      res.writeHead(403).end(); return;
    }
    let url;
    try { url = new URL(req.url, origin); } catch { res.writeHead(400).end(); return; }
    if (req.method === 'GET' && url.pathname === '/__live-voice-pilot') {
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}).end(page(enabled && !spent && fundingApprovalValid(approval))); return;
    }
    if (url.pathname.startsWith('/api/')) {
      const allowed = ['/api/public/search', '/api/public/artworks', '/api/public/indexer-status', '/api/public/artwork-provenance', '/api/public/auction-live'];
      if (req.method !== 'GET' || !allowed.includes(url.pathname) || url.search.length > 600 || ++publicReads > 20) {
        res.writeHead(403).end('Public read not permitted by this pilot.'); return;
      }
      try {
        const response = await fetch(`https://artsoulprotocol.com${url.pathname}${url.search}`, {
          headers: {Accept: 'application/json'}, redirect: 'error', signal: AbortSignal.timeout(8000)
        });
        if (!response.ok) throw new Error();
        const data = await response.json();
        const serialized = JSON.stringify(data);
        if (Buffer.byteLength(serialized) > 1500000) throw new Error();
        res.writeHead(200, {'Content-Type': 'application/json'}).end(serialized);
      } catch { res.writeHead(502, {'Content-Type': 'application/json'}).end('{"error":"Public ArtSoul data is unavailable."}'); }
      return;
    }
    const asset = req.method === 'GET' && localPilotStaticFile(url.pathname);
    if (asset) {
      res.writeHead(200, {'Content-Type': `${asset.type}; charset=utf-8`});
      fs.createReadStream(asset.path).on('error', () => res.destroy()).pipe(res);
      return;
    }
    res.writeHead(404).end('Not found');
  });
  const wsServer = new WebSocketServer({noServer: true, maxPayload: 20000, perMessageDeflate: false});
  server.on('upgrade', (request, socket, head) => {
    let url;
    try { url = new URL(request.url, origin); } catch { socket.destroy(); return; }
    if (url.pathname !== '/__live-voice-pilot/socket' || !['en', 'ru'].includes(url.searchParams.get('language')) ||
        [...url.searchParams.keys()].length !== 1 || !localPilotRequestAllowed(request, origin)) { socket.destroy(); return; }
    wsServer.handleUpgrade(request, socket, head, client => {
      const session = createLivePilotSession({client, enabled, approval, language: url.searchParams.get('language'),
        reserveAttempt() {
          if (spent) throw new Error('Attempt consumed');
          spent = true;
          fs.mkdirSync(path.dirname(marker), {recursive: true});
          fs.writeFileSync(marker, JSON.stringify({attemptedAt: new Date().toISOString(), model: LIVE_PILOT.model,
            voice: LIVE_PILOT.voice, status: 'attempt-reserved', note: 'Review provider usage before further authorization.'}), {flag: 'wx'});
        },
        openProvider(organizationId) {
          const key = process.env.OPENAI_API_KEY;
          if (!key) throw new Error('Key unavailable');
          return new WebSocket(`wss://api.openai.com/v1/realtime?model=${LIVE_PILOT.model}`, {
            headers: {Authorization: `Bearer ${key}`, 'OpenAI-Organization': organizationId}, handshakeTimeout: 10000, maxPayload: 524288, perMessageDeflate: false
          });
        }
      });
      sessions.add(session);
      client.on('close', () => sessions.delete(session));
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const close = async () => {
    sessions.forEach(session => session.stop('server_stopped'));
    wsServer.close();
    await new Promise(resolve => server.close(resolve));
  };
  return {origin, close};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--enable-funded-pilot')) throw new Error('Use no arguments for disabled preview, or --enable-funded-pilot after approval.');
  const pilot = await serveLiveVoicePilot({enabled: args.includes('--enable-funded-pilot')});
  console.log(`Local pilot: ${pilot.origin}/__live-voice-pilot (API ${args.length ? 'funded pilot gate enabled' : 'OFF'})`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => pilot.close().finally(() => process.exit(0)));
}
