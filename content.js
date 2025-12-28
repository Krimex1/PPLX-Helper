// PPLX Helper — content.js

let config = null;

// session stats
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
      enablePromptCounter: true,
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
    improveBtn.style.position = 'absolute';
    improveBtn.style.right = '8px';
    improveBtn.style.top = '8px';
    improveBtn.style.zIndex = '99999';
    container.appendChild(improveBtn);

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

      improveBtn.disabled = true;
      const prevText = improveBtn.textContent;
      improveBtn.textContent = 'Ждём...';

      chrome.runtime.sendMessage({ action: 'improvePrompt', prompt }, (res) => {
        improveBtn.textContent = prevText;
        if (!res || !res.ok) {
          improveBtn.disabled = false;
          return;
        }
        const improved = (res.text || '').trim() || prompt;
        setPromptText(inputEl, improved);
        inputEl.focus();
        improveBtn.disabled = false;
      });
    };
  }
}

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

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "pplxFocus") {
    const ok = focusPrompt();
    sendResponse({ ok });
  } else if (req.action === "pplxSetPrompt") {
    const input = getPromptInput();
    if (input) {
      setPromptText(input, req.text);
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false });
    }
  }
  return true;
});

loadConfig(() => {
  observePrompt();
});