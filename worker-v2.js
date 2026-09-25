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
const ALERT_SIGNAL_MAX_AGE_MIN = 8;
const ALERT_RESERVATION_MIN = 20;
const MAX_LIVE_POSITIONS = 2;
const MAX_COMBINED_LIVE_RISK_EUR = 3;
const STRICT_MIN_NET_RR = 1.5;
const PRE_ALERT_MIN_SCORE = 8;
const PRE_ALERT_COOLDOWN_MIN = 30;
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

async function getJson(url, env, { auth = true } = {}) {
  const parsed = new URL(url);
  const path = parsed.pathname + parsed.search;
  const timestamp = Date.now().toString();
  const headers = {
    "Accept": "application/json",
    "User-Agent": "bitvavo-collector/2.16"
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
      headers: { "Accept": "application/json", "User-Agent": "bitvavo-collector/2.16" },
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
    "User-Agent": "bitvavo-collector/2.16"
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
      "User-Agent": "bitvavo-collector/2.16"
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
    "User-Agent": "bitvavo-collector/2.16"
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

async function fetchLatestSignals() {
  const response = await fetch(SIGNALS_URL, {
    headers: { "Accept": "application/json", "User-Agent": "bitvavo-collector/2.16" },
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`signals.json fetch ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.json();
}

async function fetchLatestAiReview() {
  const response = await fetch(AI_REVIEW_URL, {
    headers: { "Accept": "application/json", "User-Agent": "bitvavo-collector/2.16" },
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI review fetch ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.json();
}

function emptyLiveAlertState() {
  return {
    version: "1.2",
    updatedAt: null,
    notifiedKeys: [],
    pendingRecommendations: [],
    activePositions: [],
    notificationHistory: [],
    preAlerts: [],
    preAlertHistory: [],
    signalValidityWindows: [],
    reactionMetrics: null
  };
}

function heldSymbols(account) {
  return new Set((account?.balances || [])
    .filter((b) => b.symbol !== "EUR" && ((b.available || 0) > 0 || (b.inOrder || 0) > 0))
    .map((b) => b.symbol));
}

function reconcileLiveAlertState(rawState, account, nowMs) {
  const state = { ...emptyLiveAlertState(), ...(rawState || {}) };
  state.notifiedKeys = Array.isArray(state.notifiedKeys) ? state.notifiedKeys.slice(-200) : [];
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

  const knownSymbols = new Set(state.activePositions.map((p) => String(p.market).replace(/-EUR$/, "")));
  const unknownHeldSymbols = [...held].filter((s) => !knownSymbols.has(s));
  return { state, unknownHeldSymbols };
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
  const setupState = signal?.setupState;
  if (signal?.action === "BUY" || !["ARMED", "TRIGGERED"].includes(setupState)) return false;

  const score = num(signal?.score) ?? num(signal?.contextScore);
  const strongGrade = signal?.tradeGrade === "A" || signal?.contextGrade === "A";
  if (!strongGrade || !(score >= PRE_ALERT_MIN_SCORE)) return false;

  const blockers = Array.isArray(signal?.blockers) ? signal.blockers : [];
  if (!blockers.length) return false;

  const rrBlocker = "net structural R/R below threshold";
  const triggerBlocker = "entry trigger absent";
  const allowed = new Set([rrBlocker, triggerBlocker]);
  if (blockers.some((b) => !allowed.has(b))) return false;

  if (setupState === "TRIGGERED") {
    return blockers.length === 1 && blockers[0] === rrBlocker;
  }

  return blockers.includes(triggerBlocker);
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

function telegramMessage(signal, live, signalsDoc, aiReviewDoc = null, preAlertInfo = null) {
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

async function sendTelegram(env, text) {
  if (!env?.TELEGRAM_BOT_TOKEN || !env?.TELEGRAM_CHAT_ID) {
    return { ok: false, skipped: true, reason: "Telegram not configured" };
  }
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        disable_web_page_preview: true
      })
    }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(`Telegram send failed: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return { ok: true, messageId: body?.result?.message_id ?? null };
}

async function checkAndNotifyStrictSignals(env) {
  const privateTarget = parsePrivateRepo(env?.PRIVATE_GITHUB_REPO);
  if (!privateTarget || !env?.PRIVATE_GITHUB_TOKEN) {
    return { ok: false, skipped: true, reason: "private GitHub target not configured" };
  }

  const signalsDoc = await fetchLatestSignals();
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

  const activeMarkets = new Set(state.activePositions.map((p) => p.market));
  const pendingMarkets = new Set(state.pendingRecommendations.map((p) => p.market));
  const activeRisk = state.activePositions.reduce((s, p) => s + (num(p.plannedRiskEur) || 0), 0);
  let pendingRisk = state.pendingRecommendations.reduce((s, p) => s + (num(p.plannedRiskEur) || 0), 0);
  let pendingCapital = state.pendingRecommendations.reduce((s, p) => s + (num(p.amountEur) || 0), 0);

  const managedOpenMarkets = new Set(state.activePositions.map((p) => p.market));
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
      aiReviewDoc = await fetchLatestAiReview();
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

  // Informational heads-up only: strong ARMED/TRIGGERED setups with no blocker
  // other than trigger/RR. No capital/risk reservation and no engine override.
  for (const signal of preAlertCandidates) {
    if (activeMarkets.has(signal.market) || pendingMarkets.has(signal.market)) continue;
    if (state.preAlerts.some((p) => p.market === signal.market)) continue;
    if (reconciled.unknownHeldSymbols.length || unmanagedOrders.length) continue;

    const reservedSlots = state.activePositions.length + state.pendingRecommendations.length + reconciled.unknownHeldSymbols.length;
    if (reservedSlots >= MAX_LIVE_POSITIONS) continue;

    const lastPreAt = recentPreAlertAt(signal.market);
    if (lastPreAt !== null && nowMs - lastPreAt < PRE_ALERT_COOLDOWN_MIN * 60000) continue;

    try {
      const t = await getJson(`${BITVAVO}/ticker/24h?market=${signal.market}`, env);
      const ticker = compactTicker(Array.isArray(t) ? t[0] : t);
      const live = calcLiveStructure(signal, ticker, account);
      if (!live?.maxEntry) continue;

      const telegram = await sendTelegram(env, telegramPreAlertMessage(signal, live, signalsDoc));
      if (!telegram.ok) continue;

      state.preAlerts.push({
        key: `pre|${signalsDoc.snapshotCollectedAt}|${signal.market}`,
        market: signal.market,
        family: signal.family,
        setupState: signal.setupState,
        score: signal.score,
        firstSeenSnapshotAt: signalsDoc.snapshotCollectedAt,
        lastSeenSnapshotAt: signalsDoc.snapshotCollectedAt,
        notifiedAt: new Date().toISOString(),
        telegramMessageId: telegram.messageId,
        blockers: signal.blockers,
        liveEntryAtPreAlert: live.entry,
        liveNetRRAtPreAlert: live.netRR,
        maxEntryAtPreAlert: live.maxEntry
      });
      notified.push({
        market: signal.market,
        action: "PRE_ALERT",
        liveNetRR: live.netRR,
        maxEntry: live.maxEntry
      });
    } catch (error) {
      console.error("Pre-alert failed:", signal.market, error);
      blocked.push({ market: signal.market, reason: "pre-alert failed" });
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
      blocked.push({ market: signal.market, reason: "max live positions/reservations reached" });
      continue;
    }
    if (reconciled.unknownHeldSymbols.length) {
      blocked.push({ market: signal.market, reason: "unmanaged non-EUR holdings present" });
      continue;
    }
    if (unmanagedOrders.length) {
      blocked.push({ market: signal.market, reason: "unmanaged open orders present" });
      continue;
    }

    const t = await getJson(`${BITVAVO}/ticker/24h?market=${signal.market}`, env);
    const ticker = compactTicker(Array.isArray(t) ? t[0] : t);
    const live = calcLiveTrade(signal, ticker, account, reservedRisk, pendingCapital);
    if (!live) {
      blocked.push({ market: signal.market, reason: "live price no longer satisfies strict R/R/risk gates" });
      continue;
    }

    const preAlertInfo = preAlertLeadByMarket.get(signal.market) || null;
    const telegram = await sendTelegram(env, telegramMessage(signal, live, signalsDoc, aiReviewDoc, preAlertInfo));
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
      expiresAtMs: nowMs + ALERT_RESERVATION_MIN * 60000,
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
        "User-Agent": "bitvavo-collector/2.16",
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
          version: "2.16",
          snapshotMode: "github-actions-dispatch",
          alertLayer: {
            preAlerts: true,
            maxEntryCeiling: true,
            buyValidityMeasurement: true,
            strictEngineModified: false
          },
          routes: {
            market: "/market/BTC-EUR",
            publish: "/publish",
            privateSync: "/sync-private (POST, X-Private-Sync-Key required)",
            alertCheck: "/alert-check (POST, X-Alert-Key required)",
            telegramTest: "/telegram-test (POST, X-Alert-Key required)"
          },
          scheduledHandler: true,
          recommendedCrons: {
            snapshot: "*/5 * * * *",
            alertFallback: "2-57/5 * * * *",
            privateSync: "3,18,33,48 * * * *"
          },
          privateAccountSyncConfigured: Boolean(env?.PRIVATE_GITHUB_REPO && env?.PRIVATE_GITHUB_TOKEN),
          privateManualSyncConfigured: Boolean(env?.PRIVATE_SYNC_KEY),
          telegramAlertsConfigured: Boolean(env?.TELEGRAM_BOT_TOKEN && env?.TELEGRAM_CHAT_ID),
          manualAlertCheckConfigured: Boolean(env?.ALERT_TRIGGER_KEY),
          githubSnapshotDispatchConfigured: Boolean(env?.GITHUB_TOKEN)
        });
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
        return jsonResponse(await sendTelegram(env, "✅ Test alerte Bitvavo temps réel — Worker 2.16 opérationnel."));
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