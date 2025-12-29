// PPLX Helper — content.js

let config = null;

// session stats (оставил, т.к. ими пользуется popup)
let sessionTokens = 0;
let answersCount = 0;
let totalAnswerTokens = 0;
let lastAnswerText = null;

const pendingAnswers = new Set();
let batchTimer = null;
let promptObserverStarted = false;

// --------- config ---------
function loadConfig(cb) {
  chrome.storage.sync.get(["pplxHelperConfig"], (data) => {
    const defaults = {
      enablePromptCounter: true, // флаги оставлены для совместимости
      enablePromptMetrics: true,
      enableDiff: true,
      enableTimeline: true,
      enableSessionCounter: true,
      enableImprovePrompt: true,

      charsPerToken: 4,
      softLimitTokens: 4000,
      hardLimitTokens: 8000,

      openrouterApiKey: "",
      openrouterModel: "deepseek/deepseek-r1:free"
    };

    config = { ...defaults, ...(data.pplxHelperConfig || {}) };
    cb();
  });
}

function approxTokens(text) {
  const chars = (text || "").length;
  const cpt = config?.charsPerToken || 4;
  return Math.ceil(chars / cpt);
}

// --------- prompt input helpers ---------
function getPromptInput() {
  // Perplexity — SPA, форма может меняться, поэтому ищем мягко
  const form = document.querySelector("form");
  if (form) {
    const ta = form.querySelector("textarea");
    if (ta) return ta;
    const ce = form.querySelector("[contenteditable='true']");
    if (ce) return ce;
  }
  return document.querySelector("textarea, [contenteditable='true']") || null;
}

function getPromptText(input) {
  if (!input) return "";
  if ("value" in input) return input.value || "";
  return input.innerText || input.textContent || "";
}

function dispatchInputEvents(input) {
  const evts = ["keydown", "keyup", "input", "change"];
  for (const t of evts) {
    input.dispatchEvent(new Event(t, { bubbles: true, cancelable: true }));
  }
}

// надёжная подстановка текста в textarea / contenteditable
function setPromptText(input, text) {
  const value = String(text || "");
  if (!input) return false;

  if ("value" in input) {
    input.focus();
    input.value = value;
    if (typeof input.setSelectionRange === "function") {
      input.setSelectionRange(value.length, value.length);
    }
    dispatchInputEvents(input);
    return true;
  }

  if (input.isContentEditable) {
    input.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("delete");
    document.execCommand("insertText", false, value);
    dispatchInputEvents(input);
    return true;
  }

  return false;
}

