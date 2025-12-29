const defaultConfig = {
  enablePromptCounter: true,
  enableAnswerCost: true,
  enableDiff: true,
  enableTimeline: true,
  enableSessionCounter: true,
  charsPerToken: 4,
  modelPrices: {
    "Sonar Pro": 2.0,
    "Sonar": 1.0,
    "GPT-4o": 5.0,
    "Standard": 1.0
  }
};

const ids = [
  "enablePromptCounter",
  "enableAnswerCost",
  "enableDiff",
  "enableTimeline",
  "enableSessionCounter"
];

const modelsContainer = document.getElementById('modelsContainer');
const addModelBtn = document.getElementById('addModelBtn');
const saveBtn = document.getElementById('saveBtn');
const statusSpan = document.getElementById('status');
const charsPerTokenInput = document.getElementById('charsPerToken');

function createModelRow(name = "", price = 1.0) {
  const row = document.createElement('div');
  row.className = 'model-row';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Модель';
  nameInput.value = name;

  const priceInput = document.createElement('input');
  priceInput.type = 'number';
  priceInput.min = '0';
  priceInput.step = '0.01';
  priceInput.value = price;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.textContent = '×';
  removeBtn.style.background = '#444';
  removeBtn.style.padding = '4px 8px';
  removeBtn.onclick = () => row.remove();

  row.appendChild(nameInput);
  row.appendChild(priceInput);
  row.appendChild(removeBtn);
  modelsContainer.appendChild(row);
}

function loadOptions() {
  chrome.storage.sync.get(['pplxHelperConfig'], data => {
    const cfg = { ...defaultConfig, ...(data.pplxHelperConfig || {}) };

    ids.forEach(id => {
      document.getElementById(id).checked = !!cfg[id];
    });
    charsPerTokenInput.value = cfg.charsPerToken || 4;

    modelsContainer.innerHTML = '';
    Object.entries(cfg.modelPrices || {}).forEach(([name, price]) =>
      createModelRow(name, price)
    );
  });
}

function saveOptions() {
  const cfg = { ...defaultConfig };

  ids.forEach(id => {
    cfg[id] = document.getElementById(id).checked;
  });

  const cpt = parseFloat(charsPerTokenInput.value);
  cfg.charsPerToken = isNaN(cpt) || cpt <= 0 ? 4 : cpt;

  const modelPrices = {};
  modelsContainer.querySelectorAll('.model-row').forEach(row => {
    const [nameInput, priceInput] = row.querySelectorAll('input');
    const name = nameInput.value.trim();
    const price = parseFloat(priceInput.value);
    if (!name || isNaN(price)) return;
    modelPrices[name] = price;
  });
  cfg.modelPrices = modelPrices;

  chrome.storage.sync.set({ pplxHelperConfig: cfg }, () => {
    statusSpan.textContent = 'Сохранено';
    setTimeout(() => (statusSpan.textContent = ''), 1500);
  });
}

addModelBtn.onclick = () => createModelRow();
saveBtn.onclick = saveOptions;
document.addEventListener('DOMContentLoaded', loadOptions);