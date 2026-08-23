export const dom = {
  bootScreen: document.querySelector('#boot-screen'),
  accessScreen: document.querySelector('#access-screen'),
  desktop: document.querySelector('#desktop'),
  bootProgress: document.querySelector('#boot-progress'),
  bootMessage: document.querySelector('#boot-message'),
  greeting: document.querySelector('#greeting'),
  windowLayer: document.querySelector('#window-layer'),
};

export const storageKeys = {
  files: 'so-boot-files',
  access: 'so-boot-access',
  accessSession: 'so-boot-unlocked',
  note: 'so-boot-note',
};

const defaultFiles = [
  { id: 'boas-vindas', name: 'Boas-vindas.txt', type: 'TXT', content: 'Bem-vindo ao SO-boot. Seus arquivos ficam neste navegador.', updatedAt: Date.now() },
  { id: 'projetos', name: 'Projetos', type: 'DIR', content: '', updatedAt: Date.now() - 86400000 },
];

let accountName = 'operador';
let apiBaseUrl = '';
let apiServerReady;

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
}

export function getFiles() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKeys.files));
    return Array.isArray(saved) ? saved : defaultFiles;
  } catch {
    return defaultFiles;
  }
}

export function saveFiles(files) {
  localStorage.setItem(storageKeys.files, JSON.stringify(files));
}

export function getAccessRecord() {
  try {
    const record = JSON.parse(localStorage.getItem(storageKeys.access));
    return record && typeof record.salt === 'string' && typeof record.hash === 'string' ? record : null;
  } catch {
    return null;
  }
}

export function terminalPrompt() {
  return `${accountName}@so-boot:~$`;
}

export function updateGreeting() {
  const hour = new Date().getHours();
  const salutation = hour >= 5 && hour < 12 ? 'Bom dia' : hour >= 12 && hour < 18 ? 'Boa tarde' : 'Boa noite';
  dom.greeting.textContent = `${salutation}, ${accountName}.`;
}

function localServerUrl(path) {
  return `${apiBaseUrl}${path}`;
}

async function resolveLocalServer() {
  if (apiServerReady) return apiServerReady;
  apiServerReady = (async () => {
    const localHost = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(window.location.hostname);
    const currentPort = Number(window.location.port);
    if (localHost && currentPort >= 8080 && currentPort <= 8090) return '';

    for (let port = 8080; port <= 8090; port += 1) {
      const candidate = `http://127.0.0.1:${port}`;
      try {
        const response = await fetch(`${candidate}/api/session`, { cache: 'no-store', signal: AbortSignal.timeout(700) });
        const data = await response.json();
        if (response.ok && typeof data.accountName === 'string' && data.accountName.trim()) {
          apiBaseUrl = candidate;
          return candidate;
        }
      } catch {
        // Continua procurando uma instância compatível do SO-boot.
      }
    }
    return '';
  })();
  return apiServerReady;
}

export async function apiFetch(path, options) {
  await resolveLocalServer();
  return fetch(localServerUrl(path), options);
}

export async function loadAccountName() {
  try {
    const response = await apiFetch('/api/session', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || typeof data.accountName !== 'string' || !data.accountName.trim()) return;
    accountName = data.accountName.trim();
    updateGreeting();
    document.querySelectorAll('[data-terminal-account]').forEach((element) => { element.textContent = accountName; });
    document.querySelectorAll('[data-terminal-prompt]').forEach((element) => { element.textContent = terminalPrompt(); });
  } catch {
    // O nome padrão mantém a interface funcional sem o servidor local.
  }
}

export function updateClock() {
  const now = new Date();
  const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  document.querySelector('#clock').textContent = time;
  document.querySelector('#dashboard-time').textContent = time;
  document.querySelector('#dashboard-date').textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function refreshMonitor(windowElement = document) {
  const cpu = Math.floor(18 + Math.random() * 28);
  document.querySelector('#cpu-value').textContent = `${cpu}%`;
  document.querySelector('#cpu-bar').style.width = `${cpu}%`;
  const memory = (3.4 + Math.random() * 0.8).toFixed(1);
  document.querySelector('#memory-value').textContent = `${memory} GB`;
  document.querySelector('#memory-bar').style.width = `${Math.floor(memory / 8 * 100)}%`;
  windowElement.querySelector('#monitor-cpu')?.replaceChildren(`${cpu}% CPU`);
  windowElement.querySelectorAll('#chart i').forEach((bar) => { bar.style.height = `${20 + Math.random() * 80}%`; });
}
