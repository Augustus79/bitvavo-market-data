export const MODEL_PRICING_USD_PER_MTOK = {
  "gpt-5.6-luna": { input: 0.20, cachedInput: 0.02, output: 1.20 },
  "gpt-5.6-terra": { input: 2.00, cachedInput: 0.20, output: 12.00 },
  "gpt-5.6": { input: 4.00, cachedInput: 0.40, output: 20.00 },
  "gpt-5.6-sol": { input: 4.00, cachedInput: 0.40, output: 20.00 }
};

export const WEB_SEARCH_CALL_USD = 0.01;

export function estimateReviewCost({
  model,
  inputTokens = 0,
  cachedInputTokens = 0,
  outputTokens = 0,
  webSearchCalls = 0,
  usdToEur = 0.87
}) {
  const rates = MODEL_PRICING_USD_PER_MTOK[model];
  if (!rates) {
    return {
      known: false,
      model,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      webSearchCalls,
      estimatedCostUsd: null,
      estimatedCostEur: null,
      usdToEur
    };
  }
  const cached = Math.max(0, Math.min(Number(inputTokens) || 0, Number(cachedInputTokens) || 0));
  const uncached = Math.max(0, (Number(inputTokens) || 0) - cached);
  const output = Math.max(0, Number(outputTokens) || 0);
  const searches = Math.max(0, Number(webSearchCalls) || 0);
  const usd =
    uncached * rates.input / 1_000_000 +
    cached * rates.cachedInput / 1_000_000 +
    output * rates.output / 1_000_000 +
    searches * WEB_SEARCH_CALL_USD;
  return {
    known: true,
    model,
    inputTokens: Number(inputTokens) || 0,
    cachedInputTokens: cached,
    outputTokens: output,
    webSearchCalls: searches,
    estimatedCostUsd: usd,
    estimatedCostEur: usd * usdToEur,
    usdToEur
  };
}

export function extractResponseText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  for (const item of response?.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content?.text === "string") {
        return content.text.trim();
      }
    }
  }
  return "";
}

export function countWebSearchCalls(response) {
  return (response?.output || []).filter((item) => item?.type === "web_search_call").length;
}

export function extractWebSources(response, maxSources = 8) {
  const byUrl = new Map();
  const add = (source) => {
    const url = typeof source?.url === "string" ? source.url : null;
    if (!url || byUrl.has(url)) return;
    byUrl.set(url, {
      title: typeof source?.title === "string" ? source.title : null,
      url
    });
  };

  for (const item of response?.output || []) {
    if (item?.type === "web_search_call") {
      for (const source of item?.action?.sources || []) add(source);
    }
    if (item?.type === "message") {
      for (const content of item?.content || []) {
        for (const ann of content?.annotations || []) {
          if (ann?.type === "url_citation") {
            add({ title: ann.title, url: ann.url });
          }
        }
      }
    }
  }
  return [...byUrl.values()].slice(0, maxSources);
}

export function compactSignalForReview(signal, signalsDoc) {
  return {
    snapshotCollectedAt: signalsDoc?.snapshotCollectedAt ?? null,
    btcRegime: signalsDoc?.btcRegime ?? null,
    market: signal?.market ?? null,
    family: signal?.family ?? null,
    tradeGrade: signal?.tradeGrade ?? null,
    score: signal?.score ?? null,
    entry: signal?.entry ?? null,
    stop: signal?.stop ?? null,
    target: signal?.target ?? null,
    netRR: signal?.netRR ?? null,
    roundTripCostPct: signal?.roundTripCostPct ?? null,
    suggestedRiskEur: signal?.suggestedRiskEur ?? null,
    reasons: signal?.reasons || [],
    triggerReasons: signal?.triggerReasons || [],
    metrics: signal?.metrics || {}
  };
}
