const BITVAVO = "https://api.bitvavo.com/v2";

const GITHUB_OWNER = "Augustus79";
const GITHUB_REPO = "bitvavo-market-data";
const GITHUB_FILE = "snapshot.json";
const GITHUB_BRANCH = "main";
const PRIVATE_ACCOUNT_FILE = "account-state.json";
const PAPER_OPEN_MARKETS_URL = "https://raw.githubusercontent.com/Augustus79/bitvavo-market-data/main/paper/open-markets.json";
const SIGNALS_URL = "https://raw.githubusercontent.com/Augustus79/bitvavo-market-data/main/signals.json";
const AI_REVIEW_URL = "https://raw.githubusercontent.com/Augustus79/bitvavo-market-data/main/ai/latest-review.json";
const LIVE_ALERT_STATE_FILE = "live-alert-state.json";
const EXECUTION_REHEARSAL_FILE = "execution-rehearsals.json";
const PUBLIC_WORKER_BASE = "https://bitvavo-collector.nicolasbonnin79.workers.dev";
const ALERT_SIGNAL_MAX_AGE_MIN = 8;
const ALERT_RESERVATION_MIN = 20;
const MAX_LIVE_POSITIONS = 2;
const MAX_COMBINED_LIVE_RISK_EUR = 3;
const STRICT_MIN_NET_RR = 1.5;
const PRE_ALERT_MIN_SCORE = 9;
const PRE_ALERT_MIN_LIVE_NET_RR = 1.25;
const PRE_ALERT_COOLDOWN_MIN = 60;
const AUTO_MAX_POSITIONS = 1;
const AUTO_MAX_NOTIONAL_EUR = 100;
const AUTO_DAILY_LOSS_LIMIT_EUR = 5;
const AUTO_SIGNAL_MAX_AGE_SEC = 90;
const DEFAULT_MAKER_FEE_PCT = 0.15;
const DEFAULT_TAKER_FEE_PCT = 0.25;
const SLIPPAGE_BUFFER_PCT = 0.03;

const MAX_DEEP_MARKETS = 9;
const MIN_VOLUME_QUOTE = 100000;
const MAX_SPREAD_PCT = 0.75;
const BOOK_DEPTH = 10;
const CANDLE_LIMIT = 120;

const TEXT_ENCODER = new TextEncoder();
let cachedHmacSecret = null;
let cachedHmacKey = null;

