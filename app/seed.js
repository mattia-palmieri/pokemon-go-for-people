// Seed Elastic with 2,000 bot attendees walking the KubeCon venue.
// Run: node --env-file=../.env seed.js [count]
const { es } = require('./elastic');

const INDEX = 'players';
const COUNT = Number(process.argv[2] || 2000);

// Interest -> share of attendees who have it. Kubernetes is near-universal on
// purpose: the match score must ignore it and reward the rare overlaps.
const TOPICS = {
  Kubernetes: 0.9, 'Platform engineering': 0.2, SRE: 0.2, Argo: 0.2, Go: 0.35,
  Helm: 0.25, Prometheus: 0.25, OpenTelemetry: 0.15, Terraform: 0.15, Istio: 0.08,
  'GitOps': 0.12, Python: 0.2, 'LLM inference': 0.06, Envoy: 0.05, Flux: 0.06,
  Rust: 0.05, Backstage: 0.05, eBPF: 0.03, Cilium: 0.035, Linkerd: 0.03,
  Crossplane: 0.025, 'Gateway API': 0.03, Kyverno: 0.02, 'Chaos engineering': 0.02,
  WebAssembly: 0.02, KEDA: 0.02, Dapr: 0.015, 'GPU scheduling': 0.015, Kubeflow: 0.02,
  FinOps: 0.025, vCluster: 0.015, CloudNativePG: 0.015, Falco: 0.01, 'SPIFFE/SPIRE': 0.008,
  etcd: 0.008, Accessibility: 0.008, Raft: 0.005, 'Retro gaming': 0.01, Sourdough: 0.006,
  COBOL: 0.003, 'Mechanical keyboards': 0.012, Climbing: 0.01,
};

const FIRST = ['Ana', 'Kenji', 'Priya', 'Lucas', 'Fatima', 'Noah', 'Mei', 'Omar', 'Sofia', 'Ravi',
  'Elena', 'Tom', 'Aisha', 'Diego', 'Yuki', 'Liam', 'Zara', 'Mateo', 'Ines', 'Sam', 'Chloe', 'Arjun',
  'Nora', 'Kai', 'Leila', 'Ben', 'Hana', 'Marco', 'Grace', 'Tariq', 'Olga', 'Felix', 'Amara', 'Jonas'];
const LAST = ['Okafor', 'Tanaka', 'Rossi', 'Singh', 'Müller', 'Garcia', 'Kim', 'Haddad', 'Novak',
  'Silva', 'Chen', 'Dubois', 'Nguyen', 'Larsen', 'Costa', 'Patel', 'Ivanova', 'Smith', 'Mensah', 'Park'];
const AVATARS = ['🦊', '🐙', '🦉', '🐢', '🐝', '🦀', '🐳', '🦄', '🐧', '🦝', '🐸', '🦔', '🐼', '🦜', '🐿️', '🦖'];

// Salt Palace Convention Center, Salt Lake City (approximate zones).
const ZONES = [
  { name: 'Keynote Hall', lat: 40.76760, lon: -111.89540, w: 0.30 },
  { name: 'Expo Hall', lat: 40.76660, lon: -111.89470, w: 0.30 },
  { name: 'Session rooms 150', lat: 40.76820, lon: -111.89680, w: 0.15 },
  { name: 'Session rooms 250', lat: 40.76590, lon: -111.89690, w: 0.12 },
  { name: 'Food court', lat: 40.76700, lon: -111.89760, w: 0.08 },
  { name: 'Hallway track', lat: 40.76720, lon: -111.89620, w: 0.05 },
];

const rand = (a) => a[Math.floor(Math.random() * a.length)];
function pickZone() {
  let r = Math.random();
  for (const z of ZONES) { if ((r -= z.w) <= 0) return z; }
  return ZONES[0];
}
const jitter = () => (Math.random() - 0.5) * 0.0009;

function bot(i) {
  const tags = Object.entries(TOPICS).filter(([, p]) => Math.random() < p).map(([t]) => t);
  while (tags.length < 3) {
    const t = rand(Object.keys(TOPICS));
    if (!tags.includes(t)) tags.push(t);
  }
  const z = pickZone();
  return {
    id: `bot-${i}`,
    name: `${rand(FIRST)} ${rand(LAST)}`,
    avatar: rand(AVATARS),
    tags,
    zone: z.name,
    location: { lat: z.lat + jitter(), lon: z.lon + jitter() },
    bot: true,
  };
}

async function main() {
  await es('DELETE', `/${INDEX}`);
  await es('PUT', `/${INDEX}`, {
    mappings: {
      properties: {
        name: { type: 'text' },
        avatar: { type: 'keyword', index: false },
        tags: { type: 'keyword' },
        zone: { type: 'keyword' },
        location: { type: 'geo_point' },
        bot: { type: 'boolean' },
      },
    },
  });
  for (let start = 0; start < COUNT; start += 500) {
    const lines = [];
    for (let i = start; i < Math.min(COUNT, start + 500); i++) {
      const b = bot(i);
      lines.push(JSON.stringify({ index: { _index: INDEX, _id: b.id } }), JSON.stringify(b));
    }
    const r = await es('POST', '/_bulk?refresh=wait_for', lines.join('\n') + '\n');
    if (r.errors) throw new Error('bulk had errors');
  }
  const c = await es('GET', `/${INDEX}/_count`);
  console.log(`indexed ${c.count} players into ${INDEX}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
