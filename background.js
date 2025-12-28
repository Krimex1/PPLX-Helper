// PPLX Helper — background.js

const PPLX_ORIGIN = "https://www.perplexity.ai";
const PPLX_HOME = "https://www.perplexity.ai/";

const pendingByTabId = new Map();

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "pplx_focus_or_open") return;
  const tabs = await chrome.tabs.query({ url: PPLX_ORIGIN + "/*" });
  if (tabs.length > 0) {
    chrome.tabs.update(tabs[0].id, { active: true });
    chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    chrome.tabs.create({ url: PPLX_HOME });
  }
});

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
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a strict prompt rewriter. Rewrite user prompt to be clearer. Reply with REWRITTEN PROMPT ONLY." },
            { role: "user", content: req.prompt }
          ]
        })
      });
      const json = await resp.json();
      sendResponse({ ok: true, text: json.choices[0].message.content });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  });
  return true;
});