async function hmacHex(secret, payload) {
  if (!cachedHmacKey || cachedHmacSecret !== secret) {
    cachedHmacKey = await crypto.subtle.importKey(
      "raw", TEXT_ENCODER.encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    cachedHmacSecret = secret;
  }
  const signature = await crypto.subtle.sign("HMAC", cachedHmacKey, TEXT_ENCODER.encode(payload));
  const bytes = new Uint8Array(signature);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function liveTradingCredentialsConfigured(env) {
  return Boolean(
    env?.LIVE_BITVAVO_API_KEY &&
    env?.LIVE_BITVAVO_API_SECRET &&
    Number.isInteger(Number(env?.LIVE_TRADING_OPERATOR_ID))
  );
}

function liveTradingEnabled(env) {
  return env?.LIVE_TRADING_ENABLED === "true" && liveTradingCredentialsConfigured(env);
}

async function livePrivateJson(env, method, endpoint, { query = null, body = null } = {}) {
  if (!liveTradingCredentialsConfigured(env)) {
    throw new Error("Dedicated live-trading Bitvavo credentials are not configured");
  }

  const qs = query
    ? "?" + new URLSearchParams(
        Object.entries(query)
          .filter(([,v]) => v !== null && v !== undefined)
          .map(([k,v]) => [k, String(v)])
      ).toString()
    : "";
  const path = `/v2${endpoint}${qs}`;
  const url = `https://api.bitvavo.com${path}`;
  const timestamp = Date.now().toString();
  const bodyText = body ? JSON.stringify(body) : "";
  const payload = timestamp + method + path + bodyText;
  const signature = await hmacHex(env.LIVE_BITVAVO_API_SECRET, payload);

  const response = await fetch(url, {
    method,
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": "bitvavo-collector/2.24",
      "Bitvavo-Access-Key": env.LIVE_BITVAVO_API_KEY,
      "Bitvavo-Access-Timestamp": timestamp,
      "Bitvavo-Access-Signature": signature,
      "Bitvavo-Access-Window": "10000"
    },
    body: body ? bodyText : undefined
  });

  const data = await response.json().catch(async () => ({ raw: await response.text().catch(() => "") }));
  if (!response.ok) {
    const err = new Error(`Bitvavo live API ${method} ${endpoint} failed (${response.status}): ${JSON.stringify(data).slice(0,500)}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function runLiveCredentialCheck(env) {
  const checkedAt = new Date().toISOString();

  if (!liveTradingCredentialsConfigured(env)) {
    return {
      ok: false,
      checkedAt,
      credentialsConfigured: false,
      balanceRead: false,
      openOrdersRead: false,
      orderSubmitted: false,
      reason: "Dedicated live credentials are not configured"
    };
  }

  try {
    const balances = await livePrivateJson(env, "GET", "/balance");
    const openOrders = await livePrivateJson(env, "GET", "/ordersOpen", {
      query: { market: "BTC-EUR" }
    });

    return {
      ok: true,
      checkedAt,
      credentialsConfigured: true,
      balanceRead: Array.isArray(balances),
      openOrdersRead: Array.isArray(openOrders),
      operatorIdValid: Number.isInteger(Number(env?.LIVE_TRADING_OPERATOR_ID)),
      liveTradingEnabled: liveTradingEnabled(env),
      orderSubmitted: false
    };
  } catch (error) {
    return {
      ok: false,
      checkedAt,
      credentialsConfigured: true,
      balanceRead: false,
      openOrdersRead: false,
      operatorIdValid: Number.isInteger(Number(env?.LIVE_TRADING_OPERATOR_ID)),
      liveTradingEnabled: liveTradingEnabled(env),
      orderSubmitted: false,
      reason: error?.message || String(error)
    };
  }
}

async function getJson(url, env, { auth = true } = {}) {
  const parsed = new URL(url);
  const path = parsed.pathname + parsed.search;
  const timestamp = Date.now().toString();
  const headers = {
    "Accept": "application/json",
    "User-Agent": "bitvavo-collector/2.24"
  };

  if (auth) {
    if (!env?.BITVAVO_API_KEY || !env?.BITVAVO_API_SECRET) {
      throw new Error("Bitvavo private API credentials missing");
    }
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

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer"
    }
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
    const response = await fetch(PAPER_OPEN_MARKETS_URL, {
      headers: { "Accept": "application/json", "User-Agent": "bitvavo-collector/2.24" },
      cf: { cacheTtl: 0, cacheEverything: false }
    });
    if (!response.ok) return [];
    const data = await response.json();
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

  const forcedPaperMarkets = await getPaperOpenMarkets();
  const selection = selectDeepMarkets(universe, forcedPaperMarkets);
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
      forcedPaperMarkets,
      topByMomentum: selection.topByMomentum,
      topByModerateMove: selection.topByModerateMove,
      topByVolume: selection.topByVolume
    },
    deep
  };
}

function utf8ToBase64(text) {
  const bytes = TEXT_ENCODER.encode(text);
  let binary = "";
  const chunkSize = 0x4000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

async function publishJsonToRepo({ owner, repo, path, branch = "main", data, token, message }) {
  if (!token) throw new Error("GitHub token missing");
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "bitvavo-collector/2.24"
  };

  let sha;
  const existing = await fetch(`${apiUrl}?ref=${branch}`, { headers });
  if (existing.ok) {
    const existingData = await existing.json();
    sha = existingData.sha;
  } else if (existing.status !== 404) {
    const text = await existing.text();
    throw new Error(`GitHub read ${existing.status}: ${text.slice(0, 400)}`);
  }

  const body = {
    message,
    content: utf8ToBase64(JSON.stringify(data)),
    branch
  };
  if (sha) body.sha = sha;

  const response = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub write ${response.status}: ${text.slice(0, 500)}`);
  }
  const result = await response.json();
  return {
    path: result.content?.path,
    sha: result.content?.sha,
    commit: result.commit?.sha
  };
}

function base64ToUtf8(base64) {
  const clean = String(base64 || "").replace(/\n/g, "");
  const binary = atob(clean);
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function readJsonFromRepo({ owner, repo, path, branch = "main", token }) {
  if (!token) return null;
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const response = await fetch(apiUrl, {
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "bitvavo-collector/2.24"
    }
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub private read ${response.status}: ${text.slice(0, 400)}`);
  }
  const data = await response.json();
  return JSON.parse(base64ToUtf8(data.content));
}

function parsePrivateRepo(value) {
  if (!value || typeof value !== "string" || !value.includes("/")) return null;
  const [owner, repo] = value.split("/");
  return owner && repo ? { owner, repo } : null;
}

async function collectPrivateAccountState(env) {
  const [balances, openOrders, fees] = await Promise.all([
    getJson(`${BITVAVO}/balance`, env, { auth: true }),
    getJson(`${BITVAVO}/ordersOpen`, env, { auth: true }),
    getJson(`${BITVAVO}/account/fees?quote=EUR`, env, { auth: true })
  ]);

  const normalizedBalances = Array.isArray(balances)
    ? balances.map((b) => ({
        symbol: b?.symbol ?? null,
        available: num(b?.available),
        inOrder: num(b?.inOrder)
      })).filter((b) => b.symbol)
    : [];

  const normalizedOrders = Array.isArray(openOrders)
    ? openOrders.map((o) => ({
        orderId: o?.orderId ?? null,
        market: o?.market ?? null,
        side: o?.side ?? null,
        orderType: o?.orderType ?? null,
        status: o?.status ?? null,
        amount: num(o?.amount),
        amountRemaining: num(o?.amountRemaining),
        price: num(o?.price),
        stopPrice: num(o?.stopPrice),
        created: o?.created ?? null,
        updated: o?.updated ?? null
      }))
    : [];

  return {
    ok: true,
    version: "1.0",
    source: "Bitvavo private REST API (read-only key)",
    collectedAt: new Date().toISOString(),
    permissionsExpected: {
      read: true,
      trade: false,
      withdraw: false
    },
    balances: normalizedBalances,
    openOrders: normalizedOrders,
    openOrderCount: normalizedOrders.length,
    nonEurAssetCount: normalizedBalances.filter((b) =>
      b.symbol !== "EUR" && ((b.available || 0) > 0 || (b.inOrder || 0) > 0)
    ).length,
    fees: {
      tier: fees?.tier ?? null,
      volume30dEur: num(fees?.volume),
      makerPct: num(fees?.maker) === null ? null : num(fees?.maker) * 100,
      takerPct: num(fees?.taker) === null ? null : num(fees?.taker) * 100
    }
  };
}

async function publishPrivateAccountState(env) {
  const target = parsePrivateRepo(env?.PRIVATE_GITHUB_REPO);
  if (!target || !env?.PRIVATE_GITHUB_TOKEN) {
    return { ok: false, skipped: true, reason: "private GitHub target not configured" };
  }
  const account = await collectPrivateAccountState(env);
  const github = await publishJsonToRepo({
    owner: target.owner,
    repo: target.repo,
    path: PRIVATE_ACCOUNT_FILE,
    branch: "main",
    data: account,
    token: env.PRIVATE_GITHUB_TOKEN,
    message: "Update private Bitvavo account state"
  });
  return { ok: true, collectedAt: account.collectedAt, github };
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
    "User-Agent": "bitvavo-collector/2.24"
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
    content: utf8ToBase64(JSON.stringify(snapshot)),
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

async function fetchPublicRepoJson(path, env, rawFallbackUrl) {
  if (env?.GITHUB_TOKEN) {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}`,
      {
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "bitvavo-collector/2.24"
        }
      }
    );
    if (response.status === 404) return null;
    if (response.ok) {
      const data = await response.json();
      return JSON.parse(base64ToUtf8(data.content));
    }
  }

  const response = await fetch(`${rawFallbackUrl}?ts=${Date.now()}`, {
    headers: { "Accept": "application/json", "User-Agent": "bitvavo-collector/2.24" },
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path} fetch ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.json();
}

async function fetchLatestSignals(env) {
  return fetchPublicRepoJson("signals.json", env, SIGNALS_URL);
}

async function fetchLatestAiReview(env) {
  return fetchPublicRepoJson("ai/latest-review.json", env, AI_REVIEW_URL);
}

function emptyLiveAlertState() {
  return {
    version: "1.7",
    updatedAt: null,
    notifiedKeys: [],
    pendingRecommendations: [],
    activePositions: [],
    notificationHistory: [],
    preAlerts: [],
    preAlertHistory: [],
    signalValidityWindows: [],
    reactionMetrics: null,
    autoExecutionKeys: [],
    autoDryRunKeys: [],
    autoDryRunHistory: [],
    autoAttemptHistory: [],
    autoPositions: [],
    autoTradeHistory: [],
    autoTradingHalted: false,
    autoTradingHaltReason: null
  };
}

function heldSymbols(account) {
  return new Set((account?.balances || [])
    .filter((b) => b.symbol !== "EUR" && ((b.available || 0) > 0 || (b.inOrder || 0) > 0))
    .map((b) => b.symbol));
}

function reconcileLiveAlertState(rawState, account, nowMs) {
  const state = { ...emptyLiveAlertState(), ...(rawState || {}) };
  state.version = "1.7";
  state.notifiedKeys = Array.isArray(state.notifiedKeys) ? state.notifiedKeys.slice(-200) : [];
  state.autoExecutionKeys = Array.isArray(state.autoExecutionKeys) ? state.autoExecutionKeys.slice(-500) : [];
  state.autoDryRunKeys = Array.isArray(state.autoDryRunKeys) ? state.autoDryRunKeys.slice(-500) : [];
  state.autoDryRunHistory = Array.isArray(state.autoDryRunHistory) ? state.autoDryRunHistory.slice(-500) : [];
  state.autoAttemptHistory = Array.isArray(state.autoAttemptHistory) ? state.autoAttemptHistory.slice(-1000) : [];
  state.autoPositions = Array.isArray(state.autoPositions) ? state.autoPositions : [];
  state.autoTradeHistory = Array.isArray(state.autoTradeHistory) ? state.autoTradeHistory.slice(-500) : [];
  state.autoTradingHalted = Boolean(state.autoTradingHalted);
  state.autoTradingHaltReason = state.autoTradingHaltReason || null;
  state.pendingRecommendations = Array.isArray(state.pendingRecommendations) ? state.pendingRecommendations : [];
  state.activePositions = Array.isArray(state.activePositions) ? state.activePositions : [];
  state.notificationHistory = Array.isArray(state.notificationHistory) ? state.notificationHistory.slice(-200) : [];
  state.preAlerts = Array.isArray(state.preAlerts) ? state.preAlerts : [];
  state.preAlertHistory = Array.isArray(state.preAlertHistory) ? state.preAlertHistory.slice(-200) : [];
  state.signalValidityWindows = Array.isArray(state.signalValidityWindows) ? state.signalValidityWindows.slice(-200) : [];

  const held = heldSymbols(account);
  const activeByMarket = new Map();
  for (const p of state.activePositions) {
    const symbol = String(p.market || "").replace(/-EUR$/, "");
    if (held.has(symbol)) activeByMarket.set(p.market, p);
  }

  const pending = [];
  for (const p of state.pendingRecommendations) {
    const symbol = String(p.market || "").replace(/-EUR$/, "");
    if (held.has(symbol)) {
      if (!activeByMarket.has(p.market)) {
        activeByMarket.set(p.market, {
          ...p,
          activatedAt: new Date(nowMs).toISOString(),
          signalToExecutionDetectedSec: Number.isFinite(Date.parse(p.signalSnapshotAt))
            ? Number(((nowMs - Date.parse(p.signalSnapshotAt)) / 1000).toFixed(2))
            : null,
          notificationToExecutionDetectedSec: Number.isFinite(Date.parse(p.notifiedAt))
            ? Number(((nowMs - Date.parse(p.notifiedAt)) / 1000).toFixed(2))
            : null,
          status: "active"
        });
      }
    } else if (Number(p.expiresAtMs) > nowMs) {
      pending.push(p);
    }
  }

  state.pendingRecommendations = pending;
  state.activePositions = [...activeByMarket.values()];
  state.updatedAt = new Date(nowMs).toISOString();

  const knownSymbols = new Set([
    ...state.activePositions.map((p) => String(p.market).replace(/-EUR$/, "")),
    ...state.autoPositions.map((p) => String(p.market).replace(/-EUR$/, ""))
  ]);
  const unknownHeldSymbols = [...held].filter((s) => !knownSymbols.has(s));
  return { state, unknownHeldSymbols };
}

function floorDecimals(value, decimals) {
  const d = Math.max(0, Math.min(18, Number(decimals) || 0));
  const factor = 10 ** d;
  return Math.floor((Number(value) + Number.EPSILON) * factor) / factor;
}

function floorTick(value, tickSize) {
  const tick = num(tickSize);
  if (!(tick > 0)) return Number(value);
  return Math.floor((Number(value) + 1e-12) / tick) * tick;
}

function ceilTick(value, tickSize) {
  const tick = num(tickSize);
  if (!(tick > 0)) return Number(value);
  return Math.ceil((Number(value) - 1e-12) / tick) * tick;
}

function orderFilledAmount(order) {
  const direct = num(order?.filledAmount);
  if (direct !== null) return direct;
  const amount = num(order?.amount);
  const remaining = num(order?.amountRemaining);
  return amount !== null && remaining !== null ? Math.max(0, amount - remaining) : 0;
}

function orderFilledQuote(order) {
  const direct = num(order?.filledAmountQuote);
  if (direct !== null) return direct;
  const fills = Array.isArray(order?.fills) ? order.fills : [];
  return fills.reduce((sum, f) => sum + (num(f?.amount) || 0) * (num(f?.price) || 0), 0);
}

function orderFeeEur(order, fallbackPrice = null) {
  const fee = num(order?.feePaid) || 0;
  if (!fee) return 0;
  if (order?.feeCurrency === "EUR") return fee;
  const price = num(fallbackPrice);
  return price ? fee * price : 0;
}

async function deterministicUuid(value) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", TEXT_ENCODER.encode(String(value)))
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

async function getMarketRules(market, env) {
  const data = await getJson(`${BITVAVO}/markets?market=${encodeURIComponent(market)}`, env, { auth: true });
  const rules = Array.isArray(data) ? data[0] : data;
  if (!rules || rules.market !== market || rules.status !== "trading") {
    throw new Error(`Market rules unavailable/not trading for ${market}`);
  }
  return rules;
}

function autoDailyRealizedPnlEur(state, nowMs = Date.now()) {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  return (state.autoTradeHistory || [])
    .filter((t) => String(t.closedAt || "").startsWith(day))
    .reduce((sum, t) => sum + (num(t.realizedPnlEur) || 0), 0);
}

function liveOperatorId(env) {
  const id = Number(env?.LIVE_TRADING_OPERATOR_ID);
  if (!Number.isInteger(id)) throw new Error("LIVE_TRADING_OPERATOR_ID must be an integer");
  return id;
}

async function createLiveOrderIdempotent(env, body, clientSeed) {
  const clientOrderId = await deterministicUuid(clientSeed);
  const payload = { ...body, clientOrderId, operatorId: liveOperatorId(env), responseRequired: true };

  try {
    return await livePrivateJson(env, "POST", "/order", { body: payload });
  } catch (error) {
    // If the request reached Bitvavo but the response was lost, recover by the
    // deterministic clientOrderId instead of risking a duplicate live order.
    try {
      return await livePrivateJson(env, "GET", "/order", {
        query: { market: body.market, clientOrderId }
      });
    } catch {
      throw error;
    }
  }
}

async function cancelLiveOrder(env, market, orderId) {
  return livePrivateJson(env, "DELETE", "/order", {
    query: { market, orderId, operatorId: liveOperatorId(env) }
  });
}

async function getLiveOrder(env, market, orderId) {
  return livePrivateJson(env, "GET", "/order", { query: { market, orderId } });
}

async function placeProtectiveStop(env, positionSeed, market, amount, stop, rules) {
  const quantity = floorDecimals(amount, rules.quantityDecimals);
  const triggerAmount = ceilTick(stop, rules.tickSize);
  if (!(quantity > 0 && triggerAmount > 0)) throw new Error("Invalid protective stop values");

  return createLiveOrderIdempotent(
    env,
    {
      market,
      side: "sell",
      orderType: "stopLoss",
      amount: String(quantity),
      triggerAmount: String(triggerAmount),
      triggerType: "price",
      triggerReference: "lastTrade"
    },
    `${positionSeed}|stop`
  );
}

async function emergencyMarketExit(env, positionSeed, market, amount, rules) {
  const quantity = floorDecimals(amount, rules.quantityDecimals);
  if (!(quantity > 0)) throw new Error("Invalid emergency exit quantity");
  return createLiveOrderIdempotent(
    env,
    {
      market,
      side: "sell",
      orderType: "market",
      amount: String(quantity)
    },
    `${positionSeed}|emergency-exit`
  );
}

function autoEntryTelegram(position) {
  return [
    "🤖 BITVAVO ACHAT AUTO EXÉCUTÉ",
    `${position.market} | Grade ${position.tradeGrade} | ${position.family}`,
    "",
    `Montant investi: ~€${fmt(position.entryQuoteEur, 2)}`,
    `Quantité: ${fmt(position.quantity, 8)}`,
    `Prix moyen d'entrée: €${fmt(position.avgEntryPrice)}`,
    `Stop automatique Bitvavo: €${fmt(position.stop)}`,
    `Cible automatique: €${fmt(position.target)}`,
    `Risque planifié: €${fmt(position.plannedRiskEur, 2)}`,
    "",
    "Le stop est placé directement chez Bitvavo. La cible est surveillée par le Worker. Aucun retrait n'est utilisé."
  ].join("\n");
}

function autoExitTelegram(trade) {
  const emoji = trade.realizedPnlEur >= 0 ? "✅" : "🛑";
  return [
    `${emoji} BITVAVO VENTE AUTO — ${trade.exitReason}`,
    trade.market,
    `P&L réalisé estimé: €${fmt(trade.realizedPnlEur, 2)}`,
    `Entrée: €${fmt(trade.avgEntryPrice)}`,
    `Sortie: €${fmt(trade.avgExitPrice)}`,
    `Quantité: ${fmt(trade.quantity, 8)}`
  ].join("\n");
}

async function simulateAutomatedEntry(env, state, signal, live, signalsDoc, { allowHistorical = false } = {}) {
  const key = `${signalsDoc.snapshotCollectedAt}|${signal.market}`;
  const signalMs = Date.parse(signalsDoc?.snapshotCollectedAt);
  const ageSec = Number.isFinite(signalMs) ? (Date.now() - signalMs) / 1000 : Infinity;

  const result = {
    key,
    simulatedAt: new Date().toISOString(),
    signalSnapshotAt: signalsDoc.snapshotCollectedAt,
    market: signal.market,
    family: signal.family,
    tradeGrade: signal.tradeGrade,
    score: signal.score,
    eligible: false,
    orderSubmitted: false,
    liveTradingEnabled: liveTradingEnabled(env),
    signalAgeSec: Number.isFinite(ageSec) ? Number(ageSec.toFixed(2)) : null,
    entry: null,
    protectiveStop: null,
    takeProfit: null,
    reason: null
  };

  if (!allowHistorical && !(ageSec >= 0 && ageSec <= AUTO_SIGNAL_MAX_AGE_SEC)) {
    result.reason = `signal too old for auto execution (${Number.isFinite(ageSec) ? ageSec.toFixed(1) : "n/a"}s)`;
    return result;
  }
  if (allowHistorical) result.historicalReplay = true;
  if (state.autoTradingHalted) {
    result.reason = state.autoTradingHaltReason || "auto trading halted";
    return result;
  }
  if ((state.autoPositions || []).length >= AUTO_MAX_POSITIONS) {
    result.reason = "auto position limit reached";
    return result;
  }

  const dailyPnl = autoDailyRealizedPnlEur(state);
  if (dailyPnl <= -AUTO_DAILY_LOSS_LIMIT_EUR) {
    result.reason = `daily realized loss limit reached (€${fmt(dailyPnl, 2)})`;
    return result;
  }

  const rules = await getMarketRules(signal.market, env);
  const limitPrice = floorTick(live.maxEntry, rules.tickSize);
  const notionalCap = Math.min(AUTO_MAX_NOTIONAL_EUR, live.amountEur);
  const quantity = floorDecimals(notionalCap / limitPrice, rules.quantityDecimals);
  const worstCaseQuote = quantity * limitPrice;
  const stopTrigger = ceilTick(live.stop, rules.tickSize);
  const target = floorTick(live.target, rules.tickSize);
  const minQuote = num(rules.minOrderInQuoteAsset) || 0;

  result.marketRules = {
    status: rules.status,
    tickSize: num(rules.tickSize),
    quantityDecimals: Number(rules.quantityDecimals),
    minOrderInQuoteAsset: minQuote
  };
  result.entry = {
    method: "POST /v2/order",
    side: "buy",
    orderType: "limit",
    timeInForce: "FOK",
    amount: quantity,
    limitPrice,
    worstCaseQuoteEur: worstCaseQuote,
    liveAsk: live.entry,
    maxEntry: live.maxEntry,
    liveNetRR: live.netRR
  };
  result.protectiveStop = {
    method: "POST /v2/order after confirmed entry fill",
    side: "sell",
    orderType: "stopLoss",
    amount: quantity,
    triggerAmount: stopTrigger,
    triggerType: "price",
    triggerReference: "lastTrade"
  };
  result.takeProfit = {
    mode: "worker-managed",
    triggerBidAtOrAbove: target,
    action: "cancel protective stop then market-sell available position",
    checkCadence: "1 minute"
  };
  result.risk = {
    plannedRiskEur: live.riskEur,
    maxNotionalEur: AUTO_MAX_NOTIONAL_EUR,
    maxPositions: AUTO_MAX_POSITIONS,
    dailyLossLimitEur: AUTO_DAILY_LOSS_LIMIT_EUR
  };

  if (!(limitPrice >= live.entry && limitPrice <= live.maxEntry + 1e-12)) {
    result.reason = "rounded limit price no longer valid";
    return result;
  }
  if (!(quantity > 0 && worstCaseQuote >= minQuote)) {
    result.reason = "order below market minimum";
    return result;
  }
  if (!(stopTrigger > 0 && stopTrigger < limitPrice && target > limitPrice)) {
    result.reason = "rounded stop/target geometry invalid";
    return result;
  }

  result.eligible = true;
  result.reason = "would submit FOK limit entry, then exchange-side stop; no order submitted in dry-run";
  return result;
}

function autoDryRunTelegram(dryRun) {
  if (!dryRun) return [];
  if (!dryRun.eligible) {
    return [
      "",
      "🧪 DRY-RUN AUTO: BLOQUÉ",
      `Raison: ${dryRun.reason}`,
      "Aucun ordre envoyé."
    ];
  }
  return [
    "",
    "🧪 DRY-RUN AUTO — ordre qui aurait été envoyé",
    `BUY LIMIT FOK: ${fmt(dryRun.entry.amount, 8)} ${dryRun.market.replace(/-EUR$/, "")} @ max €${fmt(dryRun.entry.limitPrice)}`,
    `Notional max: ~€${fmt(dryRun.entry.worstCaseQuoteEur, 2)}`,
    `STOP LOSS ensuite: trigger €${fmt(dryRun.protectiveStop.triggerAmount)}`,
    `TAKE PROFIT Worker: bid ≥ €${fmt(dryRun.takeProfit.triggerBidAtOrAbove)}`,
    "Aucun ordre envoyé — LIVE_TRADING_ENABLED=false."
  ];
}

async function runHistoricalDryRunReplay(env) {
  const fixture = {
    id: "SUI-EUR|2026-09-26T10:40:48.354Z",
    signal: {
      market: "SUI-EUR",
      action: "BUY",
      setupState: "BUY",
      family: "confirmed breakout",
      tradeGrade: "A",
      score: 10,
      stop: 1.0288933928571429,
      target: 1.06784,
      suggestedRiskEur: 1.25
    },
    live: {
      entry: 1.0367,
      stop: 1.0288933928571429,
      target: 1.06784,
      riskEur: 1.25,
      amountEur: 94.65027885152914,
      quantity: 91.29958411452604,
      netRR: 1.8446472278517407,
      maxEntry: 1.0385767991344785,
      entryHeadroomPct: 0.181035896062369
    },
    signalsDoc: {
      snapshotCollectedAt: "2026-09-26T10:40:48.354Z",
      btcRegime: "neutral"
    }
  };

  const state = {
    ...emptyLiveAlertState(),
    version: "1.7",
    autoPositions: [],
    autoTradeHistory: [],
    autoTradingHalted: false,
    autoTradingHaltReason: null
  };

  const result = await simulateAutomatedEntry(
    env,
    state,
    fixture.signal,
    fixture.live,
    fixture.signalsDoc,
    { allowHistorical: true }
  );

  return {
    ok: true,
    mode: "historical-dry-run-replay",
    fixture: fixture.id,
    source: "Recorded SUI strict BUY from 2026-09-26T10:40:48.354Z",
    orderSubmitted: false,
    liveTradingEnabled: liveTradingEnabled(env),
    result
  };
}

function upsertAutoAttempt(state, attempt) {
  state.autoAttemptHistory = Array.isArray(state.autoAttemptHistory) ? state.autoAttemptHistory : [];
  const idx = state.autoAttemptHistory.findIndex((a) => a?.key === attempt?.key);
  const previous = idx >= 0 ? state.autoAttemptHistory[idx] : null;
  const merged = {
    ...(previous || {}),
    ...attempt,
    firstSeenAt: previous?.firstSeenAt || attempt.firstSeenAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (idx >= 0) state.autoAttemptHistory[idx] = merged;
  else state.autoAttemptHistory.push(merged);
  state.autoAttemptHistory = state.autoAttemptHistory.slice(-1000);
  return merged;
}

function autoAttemptBase(signal, live, signalsDoc) {
  const signalMs = Date.parse(signalsDoc?.snapshotCollectedAt);
  const ageSec = Number.isFinite(signalMs) ? (Date.now() - signalMs) / 1000 : null;
  return {
    key: `${signalsDoc?.snapshotCollectedAt}|${signal?.market}`,
    market: signal?.market || null,
    signalSnapshotAt: signalsDoc?.snapshotCollectedAt || null,
    firstSeenAt: new Date().toISOString(),
    signalAgeSec: ageSec === null ? null : Number(ageSec.toFixed(2)),
    family: signal?.family || null,
    tradeGrade: signal?.tradeGrade || null,
    score: num(signal?.score),
    liveEntry: num(live?.entry),
    maxEntry: num(live?.maxEntry),
    liveNetRR: num(live?.netRR),
    plannedRiskEur: num(live?.riskEur),
    plannedAmountEur: num(live?.amountEur),
    orderSubmitted: false,
    orderId: null,
    exchangeStatus: null,
    outcome: null,
    reason: null
  };
}

async function executeAutomatedEntry(env, state, signal, live, signalsDoc) {
  const baseAttempt = autoAttemptBase(signal, live, signalsDoc);
  const key = baseAttempt.key;

  const block = (reason, extra = {}) => {
    upsertAutoAttempt(state, {
      ...baseAttempt,
      ...extra,
      outcome: "BLOCKED",
      reason,
      orderSubmitted: false
    });
    return { executed: false, reason };
  };

  if (!liveTradingEnabled(env)) return block("live trading disabled");

  const ageSec = num(baseAttempt.signalAgeSec);
  if (!(ageSec !== null && ageSec >= 0 && ageSec <= AUTO_SIGNAL_MAX_AGE_SEC)) {
    return block(`signal too old for auto execution (${ageSec === null ? "n/a" : ageSec.toFixed(1)}s)`);
  }

  if (state.autoTradingHalted) return block(state.autoTradingHaltReason || "auto trading halted");
  if ((state.autoPositions || []).length >= AUTO_MAX_POSITIONS) return block("auto position limit reached");

  const dailyPnl = autoDailyRealizedPnlEur(state);
  if (dailyPnl <= -AUTO_DAILY_LOSS_LIMIT_EUR) {
    state.autoTradingHalted = true;
    state.autoTradingHaltReason = `daily realized loss limit reached (€${fmt(dailyPnl, 2)})`;
    return block(state.autoTradingHaltReason, { dailyRealizedPnlEur: dailyPnl });
  }

  // A previously processed key already has its final telemetry row. Do not
  // overwrite NOT_FILLED/FILLED/ERROR with a later duplicate-check outcome.
  if (state.autoExecutionKeys.includes(key)) {
    return { executed: false, reason: "signal already auto-processed" };
  }

  let rules;
  try {
    rules = await getMarketRules(signal.market, env);
  } catch (error) {
    upsertAutoAttempt(state, {
      ...baseAttempt,
      outcome: "ERROR",
      reason: `market rules error: ${error.message}`,
      orderSubmitted: false
    });
    throw error;
  }

  const limitPrice = floorTick(live.maxEntry, rules.tickSize);
  const notionalCap = Math.min(AUTO_MAX_NOTIONAL_EUR, live.amountEur);
  const quantity = floorDecimals(notionalCap / limitPrice, rules.quantityDecimals);
  const worstCaseQuote = quantity * limitPrice;
  const planned = {
    limitPrice,
    quantity,
    notionalEur: worstCaseQuote,
    marketTickSize: num(rules.tickSize),
    marketQuantityDecimals: Number(rules.quantityDecimals),
    marketMinOrderQuote: num(rules.minOrderInQuoteAsset) || 0
  };

  if (!(limitPrice >= live.entry && limitPrice <= live.maxEntry + 1e-12)) {
    return block("rounded limit price no longer valid", planned);
  }
  if (!(quantity > 0 && worstCaseQuote >= (num(rules.minOrderInQuoteAsset) || 0))) {
    return block("order below market minimum", planned);
  }

  state.autoExecutionKeys.push(key);
  state.autoExecutionKeys = state.autoExecutionKeys.slice(-500);

  const submittedAt = new Date().toISOString();
  upsertAutoAttempt(state, {
    ...baseAttempt,
    ...planned,
    attemptedAt: submittedAt,
    orderSubmitted: true,
    outcome: "SUBMITTED",
    reason: "FOK limit entry submitted"
  });

  let entryOrder;
  try {
    entryOrder = await createLiveOrderIdempotent(
      env,
      {
        market: signal.market,
        side: "buy",
        orderType: "limit",
        amount: String(quantity),
        price: String(limitPrice),
        timeInForce: "FOK",
        postOnly: false
      },
      `${key}|entry`
    );
  } catch (error) {
    upsertAutoAttempt(state, {
      ...baseAttempt,
      ...planned,
      attemptedAt: submittedAt,
      orderSubmitted: true,
      outcome: "ERROR",
      reason: `entry API error: ${error.message}`
    });
    throw error;
  }

  const filledAmount = orderFilledAmount(entryOrder);
  const entryOrderId = entryOrder?.orderId || null;
  const exchangeStatus = entryOrder?.status || null;

  if (!(filledAmount > 0)) {
    const reason = `entry not filled (${exchangeStatus || "unknown"})`;
    upsertAutoAttempt(state, {
      ...baseAttempt,
      ...planned,
      attemptedAt: submittedAt,
      orderSubmitted: true,
      orderId: entryOrderId,
      exchangeStatus,
      filledAmount: 0,
      outcome: "NOT_FILLED",
      reason
    });
    return {
      executed: false,
      reason,
      orderId: entryOrderId
    };
  }

  const entryQuoteEur = orderFilledQuote(entryOrder) || filledAmount * live.entry;
  const avgEntryPrice = filledAmount > 0 ? entryQuoteEur / filledAmount : live.entry;
  let stopOrder;

  try {
    stopOrder = await placeProtectiveStop(env, key, signal.market, filledAmount, live.stop, rules);
  } catch (stopError) {
    let emergency = null;
    try {
      emergency = await emergencyMarketExit(env, key, signal.market, filledAmount, rules);
    } catch (exitError) {
      state.autoTradingHalted = true;
      state.autoTradingHaltReason = `CRITICAL: entry filled on ${signal.market} but stop and emergency exit both failed`;
      upsertAutoAttempt(state, {
        ...baseAttempt,
        ...planned,
        attemptedAt: submittedAt,
        orderSubmitted: true,
        orderId: entryOrderId,
        exchangeStatus,
        filledAmount,
        entryQuoteEur,
        avgEntryPrice,
        outcome: "ERROR",
        reason: state.autoTradingHaltReason,
        protectiveStopError: stopError.message,
        emergencyExitError: exitError.message
      });
      await sendTelegram(env, [
        "🚨 CRITIQUE — POSITION NON PROTÉGÉE",
        signal.market,
        state.autoTradingHaltReason,
        "Vérifier immédiatement le compte Bitvavo."
      ].join("\n"));
      throw exitError;
    }

    state.autoTradingHalted = true;
    state.autoTradingHaltReason = `protective stop failed after ${signal.market} entry; emergency exit submitted`;
    upsertAutoAttempt(state, {
      ...baseAttempt,
      ...planned,
      attemptedAt: submittedAt,
      orderSubmitted: true,
      orderId: entryOrderId,
      exchangeStatus,
      filledAmount,
      entryQuoteEur,
      avgEntryPrice,
      emergencyExitOrderId: emergency?.orderId || null,
      outcome: "ERROR",
      reason: state.autoTradingHaltReason,
      protectiveStopError: stopError.message
    });
    await sendTelegram(env, [
      "⚠️ ACHAT AUTO ANNULÉ PAR SÉCURITÉ",
      signal.market,
      "Le stop de protection n'a pas pu être placé. Une vente d'urgence a été envoyée.",
      `Ordre d'urgence: ${emergency?.orderId || "n/a"}`
    ].join("\n"));
    return { executed: false, reason: state.autoTradingHaltReason, emergencyExit: true };
  }

  const position = {
    key,
    market: signal.market,
    openedAt: new Date().toISOString(),
    signalSnapshotAt: signalsDoc.snapshotCollectedAt,
    family: signal.family,
    tradeGrade: signal.tradeGrade,
    score: signal.score,
    quantity: filledAmount,
    entryOrderId: entryOrder.orderId,
    stopOrderId: stopOrder.orderId,
    entryQuoteEur,
    entryFeeEur: orderFeeEur(entryOrder, avgEntryPrice),
    avgEntryPrice,
    entryLimitPrice: limitPrice,
    stop: num(stopOrder?.triggerAmount) || ceilTick(live.stop, rules.tickSize),
    target: floorTick(live.target, rules.tickSize),
    plannedRiskEur: live.riskEur,
    liveNetRRAtEntry: live.netRR,
    maxEntryAtSignal: live.maxEntry,
    status: "auto-active"
  };

  upsertAutoAttempt(state, {
    ...baseAttempt,
    ...planned,
    attemptedAt: submittedAt,
    orderSubmitted: true,
    orderId: entryOrderId,
    exchangeStatus,
    filledAmount,
    entryQuoteEur,
    avgEntryPrice,
    stopOrderId: stopOrder?.orderId || null,
    stopTrigger: position.stop,
    target: position.target,
    outcome: "FILLED",
    reason: "entry filled and protective stop placed"
  });

  state.autoPositions.push(position);
  await sendTelegram(env, autoEntryTelegram(position));

  return { executed: true, position };
}
async function finalizeAutoTrade(env, state, position, exitOrder, exitReason) {
  const exitAmount = orderFilledAmount(exitOrder) || position.quantity;
  const exitQuoteEur = orderFilledQuote(exitOrder);
  const avgExitPrice = exitAmount > 0 && exitQuoteEur > 0
    ? exitQuoteEur / exitAmount
    : null;
  const exitFeeEur = orderFeeEur(exitOrder, avgExitPrice);
  const realizedPnlEur = exitQuoteEur > 0
    ? exitQuoteEur - position.entryQuoteEur - position.entryFeeEur - exitFeeEur
    : null;

  const trade = {
    ...position,
    status: "closed",
    closedAt: new Date().toISOString(),
    exitReason,
    exitOrderId: exitOrder?.orderId || position.stopOrderId || null,
    exitQuoteEur,
    exitFeeEur,
    avgExitPrice,
    realizedPnlEur
  };

  state.autoTradeHistory.push(trade);
  state.autoTradeHistory = state.autoTradeHistory.slice(-500);
  state.autoPositions = state.autoPositions.filter((p) => p.key !== position.key);

  if (realizedPnlEur !== null && autoDailyRealizedPnlEur(state) <= -AUTO_DAILY_LOSS_LIMIT_EUR) {
    state.autoTradingHalted = true;
    state.autoTradingHaltReason = `daily realized loss limit reached (€${fmt(autoDailyRealizedPnlEur(state), 2)})`;
  }

  await sendTelegram(env, autoExitTelegram(trade));
  return trade;
}

async function manageAutomatedPositions(env, state) {
  const events = [];
  if (!(state.autoPositions || []).length) return events;
  if (!liveTradingCredentialsConfigured(env)) {
    state.autoTradingHalted = true;
    state.autoTradingHaltReason = "live trading credentials missing while auto position exists";
    return [{ type: "CRITICAL", reason: state.autoTradingHaltReason }];
  }

  for (const position of [...state.autoPositions]) {
    let stopOrder;
    try {
      stopOrder = await getLiveOrder(env, position.market, position.stopOrderId);
    } catch (error) {
      events.push({ market: position.market, type: "STOP_STATUS_ERROR", error: error.message });
      continue;
    }

    if (stopOrder?.status === "filled") {
      const trade = await finalizeAutoTrade(env, state, position, stopOrder, "STOP");
      events.push({ market: position.market, type: "STOP_FILLED", realizedPnlEur: trade.realizedPnlEur });
      continue;
    }

    const tickerRaw = await getJson(`${BITVAVO}/ticker/24h?market=${position.market}`, env);
    const ticker = compactTicker(Array.isArray(tickerRaw) ? tickerRaw[0] : tickerRaw);
    const executableBid = num(ticker?.bid);

    if (executableBid !== null && executableBid >= position.target) {
      try {
        await cancelLiveOrder(env, position.market, position.stopOrderId);
        const account = await collectPrivateAccountState(env);
        const symbol = String(position.market).replace(/-EUR$/, "");
        const balance = (account.balances || []).find((b) => b.symbol === symbol);
        const rules = await getMarketRules(position.market, env);
        const quantity = floorDecimals(
          Math.min(position.quantity, num(balance?.available) || 0),
          rules.quantityDecimals
        );

        if (!(quantity > 0)) throw new Error("No available base balance after stop cancellation");

        const exitOrder = await createLiveOrderIdempotent(
          env,
          {
            market: position.market,
            side: "sell",
            orderType: "market",
            amount: String(quantity)
          },
          `${position.key}|target-exit`
        );

        const trade = await finalizeAutoTrade(env, state, position, exitOrder, "TARGET");
        events.push({ market: position.market, type: "TARGET_EXIT", realizedPnlEur: trade.realizedPnlEur });
        continue;
      } catch (error) {
        // If the target exit fails after canceling the stop, restore a stop as
        // the first priority. If restoration also fails, halt and escalate.
        try {
          const rules = await getMarketRules(position.market, env);
          const account = await collectPrivateAccountState(env);
          const symbol = String(position.market).replace(/-EUR$/, "");
          const balance = (account.balances || []).find((b) => b.symbol === symbol);
          const available = num(balance?.available) || 0;
          if (available > 0) {
            const replacement = await placeProtectiveStop(
              env,
              `${position.key}|replacement-${Date.now()}`,
              position.market,
              available,
              position.stop,
              rules
            );
            position.stopOrderId = replacement.orderId;
          }
        } catch (restoreError) {
          state.autoTradingHalted = true;
          state.autoTradingHaltReason = `CRITICAL: target exit and stop restoration failed for ${position.market}`;
          await sendTelegram(env, [
            "🚨 CRITIQUE — VÉRIFICATION BITVAVO IMMÉDIATE",
            position.market,
            state.autoTradingHaltReason
          ].join("\n"));
        }
        events.push({ market: position.market, type: "TARGET_EXIT_ERROR", error: error.message });
      }
    } else if (["canceled", "expired"].includes(stopOrder?.status)) {
      try {
        const rules = await getMarketRules(position.market, env);
        const account = await collectPrivateAccountState(env);
        const symbol = String(position.market).replace(/-EUR$/, "");
        const balance = (account.balances || []).find((b) => b.symbol === symbol);
        const available = num(balance?.available) || 0;
        if (available > 0) {
          const replacement = await placeProtectiveStop(
            env,
            `${position.key}|replacement-${Date.now()}`,
            position.market,
            available,
            position.stop,
            rules
          );
          position.stopOrderId = replacement.orderId;
          events.push({ market: position.market, type: "STOP_REPLACED" });
        }
      } catch (error) {
        state.autoTradingHalted = true;
        state.autoTradingHaltReason = `CRITICAL: protective stop missing for ${position.market}`;
        await sendTelegram(env, [
          "🚨 CRITIQUE — STOP DE PROTECTION ABSENT",
          position.market,
          "Vérifier immédiatement Bitvavo."
        ].join("\n"));
        events.push({ market: position.market, type: "STOP_REPLACE_ERROR", error: error.message });
      }
    }
  }

  return events;
}

async function manageAutomatedPositionsOnly(env) {
  const target = parsePrivateRepo(env?.PRIVATE_GITHUB_REPO);
  if (!target || !env?.PRIVATE_GITHUB_TOKEN) return { ok: false, skipped: true, reason: "private repo unavailable" };

  const rawState = await readJsonFromRepo({
    owner: target.owner,
    repo: target.repo,
    path: LIVE_ALERT_STATE_FILE,
    branch: "main",
    token: env.PRIVATE_GITHUB_TOKEN
  });
  const state = { ...emptyLiveAlertState(), ...(rawState || {}) };
  state.version = "1.7";
  state.autoExecutionKeys = Array.isArray(state.autoExecutionKeys) ? state.autoExecutionKeys : [];
  state.autoAttemptHistory = Array.isArray(state.autoAttemptHistory) ? state.autoAttemptHistory.slice(-1000) : [];
  state.autoPositions = Array.isArray(state.autoPositions) ? state.autoPositions : [];
  state.autoTradeHistory = Array.isArray(state.autoTradeHistory) ? state.autoTradeHistory : [];

  if (!state.autoPositions.length) return { ok: true, skipped: true, reason: "no auto positions" };

  const events = await manageAutomatedPositions(env, state);
  state.updatedAt = new Date().toISOString();
  await publishJsonToRepo({
    owner: target.owner,
    repo: target.repo,
    path: LIVE_ALERT_STATE_FILE,
    branch: "main",
    data: state,
    token: env.PRIVATE_GITHUB_TOKEN,
    message: "Manage automated Bitvavo positions"
  });
  return { ok: true, events, autoPositions: state.autoPositions.map((p) => p.market) };
}

function maxEntryForNetRR(stop, target, roundTripCostPct, minNetRR = STRICT_MIN_NET_RR) {
  const s = num(stop);
  const t = num(target);
  const c = num(roundTripCostPct);
  const rr = num(minNetRR);
  if (!(s > 0 && t > s && c !== null && c >= 0 && rr > 0)) return null;

  // Solve exactly for E in:
  // (grossRewardPct(E) - costs) / (structuralRiskPct(E) + costs) >= minNetRR.
  const value = 100 * (t + rr * s) / ((1 + rr) * (100 + c));
  return Number.isFinite(value) && value > s && value < t ? value : null;
}

function calcLiveStructure(signal, ticker, account) {
  const entry = num(ticker?.ask);
  const stop = num(signal?.stop);
  const target = num(signal?.target);
  const spreadPct = num(ticker?.spreadPct);
  if (!(entry > 0 && stop > 0 && stop < entry && target > entry && spreadPct !== null)) return null;

  const maker = num(account?.fees?.makerPct) ?? DEFAULT_MAKER_FEE_PCT;
  const taker = num(account?.fees?.takerPct) ?? DEFAULT_TAKER_FEE_PCT;
  const entryFeePct = signal?.family === "trend pullback" ? maker : taker;
  const roundTripCostPct = entryFeePct + taker + spreadPct + SLIPPAGE_BUFFER_PCT;

  const structuralRiskPct = 100 * (entry - stop) / entry;
  const grossRewardPct = 100 * (target - entry) / entry;
  const netRiskPct = structuralRiskPct + roundTripCostPct;
  const netRewardPct = grossRewardPct - roundTripCostPct;
  const netRR = netRiskPct > 0 && netRewardPct > 0 ? netRewardPct / netRiskPct : null;
  const maxEntry = maxEntryForNetRR(stop, target, roundTripCostPct, STRICT_MIN_NET_RR);
  const entryHeadroomPct = maxEntry && entry > 0
    ? 100 * (maxEntry - entry) / entry
    : null;

  return {
    entry,
    stop,
    target,
    spreadPct,
    roundTripCostPct,
    structuralRiskPct,
    grossRewardPct,
    netRiskPct,
    netRewardPct,
    netRR,
    maxEntry,
    entryHeadroomPct
  };
}

function calcLiveTrade(signal, ticker, account, reservedRiskEur, reservedCapitalEur) {
  const structure = calcLiveStructure(signal, ticker, account);
  if (!structure || !(structure.netRR >= STRICT_MIN_NET_RR)) return null;

  const riskBudget = num(signal?.suggestedRiskEur);
  const remainingRisk = Math.max(0, MAX_COMBINED_LIVE_RISK_EUR - reservedRiskEur);
  const riskEur = Math.min(riskBudget || 0, remainingRisk);
  if (!(riskEur > 0)) return null;

  const eurBalance = (account?.balances || []).find((b) => b.symbol === "EUR");
  const availableEur = Math.max(0, (num(eurBalance?.available) || 0) - reservedCapitalEur);
  const amountEur = Math.min(availableEur, riskEur / (structure.netRiskPct / 100));
  if (!(amountEur > 0)) return null;

  return {
    ...structure,
    riskEur: amountEur * structure.netRiskPct / 100,
    amountEur,
    quantity: amountEur / structure.entry
  };
}

function isStrongPreAlertCandidate(signal) {
  if (signal?.action === "BUY" || signal?.setupState !== "TRIGGERED") return false;

  const score = num(signal?.score) ?? num(signal?.contextScore);
  if (signal?.tradeGrade !== "A" || !(score >= PRE_ALERT_MIN_SCORE)) return false;

  const blockers = Array.isArray(signal?.blockers) ? signal.blockers : [];
  return blockers.length === 1 && blockers[0] === "net structural R/R below threshold";
}

function closeValidityWindow(window, currentSnapshotAt) {
  const firstMs = Date.parse(window.firstValidSnapshotAt);
  const lastMs = Date.parse(window.lastValidSnapshotAt);
  const invalidMs = Date.parse(currentSnapshotAt);
  return {
    ...window,
    status: "closed",
    invalidatedAtSnapshot: currentSnapshotAt,
    confirmedValidForSec: Number.isFinite(firstMs) && Number.isFinite(lastMs)
      ? Math.max(0, Number(((lastMs - firstMs) / 1000).toFixed(2)))
      : null,
    invalidatedWithinSec: Number.isFinite(firstMs) && Number.isFinite(invalidMs)
      ? Math.max(0, Number(((invalidMs - firstMs) / 1000).toFixed(2)))
      : null
  };
}

function validityWindowLabel(window) {
  if (!window || window.status !== "closed") return null;
  const lower = num(window.confirmedValidForSec);
  const upper = num(window.invalidatedWithinSec);
  if (upper === null) return null;
  if (!lower || lower <= 0) {
    return `< ${fmt(upper / 60, 1)} min (1 seul snapshot BUY confirmé)`;
  }
  return `entre ${fmt(lower / 60, 1)} et ${fmt(upper / 60, 1)} min`;
}

function summarizeReactionMetrics(state) {
  const closed = (state.signalValidityWindows || [])
    .filter((w) => w?.status === "closed" && num(w.invalidatedWithinSec) !== null);
  const upperMinutes = closed.map((w) => num(w.invalidatedWithinSec) / 60).sort((a, b) => a - b);
  const meanUpperBoundMin = upperMinutes.length
    ? upperMinutes.reduce((a, b) => a + b, 0) / upperMinutes.length
    : null;
  const medianUpperBoundMin = upperMinutes.length
    ? (upperMinutes.length % 2
        ? upperMinutes[(upperMinutes.length - 1) / 2]
        : (upperMinutes[upperMinutes.length / 2 - 1] + upperMinutes[upperMinutes.length / 2]) / 2)
    : null;

  const converted = (state.preAlertHistory || [])
    .filter((p) => p?.resolution === "BUY" && num(p.leadTimeToBuySec) !== null);
  const leadMinutes = converted.map((p) => num(p.leadTimeToBuySec) / 60);
  const meanPreAlertLeadMin = leadMinutes.length
    ? leadMinutes.reduce((a, b) => a + b, 0) / leadMinutes.length
    : null;

  return {
    closedBuyWindows: closed.length,
    meanInvalidationUpperBoundMin: meanUpperBoundMin === null ? null : Number(meanUpperBoundMin.toFixed(2)),
    medianInvalidationUpperBoundMin: medianUpperBoundMin === null ? null : Number(medianUpperBoundMin.toFixed(2)),
    preAlertsSent: (state.preAlertHistory || []).length + (state.preAlerts || []).length,
    preAlertsConvertedToBuy: converted.length,
    meanPreAlertLeadMin: meanPreAlertLeadMin === null ? null : Number(meanPreAlertLeadMin.toFixed(2)),
    note: "BUY duration is interval-censored by the ~5-minute snapshot cadence; upper bounds are not exact expiry times."
  };
}

function fmt(value, digits = 6) {
  const x = Number(value);
  return Number.isFinite(x) ? x.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "") : "n/a";
}

function truncateText(value, max = 320) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, Math.max(0, max - 1)) + "…" : text;
}

