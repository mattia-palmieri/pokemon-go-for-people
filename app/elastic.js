// Tiny Elasticsearch client: fetch + API key, no dependencies.
const URL_ = (process.env.ELASTIC_URL || '').replace(/\/$/, '');
const KEY = process.env.ELASTIC_API_KEY || '';

async function es(method, path, body) {
  if (!URL_ || !KEY) throw new Error('ELASTIC_URL and ELASTIC_API_KEY must be set');
  const isNd = typeof body === 'string';
  const res = await fetch(URL_ + path, {
    method,
    headers: {
      Authorization: `ApiKey ${KEY}`,
      'content-type': isNd ? 'application/x-ndjson' : 'application/json',
    },
    body: body === undefined ? undefined : isNd ? body : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 404) {
    throw new Error(`Elastic ${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return { status: res.status, ...json };
}

module.exports = { es };
