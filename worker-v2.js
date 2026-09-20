const BITVAVO = "https://api.bitvavo.com/v2";

const GITHUB_OWNER = "Augustus79";
const GITHUB_REPO = "bitvavo-market-data";
const GITHUB_FILE = "snapshot.json";
const GITHUB_BRANCH = "main";
const PRIVATE_ACCOUNT_FILE = "account-state.json";
const PAPER_OPEN_MARKETS_URL = "https://raw.githubusercontent.com/Augustus79/bitvavo-market-data/main/paper/open-markets.json";
const SIGNALS_URL = "https://raw.githubusercontent.com/Augustus79/bitvavo-market-data/main/signals.json";
const LIVE_ALERT_STATE_FILE = "live-alert-state.json";
const ALERT_SIGNAL_MAX_AGE_MIN = 8;
const ALERT_RESERVATION_MIN = 20;
const MAX_LIVE_POSITIONS = 2;
const MAX_COMBINED_LIVE_RISK_EUR = 3;
const DEFAULT_MAKER_FEE_PCT = 0.15;
const DEFAULT_TAKER_FEE_PCT = 0.25;
const SLIPPAGE_BUFFER_PCT = 0.03;

const MAX_DEEP_MARKETS = 9;
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
    "User-Agent": "bitvavo-collector/2.7"
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

