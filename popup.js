// PPLX Helper popup.js
const sessionTokensEl = document.getElementById('sessionTokens');
const answersCountEl = document.getElementById('answersCount');
const apiKeyInput = document.getElementById('openrouterApiKey');
const modelInput = document.getElementById('openrouterModel');
const saveBtn = document.getElementById('saveBtn');
const statusSpan = document.getElementById('status');

function loadOptions() {
  chrome.storage.sync.get('pplxHelperConfig', (data) => {
    const cfg = data.pplxHelperConfig || {};
    apiKeyInput.value = cfg.openrouterApiKey || '';
    modelInput.value = cfg.openrouterModel || 'deepseek/deepseek-r1:free';
  });
  chrome.storage.local.get(['sessionTokens', 'answersCount'], (data) => {
    sessionTokensEl.textContent = (data.sessionTokens || 0).toLocaleString();
    answersCountEl.textContent = data.answersCount || 0;
  });
}

saveBtn.onclick = () => {
  const cfg = {
    openrouterApiKey: apiKeyInput.value.trim(),
    openrouterModel: modelInput.value.trim(),
    enableImprovePrompt: true
  };
  chrome.storage.sync.set({ pplxHelperConfig: cfg }, () => {
    statusSpan.textContent = '✅ Сохранено';
    setTimeout(() => { statusSpan.textContent = ''; }, 2000);
  });
};

document.addEventListener('DOMContentLoaded', loadOptions);