function aiShadowSection(aiReviewDoc, signal, signalsDoc) {
  const lines = ["", "🔎 AUDIT CONTEXTUEL IA — SHADOW"];
  if (!aiReviewDoc || aiReviewDoc.snapshotCollectedAt !== signalsDoc.snapshotCollectedAt) {
    lines.push("Indisponible pour ce snapshot. Le signal déterministe reste inchangé.");
    return lines;
  }

  const review = (aiReviewDoc.reviews || []).find((r) => r.market === signal.market);
  if (!review) {
    lines.push("Aucun audit disponible pour ce marché. Le signal déterministe reste inchangé.");
    return lines;
  }

  if (review.status !== "ok") {
    const labels = {
      not_configured: "Clé OpenAI non configurée",
      budget_exhausted: "Budget IA mensuel atteint",
      error: "Audit IA en erreur"
    };
    lines.push(`${labels[review.status] || "Audit indisponible"}. Aucun veto automatique.`);
    return lines;
  }

  const verdictLabel = {
    NO_MATERIAL_RISK_FOUND: "Aucun risque contextuel majeur identifié",
    MATERIAL_RISK_FOUND: "Risque contextuel matériel détecté",
    INSUFFICIENT_INFORMATION: "Informations insuffisantes"
  }[review.verdict] || review.verdict || "Résultat non classé";

  lines.push(`${verdictLabel} — aucun veto automatique.`);
  if (review.summary) lines.push(truncateText(review.summary, 320));

  const risks = Array.isArray(review.materialRisks) ? review.materialRisks.slice(0, 2) : [];
  for (const risk of risks) lines.push(`⚠ ${truncateText(risk, 220)}`);

  const sources = Array.isArray(review.sources) ? review.sources.slice(0, 2) : [];
  if (sources.length) {
    lines.push("Sources:");
    for (const source of sources) {
      const label = truncateText(source.title || source.url || "source", 90);
      const url = source.url ? truncateText(source.url, 180) : "";
      lines.push(`• ${label}${url ? ` — ${url}` : ""}`);
    }
  }

  const eur = num(review?.cost?.estimatedCostEur);
  if (eur !== null) lines.push(`Coût audit estimé: €${fmt(eur, 3)}`);
  return lines;
}

