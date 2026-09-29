#!/usr/bin/env node
// Run a Pine Script file through PineTS and print a summary of its plots.
//   node pine/run.mjs <script.pine> [--csv file.csv | --symbol BTCUSDT --tf 1h --bars 500 | --synthetic N] [--json out.json]
// CSV columns: time(ms or ISO),open,high,low,close,volume  (header row optional)
import { readFileSync, writeFileSync } from 'node:fs';
import { PineTS, Provider } from 'pinets';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && a.endsWith('.pine'));
const opt = (name, def) => {
    const i = args.indexOf('--' + name);
    return i >= 0 ? args[i + 1] : def;
};
if (!file) {
    console.error('usage: node pine/run.mjs <script.pine> [--csv f | --symbol S --tf T --bars N | --synthetic N] [--json out]');
    process.exit(1);
}

function loadCsv(path) {
    return readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => l.split(','))
        .filter((c) => !isNaN(+c[1]))
        .map((c) => {
            const t = isNaN(+c[0]) ? Date.parse(c[0]) : +c[0];
            return { openTime: t, open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +(c[5] ?? 0), closeTime: t };
        });
}

function synthetic(n) {
    let seed = 42, price = 100, t = Date.UTC(2024, 0, 1);
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    return Array.from({ length: n }, () => {
        const open = price, close = open + (rnd() - 0.5) * 2;
        const c = { open, high: Math.max(open, close) + rnd(), low: Math.min(open, close) - rnd(), close, volume: 1000 + rnd() * 500, openTime: t, closeTime: t + 299999 };
        price = close; t += 300000;
        return c;
    });
}

// Offline provider: serves the given base candles (and resamples them for request.security).
const TF_MS = { '1': 6e4, '3': 18e4, '5': 3e5, '15': 9e5, '30': 18e5, '60': 36e5, '1h': 36e5, '240': 144e5, '4h': 144e5, D: 864e5, '1D': 864e5, W: 6048e5, '1W': 6048e5 };
const tfMs = (tf) => TF_MS[tf] ?? (/^\d+$/.test(tf) ? +tf * 6e4 : 3e5);

class LocalProvider {
    constructor(candles, ticker, baseTf) { this.candles = candles; this.ticker = ticker; this.baseTf = baseTf; }
    configure() {}
    async getMarketData(_id, tf, limit) {
        const ms = tfMs(tf), base = tfMs(this.baseTf);
        let out = this.candles;
        if (ms > base) {
            const buckets = new Map();
            for (const c of this.candles) {
                const k = Math.floor(c.openTime / ms) * ms, b = buckets.get(k);
                if (!b) buckets.set(k, { ...c, openTime: k, closeTime: k + ms });
                else { b.high = Math.max(b.high, c.high); b.low = Math.min(b.low, c.low); b.close = c.close; b.volume += c.volume; }
            }
            out = [...buckets.values()];
        }
        return limit ? out.slice(-limit) : out;
    }
    async getSymbolInfo(id) {
        return { prefix: 'LOCAL', root: this.ticker, ticker: this.ticker, tickerid: `LOCAL:${this.ticker}`, description: this.ticker, type: 'stock',
            currency: 'USD', basecurrency: 'USD', timezone: 'America/New_York', session: 'regular', mintick: 0.01, minmove: 1, pricescale: 100,
            pointvalue: 1, mincontract: 1, volumetype: 'base', country: '', industry: '', sector: '', isin: '', main_tickerid: id, current_contract: '' };
    }
}

const tf = opt('tf', '5'), ticker = opt('ticker', 'TEST');
let pine;
if (opt('symbol')) pine = new PineTS(Provider.Binance, opt('symbol'), opt('tf', '1h'), +opt('bars', 500));
else {
    const candles = opt('csv') ? loadCsv(opt('csv')) : synthetic(+opt('synthetic', 500));
    pine = new PineTS(new LocalProvider(candles, ticker, tf), ticker, tf, candles.length);
}

const code = readFileSync(file, 'utf8');
try {
    const res = await pine.run(code);
    const plots = res.plots ?? {};
    console.log(`OK: ${Object.keys(plots).filter((n) => !n.startsWith('__')).length} plots`);
    for (const [name, p] of Object.entries(plots).filter(([n]) => !n.startsWith('__'))) {
        const vals = p.data.map((d) => d.value).filter((v) => typeof v === 'number' && Number.isFinite(v));
        console.log(`  ${name.padEnd(30)} points=${vals.length} last=${vals.at(-1)}`);
    }
    if (opt('json')) writeFileSync(opt('json'), JSON.stringify(plots, null, 1));
} catch (e) {
    console.error('FAILED:', e.message);
    if (process.env.DEBUG) console.error(e.stack);
    process.exit(2);
}