async function getPaperOpenMarkets() {
  try {
    const response = await fetch(PAPER_OPEN_MARKETS_URL, {
      headers: { "Accept": "application/json", "User-Agent": "bitvavo-collector/2.7" },
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

async function publishJsonToRepo({ owner, repo, path, branch = "main", data, token, message }) {
  if (!token) throw new Error("GitHub token missing");
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "bitvavo-collector/2.7"
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
    content: utf8ToBase64(JSON.stringify(data, null, 2)),
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
      "User-Agent": "bitvavo-collector/2.7"
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
    getJson(`${BITVAVO}/balance`, env),
    getJson(`${BITVAVO}/ordersOpen`, env),
    getJson(`${BITVAVO}/account/fees?quote=EUR`, env)
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
    "User-Agent": "bitvavo-collector/2.7"
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

async function fetchLatestSignals() {
  const response = await fetch(SIGNALS_URL, {
    headers: { "Accept": "application/json", "User-Agent": "bitvavo-collector/2.7" },
    cf: { cacheTtl: 0, cacheEverything: false }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`signals.json fetch ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.json();
}

function emptyLiveAlertState() {
  return {
    version: "1.0",
    updatedAt: null,
    notifiedKeys: [],
    pendingRecommendations: [],
    activePositions: []
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

function calcLiveTrade(signal, ticker, account, reservedRiskEur, reservedCapitalEur) {
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
  if (!(netRR >= 1.5)) return null;

  const riskBudget = num(signal?.suggestedRiskEur);
  const remainingRisk = Math.max(0, MAX_COMBINED_LIVE_RISK_EUR - reservedRiskEur);
  const riskEur = Math.min(riskBudget || 0, remainingRisk);
  if (!(riskEur > 0)) return null;

  const eurBalance = (account?.balances || []).find((b) => b.symbol === "EUR");
  const availableEur = Math.max(0, (num(eurBalance?.available) || 0) - reservedCapitalEur);
  const amountEur = Math.min(availableEur, riskEur / (netRiskPct / 100));
  if (!(amountEur > 0)) return null;

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
    riskEur: amountEur * netRiskPct / 100,
    amountEur,
    quantity: amountEur / entry
  };
}

function fmt(value, digits = 6) {
  const x = Number(value);
  return Number.isFinite(x) ? x.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "") : "n/a";
}

function telegramMessage(signal, live, signalsDoc) {
  return [
    "🚨 BITVAVO STRICT BUY",
    `${signal.market} | Grade ${signal.tradeGrade} | ${signal.family}`,
    `BTC regime: ${signalsDoc.btcRegime}`,
    "",
    `Entrée live: €${fmt(live.entry)}`,
    `Montant: €${fmt(live.amountEur, 2)}`,
    `Quantité: ${fmt(live.quantity, 8)}`,
    `Stop structurel: €${fmt(live.stop)}`,
    `Risque max estimé: €${fmt(live.riskEur, 2)}`,
    `Cible: €${fmt(live.target)}`,
    `R/R net live: ${fmt(live.netRR, 2)}`,
    `Coûts A/R estimés: ${fmt(live.roundTripCostPct, 2)}%`,
    "",
    "ACTION: vérifier le prix dans Bitvavo Pro puis placer manuellement le trade spot si les niveaux restent comparables. Aucun ordre n'est exécuté automatiquement."
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

    const telegram = await sendTelegram(env, telegramMessage(signal, live, signalsDoc));
    if (!telegram.ok) {
      blocked.push({ market: signal.market, reason: telegram.reason || "Telegram not configured" });
      continue;
    }

    const reservation = {
      key,
      market: signal.market,
      signalSnapshotAt: signalsDoc.snapshotCollectedAt,
      notifiedAt: new Date(nowMs).toISOString(),
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
      telegramMessageId: telegram.messageId,
      status: "pending"
    };
    state.pendingRecommendations.push(reservation);
    pendingMarkets.add(signal.market);
    pendingRisk += reservation.plannedRiskEur;
    pendingCapital += reservation.amountEur;
    state.notifiedKeys.push(key);
    notified.push({ market: signal.market, key, liveNetRR: live.netRR });
  }

  state.notifiedKeys = state.notifiedKeys.slice(-200);
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
    pendingRecommendations: state.pendingRecommendations.map((p) => p.market)
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
          version: "2.7",
          routes: {
            market: "/market/BTC-EUR",
            publish: "/publish",
            privateSync: "/sync-private (POST, X-Private-Sync-Key required)",
            alertCheck: "/alert-check (POST, X-Alert-Key required)",
            telegramTest: "/telegram-test (POST, X-Alert-Key required)"
          },
          scheduledHandler: true,
          recommendedCron: "*/5 * * * *",
          privateAccountSyncConfigured: Boolean(env?.PRIVATE_GITHUB_REPO && env?.PRIVATE_GITHUB_TOKEN),
          privateManualSyncConfigured: Boolean(env?.PRIVATE_SYNC_KEY),
          telegramAlertsConfigured: Boolean(env?.TELEGRAM_BOT_TOKEN && env?.TELEGRAM_CHAT_ID),
          manualAlertCheckConfigured: Boolean(env?.ALERT_TRIGGER_KEY)
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
        return jsonResponse(await sendTelegram(env, "✅ Test alerte Bitvavo temps réel — Worker 2.7 opérationnel."));
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
    // Snapshot collection and alert checking deliberately run independently:
    // alert checking uses the latest fully-generated signals.json from the
    // previous GitHub Actions cycle, avoiding half-built/current snapshots.
    ctx.waitUntil(
      buildAndPublish(env).catch((error) => {
        console.error("Scheduled public snapshot failed:", error);
      })
    );

    if (env?.TELEGRAM_BOT_TOKEN && env?.TELEGRAM_CHAT_ID) {
      ctx.waitUntil(
        checkAndNotifyStrictSignals(env).catch((error) => {
          console.error("Scheduled strict Telegram alert check failed:", error);
        })
      );
    }

    const scheduledAt = new Date(event.scheduledTime || Date.now());
    const shouldSyncPrivate = scheduledAt.getUTCMinutes() % 15 === 0;
    if (shouldSyncPrivate && env?.PRIVATE_GITHUB_REPO && env?.PRIVATE_GITHUB_TOKEN) {
      ctx.waitUntil(
        publishPrivateAccountState(env).catch((error) => {
          console.error("Scheduled private account sync failed:", error);
        })
      );
    }
  }
};