function focusPrompt() {
  const input = getPromptInput();
  if (!input) return false;
  input.focus();
  try {
    input.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (e) {}
  return true;
}

// --------- поиск контейнера с кнопками Search/Research/Labs ---------
function findModeButtonsRow(scopeRoot) {
  const root = scopeRoot || document;
  const buttons = Array.from(root.querySelectorAll("button"));

  const has = (btn, words) => {
    const t = (btn.textContent || "").trim().toLowerCase();
    return words.some((w) => t === w || t.includes(w));
  };

  const isModeBtn = (btn) =>
    has(btn, ["search", "поиск"]) ||
    has(btn, ["research", "исслед", "исследование"]) ||
    has(btn, ["labs", "lab", "лаборат", "лаборатория", "лаборатории"]);

  const counts = new Map();
  for (const b of buttons) {
    if (!isModeBtn(b)) continue;
    const p = b.parentElement;
    if (!p) continue;
    counts.set(p, (counts.get(p) || 0) + 1);
  }

  let best = null;
  let bestScore = 0;
  for (const [p, score] of counts.entries()) {
    if (score > bestScore && score >= 2) {
      best = p;
      bestScore = score;
    }
  }

  return best;
}

function placeImproveButtonNearModes(improveBtn) {
  const input = getPromptInput();
  if (!input) return false;

  const form = input.closest("form") || document;
  const row = findModeButtonsRow(form);
  if (!row) return false;

  improveBtn.style.position = "static";
  improveBtn.style.top = "";
  improveBtn.style.right = "";
  improveBtn.style.zIndex = "auto";
  improveBtn.style.marginLeft = "8px";
  improveBtn.style.alignSelf = "center";

  row.appendChild(improveBtn);
  return true;
}

// --------- Prompt UI (кнопка "Улучшить Промпт") ---------
function attachPromptUI() {
  const input = getPromptInput();
  if (!input) return;

  const container = input.parentElement;
  if (!container) return;

  const style = window.getComputedStyle(container);
  if (style.position === 'static') container.style.position = 'relative';

  let improveBtn = document.getElementById('pplx-helper-improve-btn');
  if (!improveBtn) {
    improveBtn = document.createElement('button');
    improveBtn.id = 'pplx-helper-improve-btn';
    improveBtn.textContent = 'Улучшить промпт';
    improveBtn.type = 'button';
    improveBtn.style.fontSize = '11px';
    improveBtn.style.padding = '4px 8px';
    improveBtn.style.borderRadius = '8px';
    improveBtn.style.border = 'none';
    improveBtn.style.background = '#20b2aa';
    improveBtn.style.color = '#fff';
    improveBtn.style.cursor = 'pointer';
    improveBtn.style.pointerEvents = 'auto';
    improveBtn.style.position = 'absolute';
    improveBtn.style.right = '8px';
    improveBtn.style.top = '8px';
    improveBtn.style.zIndex = '99999';

    container.appendChild(improveBtn);
  }

  const refreshImproveState = () => {
    const enabled = !!config.enableImprovePrompt;
    improveBtn.style.display = enabled ? 'inline-block' : 'none';

    const hasKey = !!(config.openrouterApiKey && config.openrouterApiKey.trim());
    if (!hasKey) {
      improveBtn.disabled = true;
      improveBtn.style.opacity = '0.5';
      improveBtn.title = 'Добавь OpenRouter API ключ в настройках расширения';
    } else {
      improveBtn.disabled = false;
      improveBtn.style.opacity = '1';
      improveBtn.title = '';
    }
  };

  refreshImproveState();

  improveBtn.onclick = () => {
    const inputEl = getPromptInput();
    const prompt = getPromptText(inputEl).trim();
    if (!prompt) return;

    try {
      if (!chrome?.runtime?.id) {
        improveBtn.title = 'Расширение перезагружено — обнови страницу';
        return;
      }
    } catch (e) {
      improveBtn.title = 'Расширение перезагружено — обнови страницу';
      return;
    }

    improveBtn.disabled = true;
    const prevText = improveBtn.textContent;
    improveBtn.textContent = 'Ждём...';

    chrome.runtime.sendMessage({ action: 'improvePrompt', prompt }, (res) => {
      improveBtn.textContent = prevText;

      if (chrome.runtime.lastError) {
        improveBtn.disabled = false;
        improveBtn.title = 'Связь с расширением потеряна — обнови страницу';
        return;
      }

      if (!res || !res.ok) {
        improveBtn.disabled = false;
        if (res?.error === 'NOAPIKEY' || res?.error === 'NO_API_KEY') {
          improveBtn.title = 'Нет OpenRouter API ключа (задать в настройках)';
        }
        return;
      }

      const improved = (res.text || '').trim() || prompt;

      // ЖЁСТКАЯ ЗАМЕНА промпта
      chrome.runtime.sendMessage(
        {
          action: 'pplxSetPrompt',
          text: improved,
          mode: 'replace',
          focus: true,
          autoSubmit: false
        },
        () => {
          const again = getPromptInput();
          if (again) {
            setPromptText(again, improved); // полностью перезаписываем
            again.focus();
          }
          improveBtn.disabled = false;
        }
      );
    });
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (!changes.pplxHelperConfig) return;
    config = { ...config, ...(changes.pplxHelperConfig.newValue || {}) };
    refreshImproveState();
  });
}

