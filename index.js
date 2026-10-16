// Trend Hunter: scores momentum on every busy token of a chain and rides the strongest trends.
// Inputs, all from Chord: the 24h token board (volume, buy and sell volume) and hourly candles.
// Score = volume acceleration + buy pressure + aligned trend on 1h / 6h / 24h, minus penalties for a vertical
// candle, an overextended day or a dump in progress. Entries pass the risk gate; exits are TP / SL / trailing / time.
import { CONFIG, STABLE_SYMBOLS } from './lib/config.js';
import { resolveChain, board, candles, mapLimit } from './lib/chord.js';
import { Portfolio } from './lib/portfolio.js';
import { clamp, safe, usd, pct, table, writeReport, runAgent } from './lib/util.js';

const P = {
  minVolume24h: Number(process.env.MIN_VOLUME_USD || 100_000),
  maxChange24hPct: 120,     // do not chase anything up more than this in a day
  deepScan: Number(process.env.DEEP_SCAN || 20),
  buyScore: Number(process.env.BUY_SCORE || 68),
  exits: { tp: 0.25, sl: 0.08, trail: 0.1, maxHoldHours: 36 },
};

export function scoreToken(t, cs) {
  const last = cs.slice(-24);
  const vol24 = last.reduce((a, c) => a + safe(c.v), 0);
  const vol1 = safe(last.at(-1)?.v);
  const vol6 = last.slice(-6).reduce((a, c) => a + safe(c.v), 0);
  const accel = vol24 > 0 ? (vol1 * 24) / vol24 : 0;        // last hour run-rate vs the day; > 1 = heating up
  const accel6 = vol24 > 0 ? (vol6 * 4) / vol24 : 0;
  const close = (h) => cs.at(-1 - h)?.c;
  const c1 = (close(0) / close(1) - 1) * 100;
  const c6 = (close(0) / close(6) - 1) * 100;
  const c24 = safe(t.change24hPct, (close(0) / close(24) - 1) * 100);
  const bv = safe(t.buyVolume24h), sv = safe(t.sellVolume24h);
  const bp = bv + sv > 0 ? bv / (bv + sv) : 0.5;            // share of the day's volume that was buying
  const prints1 = safe(last.at(-1)?.n, 50);

  const parts = {
    accel: clamp((Math.min(accel, 4) - 0.8) / 2.2, 0, 1) * 25 + clamp((accel6 - 0.9) / 1.1, 0, 1) * 10,
    pressure: clamp((bp - 0.48) / 0.14, 0, 1) * 20,
    trend: clamp(safe(c1) / 4, 0, 1) * 10 + clamp(safe(c6) / 12, 0, 1) * 15 + clamp(c24 / 25, 0, 1) * 10,
    activity: clamp(Math.log10(1 + safe(t.trades24h)) / 4, 0, 1) * 10,
  };
  let score = Object.values(parts).reduce((a, b) => a + b, 0);
  const flags = [];
  if (c1 > 25) { score -= 15; flags.push('vertical 1h candle'); }
  if (c24 > P.maxChange24hPct) { score -= 20; flags.push('overextended 24h'); }
  if (c1 < -4) { score -= 10; flags.push('dumping now'); }
  if (bp < 0.42) { score -= 10; flags.push('sellers dominate'); }
  if (prints1 < 20) { score *= 0.6; flags.push('thin last hour'); }
  return { score: Math.round(clamp(score, 0, 100)), flags, m: { accel, bp, c1, c6, c24 } };
}

async function cycle() {
  const chain = await resolveChain(CONFIG.chain || 'base');
  const pf = new Portfolio(chain, { name: 'trend-hunter' });
  const tokens = await board(chain, { limit: 200 });
  const pre = tokens.filter((t) => !chain.anchorSet.has(t.address) && !STABLE_SYMBOLS.has(String(t.symbol).toUpperCase()) && !t.screen && safe(t.volume24h) >= P.minVolume24h);
  // A cheap proxy picks which tokens get the candle pull.
  const proxy = (t) => (safe(t.buyVolume24h) / Math.max(1, safe(t.buyVolume24h) + safe(t.sellVolume24h))) * Math.log10(1 + safe(t.volume24h)) + clamp(safe(t.change24hPct), -20, 40) / 20;
  const deep = [...pre].sort((a, b) => proxy(b) - proxy(a)).slice(0, P.deepScan);
  const charts = await mapLimit(deep, 3, (t) => candles(chain, t.address, { tf: '1h', limit: 30 }));
  const scored = deep.map((t, i) => (Array.isArray(charts[i]) && charts[i].length >= 8 ? { t, ...scoreToken(t, charts[i]) } : null))
    .filter(Boolean).sort((a, b) => b.score - a.score);

  const marks = await pf.manageExits({ ...P.exits, prices: Object.fromEntries(tokens.map((t) => [t.address, t.priceUsd])) });
  const entries = [];
  for (const s of scored.filter((x) => x.score >= P.buyScore && !x.flags.length).slice(0, 3)) {
    const size = CONFIG.maxTradeUsd * clamp(((s.score - P.buyScore) / (100 - P.buyScore)) * 0.5 + 0.5, 0.5, 1);
    if (await pf.buy({ token: s.t.address, symbol: s.t.symbol, decimals: s.t.decimals, sizeUsd: size, meta: { score: s.score } })) entries.push(s.t.symbol);
  }

  const md = [
    `# Trend Hunter on ${chain.label}, ${new Date().toISOString()}`,
    `Board ${tokens.length} tokens, ${pre.length} with ${usd(P.minVolume24h)}+ volume, ${scored.length} scored from hourly candles. Buy at score ${P.buyScore}+ with no flags.`,
    '',
    table(['#', 'Token', 'Score', 'Price', '1h', '6h', '24h', 'Vol accel', 'Buy share', 'Flags'],
      scored.slice(0, 15).map((s, i) => [i + 1, s.t.symbol, s.score, usd(s.t.priceUsd), pct(s.m.c1), pct(s.m.c6), pct(s.m.c24), `${s.m.accel.toFixed(2)}x`, `${(s.m.bp * 100).toFixed(0)}%`, s.flags.join(', ') || '—'])),
    '',
    `Entries this cycle: ${entries.join(', ') || 'none'}`,
    `Book: ${pf.line(marks)}`,
  ].join('\n');
  writeReport('report.md', md);
  console.log(md);
}

if (import.meta.url === `file://${process.argv[1]}`) runAgent('trend-hunter', cycle, 300);