function telegramMessage(signal, live, signalsDoc, aiReviewDoc = null, preAlertInfo = null, autoDryRun = null) {
  const preAlertLead = preAlertInfo?.leadTimeToBuySec !== null && preAlertInfo?.leadTimeToBuySec !== undefined
    ? `Pré-alerte envoyée ~${fmt(preAlertInfo.leadTimeToBuySec / 60, 1)} min avant ce BUY.`
    : null;

  return [
    "🚨 BITVAVO STRICT BUY",
    `${signal.market} | Grade ${signal.tradeGrade} | ${signal.family}`,
    `BTC regime: ${signalsDoc.btcRegime}`,
    "",
    `Entrée live: €${fmt(live.entry)}`,
    `Prix plafond indicatif (R/R net ≥ ${fmt(STRICT_MIN_NET_RR, 2)}): €${fmt(live.maxEntry)}`,
    `Marge jusqu'au plafond: ${fmt(live.entryHeadroomPct, 2)}%`,
    `Montant: €${fmt(live.amountEur, 2)}`,
    `Quantité: ${fmt(live.quantity, 8)}`,
    `Stop structurel: €${fmt(live.stop)}`,
    `Risque max estimé: €${fmt(live.riskEur, 2)}`,
    `Cible: €${fmt(live.target)}`,
    `R/R net live: ${fmt(live.netRR, 2)}`,
    `Coûts A/R estimés: ${fmt(live.roundTripCostPct, 2)}%`,
    ...(preAlertLead ? ["", `⏱ ${preAlertLead}`] : []),
    ...autoDryRunTelegram(autoDryRun),
    ...aiShadowSection(aiReviewDoc, signal, signalsDoc),
    "",
    "ACTION: vérifier le prix dans Bitvavo Pro. Si le prix d'achat est AU-DESSUS du plafond affiché, NE PAS ENTRER. Le plafond dépend du spread/coût live et reste indicatif jusqu'à l'exécution. L'audit IA est informatif et ne modifie pas les règles déterministes."
  ].join("\n");
}

