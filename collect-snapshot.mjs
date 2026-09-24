import { createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const BITVAVO = "https://api.bitvavo.com/v2";
const MAX_DEEP_MARKETS = 9;
const MIN_VOLUME_QUOTE = 100000;
const MAX_SPREAD_PCT = 0.75;
const BOOK_DEPTH = 10;
const CANDLE_LIMIT = 120;
const OUTPUT_PATH = process.env.SNAPSHOT_OUTPUT || "snapshot.json";

const API_KEY = process.env.BITVAVO_API_KEY;
const API_SECRET = process.env.BITVAVO_API_SECRET;

if (!API_KEY || !API_SECRET) {
  throw new Error("BITVAVO_API_KEY and BITVAVO_API_SECRET are required");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signature(path, timestamp) {
  return createHmac("sha256", API_SECRET)
    .update(timestamp + "GET" + path)
    .digest("hex");
}

function retryDelayMs(response, body, attempt) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 60000);
  }

  try {
    const parsed = JSON.parse(body);
    const match = String(parsed?.error || "").match(/expires at (\d{10,13})/i);
    if (match) {
      let expiresAt = Number(match[1]);
      if (expiresAt < 1e12) expiresAt *= 1000;
      const wait = expiresAt - Date.now() + 1000;
      if (wait > 0) return Math.min(wait, 60000);
    }
  } catch {}

  return Math.min(1500 * (2 ** attempt), 15000);
}

async function getJson(url, { attempts = 4 } = {}) {
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    const timestamp = Date.now().toString();
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "bitvavo-github-collector/1.0",
        "Bitvavo-Access-Key": API_KEY,
        "Bitvavo-Access-Timestamp": timestamp,
        "Bitvavo-Access-Signature": signature(path, timestamp),
        "Bitvavo-Access-Window": "10000"
      }
    });

    if (response.ok) return response.json();

    const body = await response.text();
    lastError = new Error(`HTTP ${response.status} on ${url}: ${body.slice(0, 400)}`);

    if (attempt + 1 >= attempts || (response.status !== 429 && response.status < 500)) {
      throw lastError;
    }

    await sleep(retryDelayMs(response, body, attempt));
  }

  throw lastError;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function compactTicker(ticker) {
  const open = num(ticker?.open);
  const last = num(ticker?.last);
  const bid = num(ticker?.bid);
  const ask = num(ticker?.ask);
  const volumeQuote = num(ticker?.volumeQuote);

  const change24hPct =
    open && last
      ? ((last - open) / open) * 100
      : null;

  const spreadPct =
    bid && ask
      ? ((ask - bid) / ((ask + bid) / 2)) * 100
      : null;

  return {
    market: ticker?.market,
    last,
    bid,
    ask,
    spreadPct,
    change24hPct,
    volumeQuote,
    high: num(ticker?.high),
    low: num(ticker?.low),
    volume: num(ticker?.volume),
    timestamp: ticker?.timestamp ?? null
  };
}