// SPA: если React перерисовал composer, восстанавливаем кнопку
function observePrompt() {
  if (promptObserverStarted) return;
  promptObserverStarted = true;

  const root = document.querySelector("main") || document.body;
  const observer = new MutationObserver(() => {
    const input = getPromptInput();
    const btn = document.getElementById("pplx-helper-improve-btn");
    if (input && !btn) attachPromptUI();
  });
  observer.observe(root, { childList: true, subtree: true });
}

// --------- сообщения от background.js (focus/setPrompt + статистика) ---------
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "pplxFocus") {
    const ok = focusPrompt();
    sendResponse({ ok });
    return;
  }

  if (req.action === "pplxSetPrompt") {
    const input = getPromptInput();
    if (!input) {
      sendResponse({ ok: false, error: "NO_INPUT" });
      return;
    }

    const mode = req.mode || "replace"; // replace | append | prepend | keep
    const incoming = String(req.text || "");
    const cur = getPromptText(input);
    let next = cur;

    if (mode === "replace") next = incoming;
    else if (mode === "append") next = (cur ? cur + "\n\n" : "") + incoming;
    else if (mode === "prepend") next = incoming + (cur ? "\n\n" + cur : "");
    else if (mode === "keep") next = cur || incoming;

    const ok = setPromptText(input, next);
    if (req.focus !== false) {
      focusPrompt();
    }

    if (ok && req.autoSubmit) {
      try {
        const form = input.closest("form");
        if (form) {
          form.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true })
          );
        }
      } catch (e) {}
    }

    sendResponse({ ok });
    return true;
  }

  if (req.action === "getSessionStats") {
    chrome.storage.local.get(
      ["sessionTokens", "answersCount", "totalAnswerTokens"],
      (data) => {
        const total = data.sessionTokens || 0;
        const count = data.answersCount || 0;
        const totalAns = data.totalAnswerTokens || 0;
        const avg = count > 0 ? totalAns / count : 0;
        sendResponse({
          sessionTokens: total,
          answersCount: count,
          avgAnswerTokens: avg
        });
      }
    );
    return true;
  }

  if (req.action === 'countAllChats') {
	// Считаем все чаты на странице Perplexity Library
	const chatElements = document.querySelectorAll('[data-testid="conversation-item"], .conversation-item, [role="listitem"]');
	const totalChats = chatElements.length;
	sendResponse({ totalChats });
	return true;
  }

  if (req.action === "resetSession") {
    sessionTokens = 0;
    answersCount = 0;
    totalAnswerTokens = 0;
    chrome.storage.local.set(
      { sessionTokens: 0, answersCount: 0, totalAnswerTokens: 0 },
      () => sendResponse({ ok: true })
    );
    return true;
  }

  return undefined;
});

// --------- ответы / статистика ---------
function processAnswerElement(answerEl) {
  if (!answerEl || answerEl.dataset.pplxProcessed === "1") return;

  const text = answerEl.innerText || answerEl.textContent || "";
  if (!text.trim()) return;

  const tokens = approxTokens(text);

  if (config.enableSessionCounter) {
    sessionTokens += tokens;
    answersCount += 1;
    totalAnswerTokens += tokens;
    chrome.storage.local.set({ sessionTokens, answersCount, totalAnswerTokens });
  }

  if (
    config.enableDiff &&
    lastAnswerText &&
    !answerEl.querySelector(".pplx-helper-diff")
  ) {
    const diffPercent = computeDiffPercent(lastAnswerText, text);
    const diff = document.createElement("div");
    diff.className = "pplx-helper-diff";
    diff.style.fontSize = "11px";
    diff.style.color = "#aaa";
    diff.textContent = `Изменено примерно ${diffPercent}% текста по сравнению с прошлым ответом`;
    answerEl.appendChild(diff);
  }

  lastAnswerText = text;

  if (config.enableTimeline) createTimeline(answerEl);

  if (!answerEl.querySelector(".pplx-helper-answer-meta")) {
    const meta = document.createElement("div");
    meta.className = "pplx-helper-answer-meta";
    meta.style.marginTop = "6px";
    meta.style.fontSize = "11px";
    meta.style.color = "#888";
    const avg =
      answersCount > 0 ? Math.round(totalAnswerTokens / answersCount) : tokens;
    meta.textContent = `Ответ ~${tokens} токенов`;
    answerEl.appendChild(meta);
  }

  answerEl.dataset.pplxProcessed = "1";
}