function telegramPreAlertMessage(signal, live, signalsDoc) {
  const blockers = Array.isArray(signal?.blockers) ? signal.blockers.join("; ") : "setup non confirmé";
  return [
    "🟡 BITVAVO PRÉ-ALERTE — PAS UN BUY",
    `${signal.market} | ${signal.setupState} | ${signal.family}`,
    `Contexte: ${signal.contextGrade || signal.tradeGrade || "n/a"} | Score: ${fmt(signal.score, 1)}`,
    `BTC regime: ${signalsDoc.btcRegime}`,
    "",
    `Prix live: €${fmt(live.entry)}`,
    `R/R net live indicatif: ${fmt(live.netRR, 2)}`,
    `Prix plafond indicatif si BUY confirmé: €${fmt(live.maxEntry)}`,
    `Blocage actuel: ${blockers}`,
    "",
    "ACTION: se tenir prêt / ouvrir Bitvavo Pro si disponible, mais NE PAS ENTRER avant une alerte 🚨 STRICT BUY. Cette pré-alerte ne réserve ni capital ni risque."
  ].join("\n");
}

function telegramCancellationMessage(pending, latestSignal, validityWindow = null) {
  const state = latestSignal?.setupState || latestSignal?.action || "non actionable";
  const blockers = Array.isArray(latestSignal?.blockers) && latestSignal.blockers.length
    ? latestSignal.blockers.join("; ")
    : "le signal n'est plus présent parmi les BUY stricts du dernier snapshot";
  const validity = validityWindowLabel(validityWindow);

  return [
    "❌ BITVAVO SIGNAL ANNULÉ",
    `${pending.market} | ancienne recommandation BUY`,
    `État actuel: ${state}`,
    `Raison: ${blockers}`,
    ...(validity ? [`Fenêtre BUY observée: ${validity}`] : []),
    "",
    "ACTION: NE PAS ENTRER si l'ordre n'a pas encore été exécuté. La recommandation précédente n'est plus valide."
  ].join("\n");
}