async function getPaperOpenMarkets() {
  try {
    const raw = await readFile("paper/open-markets.json", "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data?.markets)
      ? data.markets.filter((m) => typeof m === "string" && m.endsWith("-EUR")).slice(0, 6)
      : [];
  } catch {
    return [];
  }
}

function selectDeepMarkets(universe, forcedMarkets = []) {
  const tradable = universe.filter((t) =>
    t.market &&
    t.market.endsWith("-EUR") &&
    t.volumeQuote !== null &&
    t.volumeQuote >= MIN_VOLUME_QUOTE &&
    t.spreadPct !== null &&
    t.spreadPct <= MAX_SPREAD_PCT &&
    t.last !== null &&
    t.last > 0 &&
    t.change24hPct !== null
  );

  const byVolume = [...tradable]
    .sort((a, b) => (b.volumeQuote ?? 0) - (a.volumeQuote ?? 0));

  const byMomentum = [...tradable]
    .filter((t) => Math.abs(t.change24hPct) >= 2 && Math.abs(t.change24hPct) <= 35)
    .sort((a, b) => {
      const scoreA = Math.abs(a.change24hPct) * Math.log10(Math.max(a.volumeQuote, 1));
      const scoreB = Math.abs(b.change24hPct) * Math.log10(Math.max(b.volumeQuote, 1));
      return scoreB - scoreA;
    });

  const byModerateMove = [...tradable]
    .filter((t) => Math.abs(t.change24hPct) >= 1.5 && Math.abs(t.change24hPct) <= 15)
    .sort((a, b) => {
      const scoreA = Math.abs(a.change24hPct) * Math.sqrt(Math.max(a.volumeQuote, 1));
      const scoreB = Math.abs(b.change24hPct) * Math.sqrt(Math.max(b.volumeQuote, 1));
      return scoreB - scoreA;
    });

  const selected = [];
  const add = (market) => {
    if (market && !selected.includes(market) && selected.length < MAX_DEEP_MARKETS) {
      selected.push(market);
    }
  };

  add("BTC-EUR");
  add("ETH-EUR");

  const universeMarkets = new Set(universe.map((t) => t.market));
  forcedMarkets.filter((m) => universeMarkets.has(m)).forEach(add);

  byVolume.slice(0, 5).forEach((t) => add(t.market));
  byMomentum.slice(0, 4).forEach((t) => add(t.market));
  byModerateMove.slice(0, 4).forEach((t) => add(t.market));

  for (const t of byVolume) add(t.market);

  return {
    tradable,
    selected: selected.slice(0, MAX_DEEP_MARKETS),
    topByMomentum: byMomentum.slice(0, 10).map((t) => t.market),
    topByVolume: byVolume.slice(0, 10).map((t) => t.market),
    topByModerateMove: byModerateMove.slice(0, 10).map((t) => t.market)
  };
}

async function collectDeepMarket(market, ticker) {
  const [book, candles5m, candles15m, candles1h] = await Promise.all([
    getJson(`${BITVAVO}/${market}/book?depth=${BOOK_DEPTH}`),
    getJson(`${BITVAVO}/${market}/candles?interval=5m&limit=${CANDLE_LIMIT}`),
    getJson(`${BITVAVO}/${market}/candles?interval=15m&limit=${CANDLE_LIMIT}`),
    getJson(`${BITVAVO}/${market}/candles?interval=1h&limit=${CANDLE_LIMIT}`)
  ]);

  return {
    market,
    ticker,
    orderBook: {
      depth: BOOK_DEPTH,
      bids: book.bids,
      asks: book.asks,
      nonce: book.nonce
    },
    candles: {
      "5m": candles5m,
      "15m": candles15m,
      "1h": candles1h
    }
  };
}

async function collectSnapshot() {
  const ticker24h = await getJson(`${BITVAVO}/ticker/24h`);

  if (!Array.isArray(ticker24h)) {
    throw new Error("Bitvavo ticker/24h did not return an array");
  }

  const universe = ticker24h
    .filter((t) => typeof t?.market === "string" && t.market.endsWith("-EUR"))
    .map(compactTicker)
    .sort((a, b) => (b.volumeQuote ?? 0) - (a.volumeQuote ?? 0));

  const forcedPaperMarkets = await getPaperOpenMarkets();
  const selection = selectDeepMarkets(universe, forcedPaperMarkets);
  const tickerMap = new Map(universe.map((t) => [t.market, t]));
  const deep = {};

  for (let i = 0; i < selection.selected.length; i += 3) {
    const batch = selection.selected.slice(i, i + 3);
    const results = await Promise.all(
      batch.map((market) => collectDeepMarket(market, tickerMap.get(market)))
    );
    for (const result of results) deep[result.market] = result;
  }

  return {
    ok: true,
    version: "2.2",
    source: "Bitvavo public REST API",
    collectedAt: new Date().toISOString(),
    config: {
      maxDeepMarkets: MAX_DEEP_MARKETS,
      minVolumeQuote: MIN_VOLUME_QUOTE,
      maxSpreadPct: MAX_SPREAD_PCT,
      bookDepth: BOOK_DEPTH,
      candleLimit: CANDLE_LIMIT,
      timeframes: ["5m", "15m", "1h"]
    },
    universeStats: {
      eurMarkets: universe.length,
      liquidTradableMarkets: selection.tradable.length
    },
    selection: {
      deepMarkets: selection.selected,
      forcedPaperMarkets,
      topByMomentum: selection.topByMomentum,
      topByModerateMove: selection.topByModerateMove,
      topByVolume: selection.topByVolume
    },
    deep
  };
}

const snapshot = await collectSnapshot();
await writeFile(OUTPUT_PATH, JSON.stringify(snapshot) + "\n", "utf8");

console.log(JSON.stringify({
  ok: true,
  collectedAt: snapshot.collectedAt,
  selectedMarkets: snapshot.selection.deepMarkets,
  universeStats: snapshot.universeStats,
  output: OUTPUT_PATH
}, null, 2));
