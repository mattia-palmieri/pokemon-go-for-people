// Pokémon Go for people: find the attendee you match best, where rare
// interests count most. Keep listening on $PORT and keep /healthz and /readyz.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { es } = require('./elastic');

const port = Number(process.env.PORT || 8080);
const version = process.env.APP_VERSION || 'dev';
const PLAYERS = process.env.PLAYERS_INDEX || 'players';
const CATCHES = 'catches';
// Zone centers (same as seed.js). The map shows these, never a person's position.
const ZONE_CENTERS = {
  'Keynote Hall': { lat: 40.7676, lon: -111.8954 }, 'Expo Hall': { lat: 40.7666, lon: -111.8947 },
  'Session rooms 150': { lat: 40.7682, lon: -111.8968 }, 'Session rooms 250': { lat: 40.7659, lon: -111.8969 },
  'Food court': { lat: 40.7670, lon: -111.8976 }, 'Hallway track': { lat: 40.7672, lon: -111.8962 },
};

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

function rarity(df, total) {
  const share = df / total;
  if (share < 0.02) return 'legendary';
  if (share < 0.06) return 'rare';
  return 'common';
}

function metersBetween(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

function heat(m) {
  if (m < 40) return 'hot';
  if (m < 100) return 'warm';
  return 'cold';
}

async function getPlayer(id) {
  const r = await es('GET', `/${PLAYERS}/_doc/${encodeURIComponent(id)}`);
  return r.found ? { id: r._id, ...r._source } : null;
}

// A random bot that has at least one rare interest, so the demo is fun.
async function randomMe() {
  const r = await es('POST', `/${PLAYERS}/_search`, {
    size: 1,
    query: {
      function_score: {
        query: { terms: { tags: ['eBPF', 'Rust', 'WebAssembly', 'Cilium', 'Crossplane', 'KEDA', 'Dapr', 'Falco', 'Sourdough', 'Retro gaming'] } },
        random_score: {},
      },
    },
  });
  const h = r.hits.hits[0];
  return { id: h._id, ...h._source };
}

// Whole-index player count, for rarity and points. It barely changes, so we
// cache it 30 s (found by Dash0 Agent0: it was a 2nd, sequential Elastic call
// on every match). One shared refresh at a time; serve stale while it runs.
const COUNT_TTL_MS = 30_000;
const count = { value: null, at: 0, inflight: null };
function playerCount() {
  if (count.value !== null && Date.now() - count.at < COUNT_TTL_MS) return count.value;
  count.inflight ??= es('GET', `/${PLAYERS}/_count`)
    .then((r) => Object.assign(count, { value: r.count, at: Date.now() }).value)
    .catch((err) => { if (count.value === null) throw err; return count.value; })
    .finally(() => { count.inflight = null; });
  return count.value ?? count.inflight;
}

// The core: one hybrid Elastic query. Each shared interest is a term query;
// BM25's IDF makes a shared rare interest worth far more than a shared common
// one, so "Kubernetes" (everyone) adds ~0 and "eBPF" (3%) adds a lot. A Jina
// semantic leg on bios finds people who mean the same thing in other words.
async function match(me, tags, exclude) {
  const must_not = [{ ids: { values: [me.id, ...exclude].filter(Boolean) } }];
  const r = await es('POST', `/${PLAYERS}/_search`, {
    size: 5,
    track_total_hits: true,
    _source: ['name', 'avatar', 'tags', 'bio', 'zone', 'location'],
    // Hybrid: BM25 on exact tags (rarity via IDF) + Jina semantic search on
    // bios (meaning: "kernel tracing" finds eBPF people), fused with RRF.
    retriever: {
      rrf: {
        rank_window_size: 50,
        retrievers: [
          {
            standard: {
              // min_score drops matches on common tags only (Kubernetes ~0.1):
              // an interest everyone has is not a match.
              min_score: 1,
              query: {
                bool: {
                  should: tags.map((t) => ({ term: { tags: { value: t, _name: t } } })),
                  minimum_should_match: 1,
                  must_not,
                },
              },
            },
          },
          { standard: { query: { bool: { must: { semantic: { field: 'bio', query: tags.join(', ') } }, must_not } } } },
        ],
      },
    },
    aggs: {
      crowd: {
        global: {},
        aggs: { df: { terms: { field: 'tags', include: tags, size: tags.length || 1 } } },
      },
    },
  });
  const total = await playerCount();
  const df = Object.fromEntries(r.aggregations.crowd.df.buckets.map((b) => [b.key, b.doc_count]));
  const points = (t) => Math.round(Math.log(total / (df[t] || 1)) * 10) / 10;

  // Words nobody has as a tag ("kernel tracing") can only match by meaning.
  const free = tags.filter((t) => !df[t]);
  const rarest = [...tags].sort((a, b) => (df[a] || 0) - (df[b] || 0))[0];
  const matches = r.hits.hits.map((h) => {
    const shared = (h.matched_queries || [])
      .map((t) => ({ tag: t, people: df[t] || 0, points: points(t), rarity: rarity(df[t] || 0, total) }))
      .sort((a, b) => a.people - b.people);
    // Only common tags in common (everyone has Kubernetes)? Then the match came from meaning.
    const byMeaning = !shared.some((x) => x.rarity !== 'common');
    const gemTag = free[0] || rarest;
    const gem = byMeaning
      ? { tag: gemTag, people: df[gemTag] || 0, points: points(gemTag), rarity: free[0] ? 'legendary' : rarity(df[gemTag] || 0, total), meaning: true }
      : shared[0];
    const meters = me.location ? metersBetween(me.location, h._source.location) : null;
    return {
      id: h._id,
      name: h._source.name,
      avatar: h._source.avatar,
      zone: h._source.zone,
      // Shown score = sum of rarity points (the IDF story); order = RRF rank.
      score: Math.round((byMeaning ? gem.points : shared.reduce((a, x) => a + x.points, 0)) * 10) / 10,
      gem,
      shared,
      bio: h._source.bio || '',
      distance: meters == null ? null : Math.round(meters / 25) * 25,
      heat: meters == null ? null : heat(meters),
      // Zone only, never the exact position: privacy by design.
      zoneCenter: ZONE_CENTERS[h._source.zone] || null,
    };
  });
  return { total, crowd: df, matches };
}

// Where the people with this interest are: a geohash heat map from Elastic.
async function heatmap(tag) {
  const r = await es('POST', `/${PLAYERS}/_search`, {
    size: 0,
    query: { term: { tags: tag } },
    aggs: {
      cells: {
        geohash_grid: { field: 'location', precision: 7 },
        aggs: { center: { geo_centroid: { field: 'location' } } },
      },
    },
  });
  return r.aggregations.cells.buckets.filter((b) => b.doc_count >= 3).map((b) => ({ count: b.doc_count, ...b.center.location }));
}

// "Keynote ends": the crowd leaves the hall and everyone hunts at once.
// Bounded on purpose: one run at a time, max 60 s, max 3,000 requests, 25 in flight.
const KEYNOTE = { seconds: 60, maxRequests: 3000, concurrency: 25 };
const BOT_TAGS = ['eBPF', 'Rust', 'WebAssembly', 'Cilium', 'Crossplane', 'KEDA', 'Dapr', 'Falco', 'Kubernetes', 'Go', 'Python', 'GitOps', 'Sourdough', 'Retro gaming'];
let keynote = { running: false, sent: 0, failed: 0, ms: [] };
function keynoteStatus() {
  const ms = [...keynote.ms].sort((a, b) => a - b);
  const pct = (q) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] : null);
  return { running: keynote.running, sent: keynote.sent, failed: keynote.failed, p50: pct(0.5), p95: pct(0.95) };
}
async function runKeynote() {
  keynote = { running: true, sent: 0, failed: 0, ms: [] };
  const end = Date.now() + KEYNOTE.seconds * 1000;
  console.log('keynote: start', KEYNOTE);
  const bot = async () => {
    while (Date.now() < end && keynote.sent < KEYNOTE.maxRequests) {
      keynote.sent++;
      const tags = [...BOT_TAGS].sort(() => Math.random() - 0.5).slice(0, 3).join(',');
      const t0 = Date.now();
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/match?tags=${encodeURIComponent(tags)}`);
        if (!r.ok) keynote.failed++;
        await r.arrayBuffer();
      } catch { keynote.failed++; }
      keynote.ms.push(Date.now() - t0);
    }
  };
  await Promise.all(Array.from({ length: KEYNOTE.concurrency }, bot));
  keynote.running = false;
  console.log('keynote: done', keynoteStatus());
}

async function readBody(req) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 1e5) throw new Error('too big'); }
  return s ? JSON.parse(s) : {};
}

const STATIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, 'bad request\n', 'text/plain'); }
  const p = url.pathname;
  try {
    if (p === '/healthz' || p === '/readyz') return send(res, 200, 'ok\n', 'text/plain');
    if (p === '/api/version') return send(res, 200, { version });
    if (p === '/api/me') {
      const id = url.searchParams.get('id');
      const me = id ? await getPlayer(id) : await randomMe();
      return me ? send(res, 200, me) : send(res, 404, { error: 'no such player' });
    }
    if (p === '/api/match') {
      const id = url.searchParams.get('id');
      const me = (id && (await getPlayer(id))) || {};
      const tags = (url.searchParams.get('tags') || (me.tags || []).join(','))
        .split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20);
      if (!tags.length) return send(res, 400, { error: 'give id or tags' });
      const exclude = (url.searchParams.get('exclude') || '').split(',').slice(0, 200);
      return send(res, 200, await match(me, tags, exclude));
    }
    if (p === '/api/heat') {
      const tag = url.searchParams.get('tag');
      return tag ? send(res, 200, await heatmap(tag)) : send(res, 400, { error: 'tag required' });
    }
    if (p === '/api/keynote') {
      if (req.method === 'POST' && !keynote.running) runKeynote().catch((e) => { keynote.running = false; console.error('keynote', e.message); });
      return send(res, 200, keynoteStatus());
    }
    if (p === '/api/catch' && req.method === 'POST') {
      const b = await readBody(req);
      if (!b.me || !b.target) return send(res, 400, { error: 'me and target required' });
      await es('POST', `/${CATCHES}/_doc`, { me: String(b.me), target: String(b.target), gem: String(b.gem || ''), at: new Date().toISOString() });
      return send(res, 200, { ok: true });
    }
    const file = path.join(STATIC, p === '/' ? 'index.html' : p);
    if (file.startsWith(STATIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
    }
    send(res, 404, 'not found\n', 'text/plain');
  } catch (e) {
    console.error(p, e.message);
    send(res, 500, { error: 'internal error' });
  }
});

server.listen(port, () => console.log(`listening on :${port}, version ${version}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
