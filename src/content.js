(() => {
  const TARGET_TEXT = "go to live market";
  const DEFAULT_CLICK_DELAY_MS = 3000;
  const MIN_CLICK_DELAY_MS = 3000;
  const MAX_CLICK_DELAY_MS = 8000;
  const ANOMALY_RESET_DELAY_MS = 5000;
  const DELAY_STEP_MS = 1000;
  const SCAN_INTERVAL_MS = 500;
  const MARKET_CHECK_INTERVAL_MS = 750;
  const MARKET_CHECK_WINDOW_MS = 15000;
  const REFRESH_THROTTLE_MS = 20000;
  const SUCCESS_DECAY_THRESHOLD = 3;
  const STORAGE_KEYS = {
    clickDelay: "polymarketLiveFollow.clickDelayMs",
    lastFollowClickAt: "polymarketLiveFollow.lastFollowClickAt",
    lastFollowFromUrl: "polymarketLiveFollow.lastFollowFromUrl",
    lastFollowTargetUrl: "polymarketLiveFollow.lastFollowTargetUrl",
    lastReadinessHandledClickAt: "polymarketLiveFollow.lastReadinessHandledClickAt",
    lastAnomalyRefreshAt: "polymarketLiveFollow.lastAnomalyRefreshAt",
    successfulFollows: "polymarketLiveFollow.successfulFollows"
  };

  let pendingButton = null;
  let pendingTimer = null;
  let clickDelayMs = DEFAULT_CLICK_DELAY_MS;
  let storageReady = false;

  function normalizeText(value) {
    return value.replace(/\s+/g, " ").trim().toLowerCase();
  }

  function canonicalUrl(value) {
    if (!value) {
      return "";
    }

    try {
      const url = new URL(value, window.location.href);
      url.hash = "";
      return url.toString();
    } catch {
      return "";
    }
  }

  function hasChromeStorage() {
    return (
      typeof chrome !== "undefined" &&
      chrome.storage &&
      chrome.storage.local
    );
  }

  function storageGet(keys) {
    if (!hasChromeStorage()) {
      return Promise.resolve({});
    }

    return chrome.storage.local.get(keys);
  }

  function storageSet(values) {
    if (!hasChromeStorage()) {
      return Promise.resolve();
    }

    return chrome.storage.local.set(values);
  }

  function normalizeDelay(value) {
    if (!Number.isFinite(value) || value < MIN_CLICK_DELAY_MS || value > MAX_CLICK_DELAY_MS) {
      return DEFAULT_CLICK_DELAY_MS;
    }

    return value;
  }

  async function initializeState() {
    const state = await storageGet([
      STORAGE_KEYS.clickDelay,
      STORAGE_KEYS.lastFollowClickAt
    ]);

    clickDelayMs = normalizeDelay(state[STORAGE_KEYS.clickDelay]);
    storageReady = true;
    scanForLiveMarketButton();

    if (isRecentTimestamp(state[STORAGE_KEYS.lastFollowClickAt], MARKET_CHECK_WINDOW_MS)) {
      checkMarketReadiness();
    }
  }

  function isVisible(element) {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function isClickableButton(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    if (element.matches("button:disabled, [aria-disabled='true']")) {
      return false;
    }

    return isVisible(element);
  }

  function findLiveMarketButton() {
    const candidates = document.querySelectorAll("button, a[role='button'], a");

    for (const candidate of candidates) {
      if (!isClickableButton(candidate)) {
        continue;
      }

      const label = normalizeText(
        `${candidate.textContent || ""} ${candidate.getAttribute("aria-label") || ""}`
      );

      if (label.includes(TARGET_TEXT)) {
        return candidate;
      }
    }

    return null;
  }

  function getTargetUrl(button) {
    if (button instanceof HTMLAnchorElement) {
      return canonicalUrl(button.href);
    }

    const link = button.closest("a[href]");
    return canonicalUrl(link?.href || "");
  }

  function findUnsetPriceIndicator() {
    const candidates = document.querySelectorAll("span");

    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement) || !isVisible(candidate)) {
        continue;
      }

      if (normalizeText(candidate.textContent || "") !== "--") {
        continue;
      }

      const className = candidate.className.toString();

      if (className.includes("tracking-wide") || className.includes("mt-1")) {
        return candidate;
      }
    }

    return null;
  }

  function textHasDollarValue(value) {
    return /(?:^|\s)[+-]?\$?\d[\d,]*(?:\.\d+)?/.test(value);
  }

  function findMissingCurrentPriceIndicator() {
    const candidates = document.querySelectorAll("div, span");

    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement) || !isVisible(candidate)) {
        continue;
      }

      if (normalizeText(candidate.textContent || "") !== "current price") {
        continue;
      }

      const metricContainer = candidate.closest("div.flex.flex-col") || candidate.parentElement;
      const metricText = normalizeText(metricContainer?.textContent || "");

      if (!textHasDollarValue(metricText) || metricText.includes("--")) {
        return candidate;
      }
    }

    return null;
  }

  function findUnreadyMarketIndicator() {
    return findUnsetPriceIndicator() || findMissingCurrentPriceIndicator();
  }

  function isRecentTimestamp(value, windowMs) {
    return Number.isFinite(value) && Date.now() - value <= windowMs;
  }

  function clearPendingClick() {
    if (pendingTimer !== null) {
      window.clearTimeout(pendingTimer);
      pendingTimer = null;
    }

    pendingButton = null;
  }

  function scheduleClick(button) {
    if (button === pendingButton && pendingTimer !== null) {
      return;
    }

    clearPendingClick();
    pendingButton = button;

    pendingTimer = window.setTimeout(async () => {
      pendingTimer = null;

      if (!pendingButton || !pendingButton.isConnected || !isClickableButton(pendingButton)) {
        clearPendingClick();
        scanForLiveMarketButton();
        return;
      }

      const followClickAt = Date.now();
      const targetUrl = getTargetUrl(pendingButton);

      await storageSet({
        [STORAGE_KEYS.lastFollowClickAt]: followClickAt,
        [STORAGE_KEYS.lastFollowFromUrl]: canonicalUrl(window.location.href),
        [STORAGE_KEYS.lastFollowTargetUrl]: targetUrl,
        [STORAGE_KEYS.lastReadinessHandledClickAt]: 0
      });

      pendingButton.click();
      window.setTimeout(checkMarketReadiness, MARKET_CHECK_INTERVAL_MS);
      clearPendingClick();
    }, clickDelayMs);
  }

  function scanForLiveMarketButton() {
    if (!storageReady) {
      return;
    }

    const button = findLiveMarketButton();

    if (button) {
      scheduleClick(button);
      return;
    }

    clearPendingClick();
  }

  async function increaseDelayAfterAnomaly() {
    const state = await storageGet([
      STORAGE_KEYS.clickDelay,
      STORAGE_KEYS.successfulFollows
    ]);
    const currentDelay = normalizeDelay(state[STORAGE_KEYS.clickDelay] || clickDelayMs);
    const nextDelay = currentDelay >= MAX_CLICK_DELAY_MS
      ? ANOMALY_RESET_DELAY_MS
      : Math.min(MAX_CLICK_DELAY_MS, currentDelay + DELAY_STEP_MS);

    clickDelayMs = nextDelay;

    await storageSet({
      [STORAGE_KEYS.clickDelay]: nextDelay,
      [STORAGE_KEYS.successfulFollows]: 0,
      [STORAGE_KEYS.lastReadinessHandledClickAt]: 0
    });
  }

  async function noteSuccessfulFollow(followClickAt) {
    const state = await storageGet([
      STORAGE_KEYS.clickDelay,
      STORAGE_KEYS.successfulFollows
    ]);
    const currentDelay = normalizeDelay(state[STORAGE_KEYS.clickDelay] || clickDelayMs);
    const successes = Number.isFinite(state[STORAGE_KEYS.successfulFollows])
      ? state[STORAGE_KEYS.successfulFollows] + 1
      : 1;

    if (currentDelay <= ANOMALY_RESET_DELAY_MS || successes < SUCCESS_DECAY_THRESHOLD) {
      await storageSet({
        [STORAGE_KEYS.successfulFollows]: successes,
        [STORAGE_KEYS.lastReadinessHandledClickAt]: followClickAt
      });
      return;
    }

    clickDelayMs = Math.max(ANOMALY_RESET_DELAY_MS, currentDelay - DELAY_STEP_MS);

    await storageSet({
      [STORAGE_KEYS.clickDelay]: clickDelayMs,
      [STORAGE_KEYS.successfulFollows]: 0,
      [STORAGE_KEYS.lastReadinessHandledClickAt]: followClickAt
    });
  }

  async function refreshAfterAnomaly() {
    const state = await storageGet([STORAGE_KEYS.lastAnomalyRefreshAt]);

    if (isRecentTimestamp(state[STORAGE_KEYS.lastAnomalyRefreshAt], REFRESH_THROTTLE_MS)) {
      return;
    }

    await increaseDelayAfterAnomaly();
    await storageSet({
      [STORAGE_KEYS.lastAnomalyRefreshAt]: Date.now()
    });
    window.location.reload();
  }

  async function checkMarketReadiness() {
    const state = await storageGet([
      STORAGE_KEYS.lastFollowClickAt,
      STORAGE_KEYS.lastFollowFromUrl,
      STORAGE_KEYS.lastFollowTargetUrl,
      STORAGE_KEYS.lastReadinessHandledClickAt
    ]);
    const followClickAt = state[STORAGE_KEYS.lastFollowClickAt];
    const currentUrl = canonicalUrl(window.location.href);
    const fromUrl = state[STORAGE_KEYS.lastFollowFromUrl];
    const targetUrl = state[STORAGE_KEYS.lastFollowTargetUrl];

    if (!isRecentTimestamp(followClickAt, MARKET_CHECK_WINDOW_MS)) {
      return;
    }

    if ((targetUrl && currentUrl !== targetUrl) || (!targetUrl && currentUrl === fromUrl)) {
      return;
    }

    if (state[STORAGE_KEYS.lastReadinessHandledClickAt] === followClickAt) {
      return;
    }

    if (findUnreadyMarketIndicator()) {
      await refreshAfterAnomaly();
      return;
    }

    await noteSuccessfulFollow(followClickAt);
  }

  const observer = new MutationObserver(scanForLiveMarketButton);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  window.setInterval(scanForLiveMarketButton, SCAN_INTERVAL_MS);
  window.setInterval(checkMarketReadiness, MARKET_CHECK_INTERVAL_MS);
  initializeState();
})();
