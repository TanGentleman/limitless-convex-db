// Search latency benchmark for a local (or any) deployment.
//   node scripts/bench-search.mjs corpus 10000 > corpus.jsonl
//   npx convex import --table lifelogs --replace -y corpus.jsonl
//   LIMITLESS_API_KEY=... node scripts/bench-search.mjs run http://127.0.0.1:3211
// The corpus is synthetic: conversations of 150-1500 words drawn from a Zipf-weighted
// vocabulary, in the markdown shape Limitless returns, ~20 lifelogs a day.

let seed = 42;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (items) => items[Math.floor(random() * items.length)];

const COMMON = `the be to of and a in that have I it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us`.split(' ');
const TOPICS = `roadmap budget launch pendant transcript sync database convex deadline interview recipe marathon flight hotel dentist invoice contract pricing onboarding hiring design review standup retro offsite birthday wedding groceries apartment lease mortgage insurance doctor prescription therapy podcast newsletter keynote demo prototype benchmark latency index migration backup outage incident customer feedback churn revenue forecast quarterly planning vacation itinerary passport visa museum concert ticket soccer practice homework tutoring piano guitar camping hiking climbing kayak bicycle repair garden compost sourdough espresso`.split(' ');
const NAMES = ['Tan', 'Priya', 'Marcus', 'Jun', 'Elena', 'Sam', 'Ava', 'Omar'];
const VOCAB = [...COMMON, ...TOPICS];
const zipf = VOCAB.map((_, i) => 1 / (i + 1));
const total = zipf.reduce((a, b) => a + b, 0);
function word() {
  let r = random() * total;
  for (let i = 0; i < VOCAB.length; i++) if ((r -= zipf[i]) <= 0) return VOCAB[i];
  return VOCAB[0];
}

function lifelog(i, start) {
  const topics = [pick(TOPICS), pick(TOPICS)];
  const words = 150 + Math.floor(random() * 1350);
  const speakers = [pick(NAMES), pick(NAMES)];
  const lines = [`# ${topics[0]} and ${topics[1]}`, '', `## ${topics[0]}`, ''];
  const contents = [{ type: 'heading1', content: `${topics[0]} and ${topics[1]}` }];
  let t = start;
  for (let n = 0; n < words; ) {
    const len = 8 + Math.floor(random() * 30);
    const text = Array.from({ length: len }, () => (random() < 0.08 ? pick(topics) : word())).join(' ');
    const speaker = pick(speakers);
    lines.push(`- ${speaker} (${new Date(t).toISOString()}): ${text}`);
    contents.push({ type: 'blockquote', content: text, speakerName: speaker, startTime: t, endTime: t + len * 400 });
    t += len * 400;
    n += len;
  }
  return {
    lifelogId: `bench-${i}`,
    title: `${topics[0]} and ${topics[1]}`,
    markdown: lines.join('\n'),
    startTime: start,
    endTime: t,
    contents,
    embeddingId: null,
  };
}

async function run(site) {
  const key = process.env.LIMITLESS_API_KEY;
  if (!key) throw new Error('Set LIMITLESS_API_KEY to the deployment key');
  const queries = [
    ...TOPICS.slice(0, 20),
    'roadmap review', 'dentist appointment', 'flight hotel itinerary', 'quarterly revenue forecast', 'sourdough espresso',
  ];
  const time = async (path) => {
    const t0 = performance.now();
    const response = await fetch(site + path, { headers: { 'X-API-Key': key } });
    const body = await response.json();
    if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`);
    return { ms: performance.now() - t0, count: body.meta.lifelogs.count };
  };
  for (const q of queries.slice(0, 5)) await time(`/v1/search?query=${encodeURIComponent(q)}`); // warm up
  const report = async (label, paths) => {
    const results = [];
    for (let round = 0; round < 4; round++) for (const p of paths) results.push(await time(p));
    const ms = results.map((r) => r.ms).sort((a, b) => a - b);
    const at = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))].toFixed(1);
    console.log(`${label}: n=${ms.length} p50=${at(0.5)}ms p95=${at(0.95)}ms max=${at(1)}ms`);
  };
  await report('search limit=10', queries.map((q) => `/v1/search?query=${encodeURIComponent(q)}&limit=10`));
  await report('search limit=50', queries.map((q) => `/v1/search?query=${encodeURIComponent(q)}&limit=50`));
  await report('lifelogs limit=10', queries.map(() => '/v1/lifelogs?limit=10'));
}

const [command, arg] = process.argv.slice(2);
if (command === 'corpus') {
  const n = Number(arg ?? 10000);
  const perDay = 20;
  const first = Date.UTC(2025, 0, 1, 8);
  for (let i = 0; i < n; i++) {
    const dayStart = first + Math.floor(i / perDay) * 86400000;
    process.stdout.write(JSON.stringify(lifelog(i, dayStart + (i % perDay) * 40 * 60000)) + '\n');
  }
} else if (command === 'run') {
  await run(arg ?? 'http://127.0.0.1:3211');
} else {
  console.error('usage: bench-search.mjs corpus <n> | run <site-url>');
  process.exit(1);
}
