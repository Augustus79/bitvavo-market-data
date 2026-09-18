const BITVAVO = "https://api.bitvavo.com/v2";

const GITHUB_OWNER = "Augustus79";
const GITHUB_REPO = "bitvavo-market-data";
const GITHUB_FILE = "snapshot.json";
const GITHUB_BRANCH = "main";

const MAX_DEEP_MARKETS = 10;
const MIN_VOLUME_QUOTE = 100000;
const MAX_SPREAD_PCT = 0.75;
const BOOK_DEPTH = 50;
const CANDLE_LIMIT = 120;

async function hmacHex(secret, payload) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getJson(url, env) {
  const parsed = new URL(url);
  const path = parsed.pathname + parsed.search;
  const timestamp = Date.now().toString();
  const headers = {
    "Accept": "application/json",
    "User-Agent": "bitvavo-collector/2.2"
  };

  if (env?.BITVAVO_API_KEY && env?.BITVAVO_API_SECRET) {
    const payload = timestamp + "GET" + path;
    headers["Bitvavo-Access-Key"] = env.BITVAVO_API_KEY;
    headers["Bitvavo-Access-Timestamp"] = timestamp;
    headers["Bitvavo-Access-Signature"] = await hmacHex(env.BITVAVO_API_SECRET, payload);
    headers["Bitvavo-Access-Window"] = "10000";
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status} on ${url}: ${text.slice(0, 400)}`);
  }

  return response.json();
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    }
  });
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

function selectDeepMarkets(universe) {
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

async function collectDeepMarket(market, ticker, env) {
  const [book, candles5m, candles15m, candles1h] = await Promise.all([
    getJson(`${BITVAVO}/${market}/book?depth=${BOOK_DEPTH}`, env),
    getJson(`${BITVAVO}/${market}/candles?interval=5m&limit=${CANDLE_LIMIT}`, env),
    getJson(`${BITVAVO}/${market}/candles?interval=15m&limit=${CANDLE_LIMIT}`, env),
    getJson(`${BITVAVO}/${market}/candles?interval=1h&limit=${CANDLE_LIMIT}`, env)
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

async function collectSnapshot(env) {
  const ticker24h = await getJson(`${BITVAVO}/ticker/24h`, env);

  if (!Array.isArray(ticker24h)) {
    throw new Error("Bitvavo ticker/24h did not return an array");
  }

  const universe = ticker24h
    .filter((t) => typeof t?.market === "string" && t.market.endsWith("-EUR"))
    .map(compactTicker)
    .sort((a, b) => (b.volumeQuote ?? 0) - (a.volumeQuote ?? 0));

  const selection = selectDeepMarkets(universe);
  const tickerMap = new Map(universe.map((t) => [t.market, t]));

  const deep = {};

  for (let i = 0; i < selection.selected.length; i += 2) {
    const batch = selection.selected.slice(i, i + 2);

    const results = await Promise.all(
      batch.map((market) =>
        collectDeepMarket(market, tickerMap.get(market), env)
      )
    );

    for (const result of results) {
      deep[result.market] = result;
    }
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
      topByMomentum: selection.topByMomentum,
      topByModerateMove: selection.topByModerateMove,
      topByVolume: selection.topByVolume
    },
    universe,
    deep
  };
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

async function publishToGitHub(snapshot, token) {
  if (!token) {
    throw new Error("GITHUB_TOKEN absent du Worker");
  }

  const apiUrl =
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`;

  const headers = {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "bitvavo-collector/2.2"
  };

  let sha;

  const existing = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, {
    headers
  });

  if (existing.ok) {
    const existingData = await existing.json();
    sha = existingData.sha;
  } else if (existing.status !== 404) {
    const text = await existing.text();
    throw new Error(
      `GitHub read ${existing.status}: ${text.slice(0, 400)}`
    );
  }

  const body = {
    message: "Update Bitvavo market snapshot v2",
    content: utf8ToBase64(JSON.stringify(snapshot, null, 2)),
    branch: GITHUB_BRANCH
  };

  if (sha) {
    body.sha = sha;
  }

  const response = await fetch(apiUrl, {
    method: "PUT",
    headers: {
      ...headers,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `GitHub write ${response.status}: ${text.slice(0, 500)}`
    );
  }

  const result = await response.json();

  return {
    path: result.content?.path,
    sha: result.content?.sha,
    commit: result.commit?.sha
  };
}

async function buildAndPublish(env) {
  const snapshot = await collectSnapshot(env);
  const github = await publishToGitHub(snapshot, env.GITHUB_TOKEN);

  return {
    ok: true,
    message: "Multi-market snapshot published to GitHub",
    collectedAt: snapshot.collectedAt,
    selectedMarkets: snapshot.selection.deepMarkets,
    universeStats: snapshot.universeStats,
    github
  };
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname === "/" || url.pathname === "/health") {
        return jsonResponse({
          ok: true,
          service: "bitvavo-collector",
          version: "2.2",
          routes: {
            market: "/market/BTC-EUR",
            publish: "/publish"
          },
          scheduledHandler: true
        });
      }

      if (url.pathname === "/publish") {
        return jsonResponse(await buildAndPublish(env));
      }

      const match = url.pathname.match(
        /^\/market\/([A-Z0-9]+-EUR)$/
      );

      if (!match) {
        return jsonResponse(
          {
            ok: false,
            error: "Route inconnue",
            examples: [
              "/market/BTC-EUR",
              "/market/ETH-EUR",
              "/market/SOL-EUR",
              "/publish"
            ]
          },
          404
        );
      }

      const market = match[1];
      const ticker24h = await getJson(
        `${BITVAVO}/ticker/24h?market=${market}`,
        env
      );
      const rawTicker = Array.isArray(ticker24h)
        ? ticker24h[0]
        : ticker24h;

      const data = await collectDeepMarket(
        market,
        compactTicker(rawTicker),
        env
      );

      return jsonResponse({
        ok: true,
        source: "Bitvavo public REST API",
        collectedAt: new Date().toISOString(),
        ...data
      });
    } catch (error) {
      return jsonResponse(
        {
          ok: false,
          error: error?.message || String(error)
        },
        500
      );
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      buildAndPublish(env).catch((error) => {
        console.error("Scheduled publish failed:", error);
      })
    );
  }
};