async function sendTelegram(env, text, { replyMarkup = null } = {}) {
  if (!env?.TELEGRAM_BOT_TOKEN || !env?.TELEGRAM_CHAT_ID) {
    return { ok: false, skipped: true, reason: "Telegram not configured" };
  }
  const payload = {
    chat_id: env.TELEGRAM_CHAT_ID,
    text,
    disable_web_page_preview: true
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(`Telegram send failed: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return { ok: true, messageId: body?.result?.message_id ?? null };
}

async function makeRehearsalUrl(env, key, market, expiresAtMs) {
  if (!env?.ALERT_TRIGGER_KEY) return null;
  const payload = `${key}|${market}|${expiresAtMs}`;
  const sig = await hmacHex(env.ALERT_TRIGGER_KEY, payload);
  const params = new URLSearchParams({
    key,
    market,
    exp: String(expiresAtMs),
    sig
  });
  return `${PUBLIC_WORKER_BASE}/rehearse?${params.toString()}`;
}

async function verifyRehearsalRequest(env, key, market, expiresAtMs, suppliedSig) {
  if (!env?.ALERT_TRIGGER_KEY || !key || !market || !Number.isFinite(expiresAtMs) || !suppliedSig) {
    return false;
  }
  if (Date.now() > expiresAtMs) return false;
  const expected = await hmacHex(env.ALERT_TRIGGER_KEY, `${key}|${market}|${expiresAtMs}`);
  return expected === suppliedSig;
}

async function recordExecutionRehearsal(env, record) {
  const target = parsePrivateRepo(env?.PRIVATE_GITHUB_REPO);
  if (!target || !env?.PRIVATE_GITHUB_TOKEN) return null;

  const existing = await readJsonFromRepo({
    owner: target.owner,
    repo: target.repo,
    path: EXECUTION_REHEARSAL_FILE,
    branch: "main",
    token: env.PRIVATE_GITHUB_TOKEN
  });

  const doc = existing && typeof existing === "object"
    ? existing
    : { version: "1.0", records: [] };

  doc.version = "1.0";
  doc.updatedAt = new Date().toISOString();
  doc.records = Array.isArray(doc.records) ? doc.records.slice(-199) : [];
  doc.records.push(record);

  return publishJsonToRepo({
    owner: target.owner,
    repo: target.repo,
    path: EXECUTION_REHEARSAL_FILE,
    branch: "main",
    data: doc,
    token: env.PRIVATE_GITHUB_TOKEN,
    message: "Record execution rehearsal"
  });
}

function rehearsalHtml(result) {
  const valid = result?.valid === true;
  const title = valid ? "✅ ENCORE VALIDE" : "❌ TROP TARD / INVALIDE";
  const rows = [
    ["Marché", result?.market],
    ["Prix live", result?.liveEntry === null ? "n/a" : `€${fmt(result.liveEntry)}`],
    ["Prix plafond", result?.maxEntry === null ? "n/a" : `€${fmt(result.maxEntry)}`],
    ["R/R net live", result?.liveNetRR === null ? "n/a" : fmt(result.liveNetRR, 2)],
    ["Montant simulé", result?.amountEur === null ? "n/a" : `€${fmt(result.amountEur, 2)}`],
    ["Stop", result?.stop === null ? "n/a" : `€${fmt(result.stop)}`],
    ["Cible", result?.target === null ? "n/a" : `€${fmt(result.target)}`],
    ["Réaction depuis alerte", result?.notificationToClickSec === null ? "n/a" : `${fmt(result.notificationToClickSec, 1)} s`],
    ["Réaction depuis snapshot", result?.snapshotToClickSec === null ? "n/a" : `${fmt(result.snapshotToClickSec, 1)} s`]
  ];

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bitvavo rehearsal</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:680px;margin:32px auto;padding:0 18px;background:#111;color:#f5f5f5}
.card{border:1px solid #333;border-radius:16px;padding:22px;background:#181818}
h1{font-size:1.55rem;margin:0 0 10px}
p{line-height:1.45}
table{width:100%;border-collapse:collapse;margin:18px 0}
td{padding:10px 6px;border-bottom:1px solid #2b2b2b}
td:first-child{color:#aaa;width:48%}
.banner{padding:12px;border-radius:10px;background:#222;font-weight:700}
.note{font-size:.92rem;color:#bbb;margin-top:18px}
</style>
</head>
<body>
<div class="card">
<h1>${escapeHtml(title)}</h1>
<div class="banner">${escapeHtml(result?.reason || "")}</div>
<table>${rows.map(([k,v])=>`<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join("")}</table>
<p class="note"><strong>SIMULATION UNIQUEMENT.</strong> Aucun ordre n'a été transmis à Bitvavo. Ce test sert à mesurer ton temps de réaction et à vérifier si l'opportunité serait encore exécutable au moment du clic.</p>
</div>
</body>
</html>`;
}

async function handleExecutionRehearsal(env, url) {
  const key = url.searchParams.get("key") || "";
  const market = url.searchParams.get("market") || "";
  const expiresAtMs = Number(url.searchParams.get("exp"));
  const suppliedSig = url.searchParams.get("sig") || "";

  const authorized = await verifyRehearsalRequest(env, key, market, expiresAtMs, suppliedSig);
  if (!authorized) {
    return htmlResponse(rehearsalHtml({
      valid: false,
      market,
      reason: "Lien invalide ou expiré.",
      liveEntry: null,
      maxEntry: null,
      liveNetRR: null,
      amountEur: null,
      stop: null,
      target: null,
      notificationToClickSec: null,
      snapshotToClickSec: null
    }), 401);
  }

  const target = parsePrivateRepo(env?.PRIVATE_GITHUB_REPO);
  const rawState = target && env?.PRIVATE_GITHUB_TOKEN
    ? await readJsonFromRepo({
        owner: target.owner,
        repo: target.repo,
        path: LIVE_ALERT_STATE_FILE,
        branch: "main",
        token: env.PRIVATE_GITHUB_TOKEN
      })
    : null;

  const pending = (rawState?.pendingRecommendations || []).find((p) => p.key === key && p.market === market) || null;
  const nowMs = Date.now();
  const signalsDoc = await fetchLatestSignals(env);
  const currentSignal = (signalsDoc?.actionable || []).find((s) => s.market === market) || null;

  let valid = false;
  let reason = "La recommandation n'est plus active.";
  let live = null;

  if (pending && currentSignal) {
    const account = await collectPrivateAccountState(env);
    const t = await getJson(`${BITVAVO}/ticker/24h?market=${market}`, env);
    const ticker = compactTicker(Array.isArray(t) ? t[0] : t);
    const otherPendingCapital = (rawState?.pendingRecommendations || [])
      .filter((p) => p.key !== key)
      .reduce((s, p) => s + (num(p.amountEur) || 0), 0);
    const activeRisk = (rawState?.activePositions || [])
      .reduce((s, p) => s + (num(p.plannedRiskEur) || 0), 0);
    const otherPendingRisk = (rawState?.pendingRecommendations || [])
      .filter((p) => p.key !== key)
      .reduce((s, p) => s + (num(p.plannedRiskEur) || 0), 0);

    live = calcLiveTrade(
      currentSignal,
      ticker,
      account,
      activeRisk + otherPendingRisk,
      otherPendingCapital
    );

    if (live && live.entry <= live.maxEntry) {
      valid = true;
      reason = "Le BUY strict serait encore exécutable au moment de ce clic.";
    } else {
      reason = "Le prix/R-R live ne satisfait plus les règles strictes.";
    }
  }

  const snapshotMs = Date.parse(pending?.signalSnapshotAt);
  const notifiedMs = Date.parse(pending?.notifiedAt);
  const record = {
    clickedAt: new Date(nowMs).toISOString(),
    key,
    market,
    valid,
    reason,
    signalSnapshotAt: pending?.signalSnapshotAt ?? null,
    notifiedAt: pending?.notifiedAt ?? null,
    snapshotToClickSec: Number.isFinite(snapshotMs) ? Number(((nowMs - snapshotMs) / 1000).toFixed(2)) : null,
    notificationToClickSec: Number.isFinite(notifiedMs) ? Number(((nowMs - notifiedMs) / 1000).toFixed(2)) : null,
    liveEntry: live?.entry ?? null,
    maxEntry: live?.maxEntry ?? pending?.maxEntry ?? null,
    liveNetRR: live?.netRR ?? null,
    amountEur: live?.amountEur ?? null,
    stop: live?.stop ?? pending?.stop ?? null,
    target: live?.target ?? pending?.target ?? null,
    orderSubmitted: false
  };

  try {
    await recordExecutionRehearsal(env, record);
  } catch (error) {
    console.error("Execution rehearsal record failed:", error);
  }

  return htmlResponse(rehearsalHtml(record), valid ? 200 : 409);
}

async function checkAndNotifyStrictSignals(env) {
  const privateTarget = parsePrivateRepo(env?.PRIVATE_GITHUB_REPO);
  if (!privateTarget || !env?.PRIVATE_GITHUB_TOKEN) {
    return { ok: false, skipped: true, reason: "private GitHub target not configured" };
  }

  const signalsDoc = await fetchLatestSignals(env);
  const snapshotMs = Date.parse(signalsDoc?.snapshotCollectedAt);
  const nowMs = Date.now();
  const ageMin = Number.isFinite(snapshotMs) ? (nowMs - snapshotMs) / 60000 : Infinity;
  if (!signalsDoc?.snapshotFresh || ageMin < 0 || ageMin > ALERT_SIGNAL_MAX_AGE_MIN) {
    return { ok: true, notified: [], skipped: true, reason: "signal snapshot not live", ageMin };
  }

  const account = await collectPrivateAccountState(env);
  const rawState = await readJsonFromRepo({
    owner: privateTarget.owner,
    repo: privateTarget.repo,
    path: LIVE_ALERT_STATE_FILE,
    branch: "main",
    token: env.PRIVATE_GITHUB_TOKEN
  });
  const reconciled = reconcileLiveAlertState(rawState, account, nowMs);
  const state = reconciled.state;

  const autoManagementEvents = await manageAutomatedPositions(env, state);

  const activeMarkets = new Set([
    ...state.activePositions.map((p) => p.market),
    ...state.autoPositions.map((p) => p.market)
  ]);
  const pendingMarkets = new Set(state.pendingRecommendations.map((p) => p.market));
  const activeRisk = state.activePositions.reduce((s, p) => s + (num(p.plannedRiskEur) || 0), 0);
  let pendingRisk = state.pendingRecommendations.reduce((s, p) => s + (num(p.plannedRiskEur) || 0), 0);
  let pendingCapital = state.pendingRecommendations.reduce((s, p) => s + (num(p.amountEur) || 0), 0);

  const managedOpenMarkets = new Set([
    ...state.activePositions.map((p) => p.market),
    ...state.autoPositions.map((p) => p.market)
  ]);
  const unmanagedOrders = (account.openOrders || []).filter((o) =>
    !(o.side === "sell" && managedOpenMarkets.has(o.market))
  );

  const notified = [];
  const blocked = [];
  const candidates = Array.isArray(signalsDoc?.actionable)
    ? [...signalsDoc.actionable].sort((a, b) =>
        (b.tradeGrade === "A" ? 1 : 0) - (a.tradeGrade === "A" ? 1 : 0) ||
        (Number(b.score) || 0) - (Number(a.score) || 0)
      )
    : [];

  let aiReviewDoc = null;
  if (candidates.length) {
    try {
      aiReviewDoc = await fetchLatestAiReview(env);
    } catch (error) {
      console.error("AI shadow review fetch failed:", error);
    }
  }

  // A BUY alert is only valid while the latest deterministic snapshot still
  // classifies that market as actionable. If the user has not entered yet and
  // the setup disappears/downgrades, cancel the reservation and notify them.
  const actionableMarkets = new Set(candidates.map((s) => s.market));
  const latestSignalsByMarket = new Map(
    (Array.isArray(signalsDoc?.signals) ? signalsDoc.signals : [])
      .map((s) => [s.market, s])
  );

  // Measure how long each notified BUY remains actionable. With 5-minute
  // snapshots the exact expiry is interval-censored: we retain both the last
  // confirmed-valid snapshot and the first invalid snapshot.
  state.signalValidityWindows = state.signalValidityWindows.map((window) => {
    if (window?.status !== "open") return window;
    if (actionableMarkets.has(window.market)) {
      return { ...window, lastValidSnapshotAt: signalsDoc.snapshotCollectedAt };
    }
    return closeValidityWindow(window, signalsDoc.snapshotCollectedAt);
  }).slice(-200);

  // Resolve existing pre-alerts first. A conversion to BUY gives us measured
  // human lead time without changing the deterministic trading engine.
  const preAlertCandidates = (Array.isArray(signalsDoc?.signals) ? signalsDoc.signals : [])
    .filter(isStrongPreAlertCandidate);
  const preAlertCandidateByMarket = new Map(preAlertCandidates.map((s) => [s.market, s]));
  const preAlertLeadByMarket = new Map();
  const continuingPreAlerts = [];

  for (const pre of state.preAlerts) {
    if (actionableMarkets.has(pre.market)) {
      const leadTimeToBuySec = Number.isFinite(Date.parse(pre.notifiedAt)) && Number.isFinite(snapshotMs)
        ? Number(((snapshotMs - Date.parse(pre.notifiedAt)) / 1000).toFixed(2))
        : null;
      const resolved = {
        ...pre,
        resolvedAt: signalsDoc.snapshotCollectedAt,
        resolution: "BUY",
        leadTimeToBuySec
      };
      state.preAlertHistory.push(resolved);
      preAlertLeadByMarket.set(pre.market, resolved);
      continue;
    }

    const current = preAlertCandidateByMarket.get(pre.market);
    if (current) {
      continuingPreAlerts.push({
        ...pre,
        lastSeenSnapshotAt: signalsDoc.snapshotCollectedAt,
        setupState: current.setupState,
        score: current.score,
        blockers: current.blockers
      });
      continue;
    }

    state.preAlertHistory.push({
      ...pre,
      resolvedAt: signalsDoc.snapshotCollectedAt,
      resolution: "EXPIRED",
      leadTimeToBuySec: null
    });
  }
  state.preAlerts = continuingPreAlerts;
  state.preAlertHistory = state.preAlertHistory.slice(-200);

  const recentPreAlertAt = (market) => {
    const history = [...state.preAlertHistory].reverse().find((p) => p.market === market);
    const active = state.preAlerts.find((p) => p.market === market);
    const iso = active?.notifiedAt || history?.notifiedAt;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
  };

  // Informational heads-up only. Keep Telegram quiet: one active pre-alert
  // maximum, only for a Grade A TRIGGERED setup whose sole blocker is R/R and
  // whose live net R/R is already close to the strict 1.50 threshold.
  if (
    state.preAlerts.length === 0 &&
    !reconciled.unknownHeldSymbols.length &&
    !unmanagedOrders.length
  ) {
    const reservedSlots = state.activePositions.length + state.pendingRecommendations.length + reconciled.unknownHeldSymbols.length;

    if (reservedSlots < MAX_LIVE_POSITIONS) {
      const eligible = [];

      for (const signal of preAlertCandidates) {
        if (activeMarkets.has(signal.market) || pendingMarkets.has(signal.market)) continue;

        const lastPreAt = recentPreAlertAt(signal.market);
        if (lastPreAt !== null && nowMs - lastPreAt < PRE_ALERT_COOLDOWN_MIN * 60000) continue;

        try {
          const t = await getJson(`${BITVAVO}/ticker/24h?market=${signal.market}`, env);
          const ticker = compactTicker(Array.isArray(t) ? t[0] : t);
          const live = calcLiveStructure(signal, ticker, account);

          if (
            !live?.maxEntry ||
            !(live.netRR >= PRE_ALERT_MIN_LIVE_NET_RR) ||
            !(live.netRR < STRICT_MIN_NET_RR)
          ) {
            continue;
          }

          eligible.push({ signal, live });
        } catch (error) {
          console.error("Pre-alert candidate check failed:", signal.market, error);
        }
      }

      // Closest to a valid BUY first: highest live net R/R below 1.50.
      eligible.sort((a, b) =>
        (num(b.live?.netRR) || 0) - (num(a.live?.netRR) || 0) ||
        (num(b.signal?.score) || 0) - (num(a.signal?.score) || 0)
      );

      const best = eligible[0] || null;
      if (best) {
        try {
          const telegram = await sendTelegram(
            env,
            telegramPreAlertMessage(best.signal, best.live, signalsDoc)
          );

          if (telegram.ok) {
            state.preAlerts.push({
              key: `pre|${signalsDoc.snapshotCollectedAt}|${best.signal.market}`,
              market: best.signal.market,
              family: best.signal.family,
              setupState: best.signal.setupState,
              score: best.signal.score,
              firstSeenSnapshotAt: signalsDoc.snapshotCollectedAt,
              lastSeenSnapshotAt: signalsDoc.snapshotCollectedAt,
              notifiedAt: new Date().toISOString(),
              telegramMessageId: telegram.messageId,
              blockers: best.signal.blockers,
              liveEntryAtPreAlert: best.live.entry,
              liveNetRRAtPreAlert: best.live.netRR,
              maxEntryAtPreAlert: best.live.maxEntry
            });
            notified.push({
              market: best.signal.market,
              action: "PRE_ALERT",
              liveNetRR: best.live.netRR,
              maxEntry: best.live.maxEntry
            });
          }
        } catch (error) {
          console.error("Pre-alert failed:", best.signal.market, error);
          blocked.push({ market: best.signal.market, reason: "pre-alert failed" });
        }
      }
    }
  }

  const stillPending = [];
  for (const p of state.pendingRecommendations) {
    if (actionableMarkets.has(p.market)) {
      stillPending.push(p);
      continue;
    }

    const latestSignal = latestSignalsByMarket.get(p.market) || null;
    try {
      const validityWindow = [...state.signalValidityWindows]
        .reverse()
        .find((w) => w.market === p.market && (w.key === p.validityWindowId || !p.validityWindowId)) || null;
      const telegram = await sendTelegram(
        env,
        telegramCancellationMessage(p, latestSignal, validityWindow)
      );
      if (!telegram.ok) {
        blocked.push({
          market: p.market,
          reason: telegram.reason || "Telegram cancellation not sent"
        });
        stillPending.push(p);
        continue;
      }
    } catch (error) {
      console.error("Telegram cancellation failed:", error);
      blocked.push({ market: p.market, reason: "Telegram cancellation failed" });
      stillPending.push(p);
      continue;
    }

    pendingRisk = Math.max(0, pendingRisk - (num(p.plannedRiskEur) || 0));
    pendingCapital = Math.max(0, pendingCapital - (num(p.amountEur) || 0));
    pendingMarkets.delete(p.market);
    notified.push({
      market: p.market,
      key: p.key,
      action: "CANCEL",
      reason: latestSignal?.blockers || ["no longer actionable"]
    });
  }
  state.pendingRecommendations = stillPending;

  for (const signal of candidates) {
    const key = `${signalsDoc.snapshotCollectedAt}|${signal.market}`;
    if (state.notifiedKeys.includes(key)) continue;
    if (activeMarkets.has(signal.market) || pendingMarkets.has(signal.market)) continue;

    const reservedSlots = state.activePositions.length + state.pendingRecommendations.length + reconciled.unknownHeldSymbols.length;
    const reservedRisk = activeRisk + pendingRisk;
    if (reservedSlots >= MAX_LIVE_POSITIONS) {
      const reason = "max live positions/reservations reached";
      blocked.push({ market: signal.market, reason });
      if (liveTradingEnabled(env)) upsertAutoAttempt(state, {
        ...autoAttemptBase(signal, null, signalsDoc),
        outcome: "BLOCKED",
        reason,
        orderSubmitted: false
      });
      continue;
    }
    if (reconciled.unknownHeldSymbols.length) {
      const reason = "unmanaged non-EUR holdings present";
      blocked.push({ market: signal.market, reason });
      if (liveTradingEnabled(env)) upsertAutoAttempt(state, {
        ...autoAttemptBase(signal, null, signalsDoc),
        outcome: "BLOCKED",
        reason,
        orderSubmitted: false
      });
      continue;
    }
    if (unmanagedOrders.length) {
      const reason = "unmanaged open orders present";
      blocked.push({ market: signal.market, reason });
      if (liveTradingEnabled(env)) upsertAutoAttempt(state, {
        ...autoAttemptBase(signal, null, signalsDoc),
        outcome: "BLOCKED",
        reason,
        orderSubmitted: false
      });
      continue;
    }

    const t = await getJson(`${BITVAVO}/ticker/24h?market=${signal.market}`, env);
    const ticker = compactTicker(Array.isArray(t) ? t[0] : t);
    const live = calcLiveTrade(signal, ticker, account, reservedRisk, pendingCapital);
    if (!live) {
      const reason = "live price no longer satisfies strict R/R/risk gates";
      blocked.push({ market: signal.market, reason });
      if (liveTradingEnabled(env)) {
        const structure = calcLiveStructure(signal, ticker, account);
        upsertAutoAttempt(state, {
          ...autoAttemptBase(signal, structure, signalsDoc),
          outcome: "BLOCKED",
          reason,
          orderSubmitted: false
        });
      }
      continue;
    }

    let autoDryRun = null;

    if (!liveTradingEnabled(env) && liveTradingCredentialsConfigured(env)) {
      try {
        if (!state.autoDryRunKeys.includes(key)) {
          autoDryRun = await simulateAutomatedEntry(env, state, signal, live, signalsDoc);
          state.autoDryRunKeys.push(key);
          state.autoDryRunHistory.push(autoDryRun);
          state.autoDryRunKeys = state.autoDryRunKeys.slice(-500);
          state.autoDryRunHistory = state.autoDryRunHistory.slice(-500);
        } else {
          autoDryRun = [...state.autoDryRunHistory].reverse().find((d) => d.key === key) || null;
        }
      } catch (error) {
        autoDryRun = {
          key,
          simulatedAt: new Date().toISOString(),
          signalSnapshotAt: signalsDoc.snapshotCollectedAt,
          market: signal.market,
          eligible: false,
          orderSubmitted: false,
          reason: `dry-run error: ${error.message}`
        };
        state.autoDryRunKeys.push(key);
        state.autoDryRunHistory.push(autoDryRun);
        state.autoDryRunKeys = state.autoDryRunKeys.slice(-500);
        state.autoDryRunHistory = state.autoDryRunHistory.slice(-500);
      }
    }

    if (liveTradingEnabled(env)) {
      try {
        const autoResult = await executeAutomatedEntry(env, state, signal, live, signalsDoc);
        if (autoResult.executed) {
          state.notifiedKeys.push(key);
          notified.push({
            market: signal.market,
            key,
            action: "AUTO_BUY",
            liveNetRR: live.netRR,
            entryOrderId: autoResult.position.entryOrderId,
            stopOrderId: autoResult.position.stopOrderId
          });
          continue;
        }
        blocked.push({ market: signal.market, reason: autoResult.reason || "auto execution skipped" });
        if (autoResult.reason !== "signal already auto-processed") continue;
      } catch (error) {
        const existingAttempt = [...(state.autoAttemptHistory || [])].reverse().find((a) => a?.key === key);
        if (!existingAttempt || existingAttempt.outcome !== "ERROR") {
          upsertAutoAttempt(state, {
            ...autoAttemptBase(signal, live, signalsDoc),
            outcome: "ERROR",
            reason: `auto entry error: ${error.message}`,
            orderSubmitted: Boolean(existingAttempt?.orderSubmitted),
            orderId: existingAttempt?.orderId || null
          });
        }
        state.autoTradingHalted = true;
        state.autoTradingHaltReason = `auto entry error: ${error.message}`;
        blocked.push({ market: signal.market, reason: state.autoTradingHaltReason });
        await sendTelegram(env, [
          "⚠️ TRADING AUTO MIS EN PAUSE",
          signal.market,
          error.message,
          "Aucun nouvel achat automatique ne sera tenté tant que l'état n'est pas vérifié."
        ].join("\n"));
        continue;
      }
    }

    const preAlertInfo = preAlertLeadByMarket.get(signal.market) || null;
    const rehearsalExpiresAtMs = nowMs + ALERT_RESERVATION_MIN * 60000;
    const rehearsalUrl = await makeRehearsalUrl(env, key, signal.market, rehearsalExpiresAtMs);
    const telegram = await sendTelegram(
      env,
      telegramMessage(signal, live, signalsDoc, aiReviewDoc, preAlertInfo, autoDryRun),
      {
        replyMarkup: rehearsalUrl
          ? {
              inline_keyboard: [[
                { text: "⚡ Vérifier / simuler l'exécution", url: rehearsalUrl }
              ]]
            }
          : null
      }
    );
    if (!telegram.ok) {
      blocked.push({ market: signal.market, reason: telegram.reason || "Telegram not configured" });
      continue;
    }

    const sentAtMs = Date.now();
    const aiReview = aiReviewDoc?.snapshotCollectedAt === signalsDoc.snapshotCollectedAt
      ? (aiReviewDoc.reviews || []).find((r) => r.market === signal.market) || null
      : null;
    const snapshotToNotificationSec = Number.isFinite(snapshotMs)
      ? Number(((sentAtMs - snapshotMs) / 1000).toFixed(2))
      : null;

    let validityWindow = [...state.signalValidityWindows]
      .reverse()
      .find((w) => w.market === signal.market && w.status === "open") || null;
    if (!validityWindow) {
      validityWindow = {
        key: `validity|${key}`,
        market: signal.market,
        family: signal.family,
        firstValidSnapshotAt: signalsDoc.snapshotCollectedAt,
        lastValidSnapshotAt: signalsDoc.snapshotCollectedAt,
        notifiedAt: new Date(sentAtMs).toISOString(),
        status: "open",
        liveEntryAtAlert: live.entry,
        maxEntryAtAlert: live.maxEntry,
        liveNetRRAtAlert: live.netRR,
        preAlertLeadTimeSec: preAlertInfo?.leadTimeToBuySec ?? null
      };
      state.signalValidityWindows.push(validityWindow);
      state.signalValidityWindows = state.signalValidityWindows.slice(-200);
    }

    const reservation = {
      key,
      market: signal.market,
      signalSnapshotAt: signalsDoc.snapshotCollectedAt,
      notifiedAt: new Date(sentAtMs).toISOString(),
      snapshotToNotificationSec,
      expiresAtMs: rehearsalExpiresAtMs,
      family: signal.family,
      tradeGrade: signal.tradeGrade,
      score: signal.score,
      entry: live.entry,
      stop: live.stop,
      target: live.target,
      amountEur: live.amountEur,
      quantity: live.quantity,
      plannedRiskEur: live.riskEur,
      liveNetRR: live.netRR,
      maxEntry: live.maxEntry,
      entryHeadroomPct: live.entryHeadroomPct,
      validityWindowId: validityWindow.key,
      preAlertLeadTimeSec: preAlertInfo?.leadTimeToBuySec ?? null,
      telegramMessageId: telegram.messageId,
      aiShadowStatus: aiReview?.status ?? "unavailable",
      aiShadowVerdict: aiReview?.verdict ?? null,
      aiShadowCostEur: num(aiReview?.cost?.estimatedCostEur),
      aiShadowReviewedAt: aiReview?.reviewedAt ?? null,
      status: "pending"
    };
    state.pendingRecommendations.push(reservation);
    state.notificationHistory.push({
      key,
      market: signal.market,
      signalSnapshotAt: signalsDoc.snapshotCollectedAt,
      notifiedAt: reservation.notifiedAt,
      snapshotToNotificationSec,
      liveNetRR: live.netRR,
      maxEntry: live.maxEntry,
      preAlertLeadTimeSec: reservation.preAlertLeadTimeSec,
      validityWindowId: reservation.validityWindowId,
      aiShadowStatus: reservation.aiShadowStatus,
      aiShadowVerdict: reservation.aiShadowVerdict,
      aiShadowCostEur: reservation.aiShadowCostEur
    });
    state.notificationHistory = state.notificationHistory.slice(-200);
    pendingMarkets.add(signal.market);
    pendingRisk += reservation.plannedRiskEur;
    pendingCapital += reservation.amountEur;
    state.notifiedKeys.push(key);
    notified.push({
      market: signal.market,
      key,
      liveNetRR: live.netRR,
      snapshotToNotificationSec,
      aiShadowStatus: reservation.aiShadowStatus,
      aiShadowVerdict: reservation.aiShadowVerdict
    });
  }

  state.notifiedKeys = state.notifiedKeys.slice(-200);
  state.preAlerts = state.preAlerts.slice(-50);
  state.preAlertHistory = state.preAlertHistory.slice(-200);
  state.signalValidityWindows = state.signalValidityWindows.slice(-200);
  state.autoExecutionKeys = state.autoExecutionKeys.slice(-500);
  state.autoDryRunKeys = state.autoDryRunKeys.slice(-500);
  state.autoDryRunHistory = state.autoDryRunHistory.slice(-500);
  state.autoAttemptHistory = state.autoAttemptHistory.slice(-1000);
  state.autoTradeHistory = state.autoTradeHistory.slice(-500);
  state.reactionMetrics = summarizeReactionMetrics(state);
  state.updatedAt = new Date().toISOString();
  await publishJsonToRepo({
    owner: privateTarget.owner,
    repo: privateTarget.repo,
    path: LIVE_ALERT_STATE_FILE,
    branch: "main",
    data: state,
    token: env.PRIVATE_GITHUB_TOKEN,
    message: "Update live Bitvavo alert state"
  });

  return {
    ok: true,
    signalSnapshotAt: signalsDoc.snapshotCollectedAt,
    ageMin: Number(ageMin.toFixed(2)),
    notified,
    blocked,
    activePositions: state.activePositions.map((p) => p.market),
    pendingRecommendations: state.pendingRecommendations.map((p) => p.market),
    preAlerts: state.preAlerts.map((p) => p.market),
    autoPositions: state.autoPositions.map((p) => p.market),
    latestAutoDryRun: state.autoDryRunHistory.length ? state.autoDryRunHistory[state.autoDryRunHistory.length - 1] : null,
    latestAutoAttempt: state.autoAttemptHistory.length ? state.autoAttemptHistory[state.autoAttemptHistory.length - 1] : null,
    autoManagementEvents,
    liveTradingEnabled: liveTradingEnabled(env),
    autoTradingHalted: state.autoTradingHalted,
    autoTradingHaltReason: state.autoTradingHaltReason,
    reactionMetrics: state.reactionMetrics
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

async function triggerGitHubSnapshotCollection(env, source = "worker") {
  if (!env?.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN absent du Worker");
  }

  const requestedAt = new Date().toISOString();
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`,
    {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "bitvavo-collector/2.24",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        event_type: "collect_snapshot",
        client_payload: {
          source,
          requestedAt
        }
      })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub dispatch ${response.status}: ${text.slice(0, 500)}`);
  }

  return {
    ok: true,
    message: "Snapshot collection dispatched to GitHub Actions",
    mode: "github-actions",
    requestedAt,
    source
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
          version: "2.24",
          snapshotMode: "github-actions-dispatch",
          alertLayer: {
            preAlerts: true,
            preAlertMode: "triggered-grade-a-near-buy-only",
            preAlertMinScore: PRE_ALERT_MIN_SCORE,
            preAlertMinLiveNetRR: PRE_ALERT_MIN_LIVE_NET_RR,
            preAlertMaxActive: 1,
            preAlertCooldownMin: PRE_ALERT_COOLDOWN_MIN,
            maxEntryCeiling: true,
            buyValidityMeasurement: true,
            executionRehearsal: true,
            automaticExecutionDryRun: !liveTradingEnabled(env) && liveTradingCredentialsConfigured(env),
            autoAttemptHistory: true,
            liveOrderSubmission: liveTradingEnabled(env),
            liveTradingConfigured: liveTradingCredentialsConfigured(env),
            liveTradingMaxPositions: AUTO_MAX_POSITIONS,
            liveTradingMaxNotionalEur: AUTO_MAX_NOTIONAL_EUR,
            liveTradingDailyLossLimitEur: AUTO_DAILY_LOSS_LIMIT_EUR,
            liveTradingMaxSignalAgeSec: AUTO_SIGNAL_MAX_AGE_SEC,
            exchangeProtectiveStop: true,
            workerManagedTakeProfit: true,
            strictEngineModified: false
          },
          routes: {
            market: "/market/BTC-EUR",
            publish: "/publish",
            privateSync: "/sync-private (POST, X-Private-Sync-Key required)",
            alertCheck: "/alert-check (POST, X-Alert-Key required)",
            telegramTest: "/telegram-test (POST, X-Alert-Key required)",
            rehearsal: "/rehearse (signed one-time-style link from Telegram BUY alert)",
            autoManage: "/auto-manage (POST, X-Alert-Key required)",
            liveCredentialCheck: "/live-credential-check (POST, X-Alert-Key required; GET-only Bitvavo self-test)",
            dryRunReplay: "/dry-run-replay (POST, X-Alert-Key required; historical SUI fixture; no order API calls)"
          },
          scheduledHandler: true,
          recommendedCrons: {
            snapshot: "*/5 * * * *",
            alertFallback: "2-57/5 * * * *",
            autoManage: "* * * * *",
            privateSync: "3,18,33,48 * * * *"
          },
          privateAccountSyncConfigured: Boolean(env?.PRIVATE_GITHUB_REPO && env?.PRIVATE_GITHUB_TOKEN),
          privateManualSyncConfigured: Boolean(env?.PRIVATE_SYNC_KEY),
          telegramAlertsConfigured: Boolean(env?.TELEGRAM_BOT_TOKEN && env?.TELEGRAM_CHAT_ID),
          manualAlertCheckConfigured: Boolean(env?.ALERT_TRIGGER_KEY),
          githubSnapshotDispatchConfigured: Boolean(env?.GITHUB_TOKEN),
          liveTradingCredentialsConfigured: liveTradingCredentialsConfigured(env),
          liveTradingEnabled: liveTradingEnabled(env)
        });
      }

      if (url.pathname === "/rehearse") {
        if (request.method !== "GET") {
          return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
        }
        return handleExecutionRehearsal(env, url);
      }

      if (url.pathname === "/dry-run-replay") {
        if (request.method !== "POST") {
          return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
        }
        if (!env?.ALERT_TRIGGER_KEY) {
          return jsonResponse({ ok: false, error: "ALERT_TRIGGER_KEY not configured" }, 503);
        }
        const supplied = request.headers.get("X-Alert-Key");
        if (!supplied || supplied !== env.ALERT_TRIGGER_KEY) {
          return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
        }
        return jsonResponse(await runHistoricalDryRunReplay(env));
      }

      if (url.pathname === "/live-credential-check") {
        if (request.method !== "POST") {
          return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
        }
        if (!env?.ALERT_TRIGGER_KEY) {
          return jsonResponse({ ok: false, error: "ALERT_TRIGGER_KEY not configured" }, 503);
        }
        const supplied = request.headers.get("X-Alert-Key");
        if (!supplied || supplied !== env.ALERT_TRIGGER_KEY) {
          return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
        }
        return jsonResponse(await runLiveCredentialCheck(env));
      }

      if (url.pathname === "/auto-manage") {
        if (request.method !== "POST") {
          return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
        }
        if (!env?.ALERT_TRIGGER_KEY) {
          return jsonResponse({ ok: false, error: "ALERT_TRIGGER_KEY not configured" }, 503);
        }
        const supplied = request.headers.get("X-Alert-Key");
        if (!supplied || supplied !== env.ALERT_TRIGGER_KEY) {
          return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
        }
        return jsonResponse(await manageAutomatedPositionsOnly(env));
      }

      if (url.pathname === "/alert-check") {
        if (request.method !== "POST") {
          return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
        }
        if (!env?.ALERT_TRIGGER_KEY) {
          return jsonResponse({ ok: false, error: "ALERT_TRIGGER_KEY not configured" }, 503);
        }
        const supplied = request.headers.get("X-Alert-Key");
        if (!supplied || supplied !== env.ALERT_TRIGGER_KEY) {
          return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
        }
        return jsonResponse(await checkAndNotifyStrictSignals(env));
      }

      if (url.pathname === "/telegram-test") {
        if (request.method !== "POST") {
          return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
        }
        if (!env?.ALERT_TRIGGER_KEY) {
          return jsonResponse({ ok: false, error: "ALERT_TRIGGER_KEY not configured" }, 503);
        }
        const supplied = request.headers.get("X-Alert-Key");
        if (!supplied || supplied !== env.ALERT_TRIGGER_KEY) {
          return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
        }
        return jsonResponse(await sendTelegram(env, "✅ Test alerte Bitvavo temps réel — Worker 2.24 opérationnel."));
      }

      if (url.pathname === "/sync-private") {
        if (request.method !== "POST") {
          return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
        }
        if (!env?.PRIVATE_SYNC_KEY) {
          return jsonResponse({ ok: false, error: "PRIVATE_SYNC_KEY not configured" }, 503);
        }
        const supplied = request.headers.get("X-Private-Sync-Key");
        if (!supplied || supplied !== env.PRIVATE_SYNC_KEY) {
          return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
        }
        return jsonResponse(await publishPrivateAccountState(env));
      }

      if (url.pathname === "/publish") {
        return jsonResponse(await triggerGitHubSnapshotCollection(env, "manual-publish"));
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
    // Worker Free has a tight per-invocation CPU budget.
    // Split snapshot collection, alert fallback and private sync across
    // distinct Cron Triggers so each task gets its own invocation budget.
    //
    // Snapshot:       */5 * * * *
    // Alert fallback: 2-57/5 * * * *
    // Private sync:   3,18,33,48 * * * *
    const cron = event.cron;

    if (cron === "*/5 * * * *") {
      ctx.waitUntil(
        triggerGitHubSnapshotCollection(env, "cron-5m").catch((error) => {
          console.error("Scheduled GitHub snapshot dispatch failed:", error);
        })
      );
      return;
    }

    if (cron === "2-57/5 * * * *") {
      if (env?.TELEGRAM_BOT_TOKEN && env?.TELEGRAM_CHAT_ID) {
        ctx.waitUntil(
          checkAndNotifyStrictSignals(env).catch((error) => {
            console.error("Scheduled strict Telegram alert check failed:", error);
          })
        );
      }
      return;
    }

    if (cron === "* * * * *") {
      if (liveTradingCredentialsConfigured(env)) {
        ctx.waitUntil(
          manageAutomatedPositionsOnly(env).catch((error) => {
            console.error("Scheduled automated-position manager failed:", error);
          })
        );
      }
      return;
    }

    if (cron === "3,18,33,48 * * * *") {
      if (env?.PRIVATE_GITHUB_REPO && env?.PRIVATE_GITHUB_TOKEN) {
        ctx.waitUntil(
          publishPrivateAccountState(env).catch((error) => {
            console.error("Scheduled private account sync failed:", error);
          })
        );
      }
      return;
    }

    console.warn("Unknown scheduled cron:", cron);
  }
};