function scheduleAnswerProcessing() {
  if (batchTimer) return;
  batchTimer = setTimeout(() => {
    batchTimer = null;
    pendingAnswers.forEach((el) => processAnswerElement(el));
    pendingAnswers.clear();
  }, 150);
}

function queueAnswerElement(el) {
  pendingAnswers.add(el);
  scheduleAnswerProcessing();
}

function computeDiffPercent(prevText, newText) {
  const prev = prevText.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const cur = newText.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (!prev.length || !cur.length) return 100;

  let changed = 0;
  const maxLen = Math.max(prev.length, cur.length);
  for (let i = 0; i < maxLen; i++) {
    if (prev[i] !== cur[i]) changed++;
  }
  return Math.round((changed / maxLen) * 100);
}

function createTimeline(answerEl) {
  const existing = answerEl.querySelector(".pplx-helper-timeline");
  if (existing) existing.remove();

  const blocks = Array.from(
    answerEl.querySelectorAll("h1,h2,h3,pre,code,ul,ol")
  );
  if (!blocks.length) return;

  const container = document.createElement("div");
  container.className = "pplx-helper-timeline";
  container.style.position = "relative";
  container.style.height = "6px";
  container.style.background = "#2a2a2a";
  container.style.borderRadius = "4px";
  container.style.marginTop = "8px";
  container.style.cursor = "pointer";

  const rect = answerEl.getBoundingClientRect();
  const totalHeight = rect.height || 1;

  blocks.forEach((block) => {
    const br = block.getBoundingClientRect();
    const rel = (br.top - rect.top) / totalHeight;
    const marker = document.createElement("div");
    marker.style.position = "absolute";
    marker.style.left = Math.min(Math.max(rel * 100, 0), 99).toFixed(2) + "%";
    marker.style.width = "2px";
    marker.style.top = "0";
    marker.style.bottom = "0";
    marker.style.background = "#20b2aa";
    marker.addEventListener("click", (e) => {
      e.stopPropagation();
      block.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    container.appendChild(marker);
  });

  answerEl.appendChild(container);
}

function hookAnswers() {
  const container = document.querySelector("main") || document.body;
  const existing = container.querySelectorAll(
    ".prose, [data-testid='message-answer']"
  );
  existing.forEach(queueAnswerElement);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches(".prose, [data-testid='message-answer']")) {
          queueAnswerElement(node);
        }
        const inner = node.querySelectorAll?.(
          ".prose, [data-testid='message-answer']"
        );
        if (inner && inner.length) inner.forEach(queueAnswerElement);
      }
    }
  });

  observer.observe(container, { childList: true, subtree: true });
}

// --------- init ---------
function initHelper() {
  loadConfig(() => {
    chrome.storage.local.get(
      ["sessionTokens", "answersCount", "totalAnswerTokens"],
      (data) => {
        sessionTokens = data.sessionTokens || 0;
        answersCount = data.answersCount || 0;
        totalAnswerTokens = data.totalAnswerTokens || 0;
      }
    );

    attachPromptUI();
    observePrompt();
    hookAnswers();

    setTimeout(attachPromptUI, 1500);
    setTimeout(attachPromptUI, 3500);
  });
}

document.addEventListener("DOMContentLoaded", initHelper);
setTimeout(initHelper, 2000);
