// PPLX Helper popup.js

const sessionTokensEl = document.getElementById('sessionTokens');
const answersCountEl = document.getElementById('answersCount');

const ids = ['enableSessionCounter', 'enableImprovePrompt'];
const apiKeyInput = document.getElementById('openrouterApiKey');
const modelInput = document.getElementById('openrouterModel');
const saveBtn = document.getElementById('saveBtn');
const statusSpan = document.getElementById('status');

const defaultConfig = {
  enableSessionCounter: true,
  enableImprovePrompt: true,
  charsPerToken: 4,
  softLimitTokens: 4000,
  hardLimitTokens: 8000,
  openrouterApiKey: '',
  openrouterModel: 'deepseek/deepseek-r1-free'
};

function queryActiveTab(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs.length) return cb(null);
    cb(tabs[0].id);
  });
}

function updateStats() {
  queryActiveTab((tabId) => {
    if (!tabId) return;
    chrome.storage.local.get(['sessionTokens', 'answersCount'], (data) => {
      sessionTokensEl.textContent = (data.sessionTokens || 0).toLocaleString();
      answersCountEl.textContent = String(data.answersCount || 0);
    });
  });
}

function loadOptions() {
  chrome.storage.sync.get('pplxHelperConfig', (data) => {
    const cfg = { ...defaultConfig, ...data.pplxHelperConfig };
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = !!cfg[id];
    });
    apiKeyInput.value = cfg.openrouterApiKey || '';
    modelInput.value = cfg.openrouterModel || 'deepseek/deepseek-r1-free';
  });
}

function saveOptions() {
  const cfg = { ...defaultConfig };
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) cfg[id] = el.checked;
  });
  cfg.charsPerToken = 4; // жёстко фиксируем
  cfg.openrouterApiKey = apiKeyInput.value.trim();
  cfg.openrouterModel = modelInput.value.trim() || 'deepseek/deepseek-r1-free';
  
  chrome.storage.sync.set({ pplxHelperConfig: cfg }, () => {
    statusSpan.textContent = '✅ Настройки сохранены';
    setTimeout(() => { statusSpan.textContent = ''; }, 1500);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadOptions();
  updateStats();
});

saveBtn.onclick = saveOptions;
