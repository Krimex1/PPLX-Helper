// PPLX Helper — background.js (MV3 service worker)

const PPLX_ORIGIN = "https://www.perplexity.ai";
const PPLX_HOME = "https://www.perplexity.ai/";

const pendingByTabId = new Map(); // tabId -> { text, mode, focus, autoSubmit }
let onUpdatedAttached = false;

async function findPerplexityTab() {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (!t.url) continue;
    if (t.url.startsWith(PPLX_ORIGIN + "/")) return t;
  }
  return null;
}

async function focusTab(tab) {
  if (!tab) return;
  if (tab.windowId != null) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  await chrome.tabs.update(tab.id, { active: true });
}

function ensureOnUpdatedListener() {
  if (onUpdatedAttached) return;
  onUpdatedAttached = true;

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!pendingByTabId.has(tabId)) return;
    if (changeInfo.status !== "complete") return;

    const pending = pendingByTabId.get(tabId);
    if (!pending) return;

    deliverPromptToTab(tabId, pending).catch(() => {});
  });
}

async function deliverPromptToTab(tabId, payload) {
  const tries = 12;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, {
        action: "pplxSetPrompt",
        text: payload.text,
        mode: payload.mode || "replace",
        focus: payload.focus !== false,
        autoSubmit: !!payload.autoSubmit
      });

      if (res && res.ok) {
        pendingByTabId.delete(tabId);
        return true;
      }
    } catch (e) {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

async function openOrReusePerplexityWithPrompt(promptText, opts = {}) {
  ensureOnUpdatedListener();

  let tab = await findPerplexityTab();
  if (!tab) {
    tab = await chrome.tabs.create({ url: PPLX_HOME, active: true });
  } else {
    await focusTab(tab);
  }

  const payload = {
    text: promptText,
    mode: opts.mode || "replace",
    focus: opts.focus !== false,
    autoSubmit: !!opts.autoSubmit
  };

  pendingByTabId.set(tab.id, payload);

  if (tab.status === "complete") {
    await deliverPromptToTab(tab.id, payload);
  }

  return tab.id;
}

// хоткей Alt+Q: открыть Perplexity и сфокусировать поле
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "pplx_focus_or_open") return;
  await openOrReusePerplexityWithPrompt("", { focus: true, mode: "keep" });
});

// --- улучшение промпта через OpenRouter (строгий режим) ---
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action !== "improvePrompt") return;

  chrome.storage.sync.get(["pplxHelperConfig"], async (data) => {
    const cfg = data.pplxHelperConfig || {};
    const apiKey = (cfg.openrouterApiKey || "").trim();
    const model = cfg.openrouterModel || "deepseek/deepseek-r1:free";

    if (!apiKey) {
      sendResponse({ ok: false, error: "NO_API_KEY" });
      return;
    }

    try {
      const body = {
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a strict prompt rewriter. " +
              "Task: rewrite the user's prompt to be clearer, more specific and well-structured, " +
              "without changing its intent. " +
              "Keep EXACTLY the same language as the original (do not translate). " +
              "Important: reply with the REWRITTEN PROMPT ONLY, no explanations, no quotes, no markdown, no commentary."
          },
          {
            role: "user",
            content: req.prompt || ""
          }
        ],
        max_tokens: 512,
        temperature: 0.2
      };

      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://your-extension",
          "X-Title": "PPLX Helper"
        },
        body: JSON.stringify(body)
      });

      if (!resp.ok) {
        sendResponse({ ok: false, error: "HTTP_" + resp.status });
        return;
      }

      const json = await resp.json();
      let text = json?.choices?.[0]?.message?.content || "";
      text = String(text).trim();

      if (!text) text = req.prompt || "";

      sendResponse({ ok: true, text });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  });

  return true;
});
