// Seed Elastic with 2,000 bot attendees walking the KubeCon venue.
// Run: node --env-file=../.env seed.js [count]
const { es } = require('./elastic');

const INDEX = process.env.SEED_INDEX || 'players';
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

// How a person would say each interest in their own words, without the tag
// name. The bio is embedded with Jina, so a search for "kernel tracing" finds
// eBPF people even though no tag says that.
const PHRASES = {
  'Platform engineering': 'build internal developer platforms', SRE: 'keep production up and own the pager',
  Argo: 'ship apps from git with Argo', Go: 'write backend services in a compiled language from Google',
  Helm: 'package apps as charts', Prometheus: 'scrape and alert on metrics',
  OpenTelemetry: 'instrument code with vendor-neutral traces', Terraform: 'write infrastructure as code',
  Istio: 'run a service mesh with sidecars', GitOps: 'let a git repo drive what runs in the cluster',
  Python: 'script everything in Python', 'LLM inference': 'serve large language models fast',
  Envoy: 'tune L7 proxies', Flux: 'reconcile clusters from git with Flux',
  Rust: 'write memory-safe systems code', Backstage: 'build a developer portal and service catalog',
  eBPF: 'trace kernel events without touching app code', Cilium: 'do networking and security in the Linux kernel',
  Linkerd: 'run a lightweight mesh with mTLS', Crossplane: 'manage cloud resources as Kubernetes objects',
  'Gateway API': 'route ingress traffic the new standard way', Kyverno: 'write policies that block bad manifests',
  'Chaos engineering': 'break things on purpose to find weak spots', WebAssembly: 'run tiny sandboxed modules instead of containers',
  KEDA: 'scale workloads on queue length and events', Dapr: 'give microservices building blocks through a sidecar',
  'GPU scheduling': 'share GPUs between training jobs', Kubeflow: 'run ML pipelines on the cluster',
  FinOps: 'cut the cloud bill', vCluster: 'give each team its own virtual cluster',
  CloudNativePG: 'run Postgres with an operator', Falco: 'detect intrusions from syscalls at runtime',
  'SPIFFE/SPIRE': 'give every workload a cryptographic identity', etcd: 'care about the key-value store under the control plane',
  Accessibility: 'make UIs work with screen readers', Raft: 'read consensus papers for fun',
  'Retro gaming': 'collect old consoles and play 8-bit games', Sourdough: 'bake bread with a wild yeast starter',
  COBOL: 'maintain mainframe code older than me', 'Mechanical keyboards': 'build clicky keyboards with custom switches',
  Climbing: 'go bouldering on weekends',
};
const bioOf = (tags) => {
  const p = tags.filter((t) => PHRASES[t]).map((t) => PHRASES[t]);
  return p.length ? `I ${p.join(', ')}.` : 'I run containers on Kubernetes.';
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
    bio: bioOf(tags),
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
        // Jina v5 embeddings via Elastic Inference Service: search by meaning.
        bio: { type: 'semantic_text', inference_id: '.jina-embeddings-v5-text-small' },
        zone: { type: 'keyword' },
        location: { type: 'geo_point' },
        bot: { type: 'boolean' },
      },
    },
  });
  for (let start = 0; start < COUNT; start += 200) {
    const lines = [];
    for (let i = start; i < Math.min(COUNT, start + 200); i++) {
      const b = bot(i);
      lines.push(JSON.stringify({ index: { _index: INDEX, _id: b.id } }), JSON.stringify(b));
    }
    const r = await es('POST', '/_bulk?refresh=wait_for', lines.join('\n') + '\n');
    if (r.errors) throw new Error('bulk had errors: ' + JSON.stringify(r.items.find((i) => i.index.error)).slice(0, 300));
    console.log(`  ${Math.min(COUNT, start + 200)} / ${COUNT}`);
  }
  const c = await es('GET', `/${INDEX}/_count`);
  console.log(`indexed ${c.count} players into ${INDEX}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
