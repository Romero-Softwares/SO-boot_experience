const bootScreen = document.querySelector('#boot-screen');
const accessScreen = document.querySelector('#access-screen');
const desktop = document.querySelector('#desktop');
const bootProgress = document.querySelector('#boot-progress');
const bootMessage = document.querySelector('#boot-message');
const greeting = document.querySelector('#greeting');
const windowLayer = document.querySelector('#window-layer');
let accountName = 'operador';
let apiBaseUrl = '';
let apiServerReady;
const bootSteps = ['Verificando componentes essenciais...', 'Montando armazenamento local...', 'Iniciando interface do operador...', 'Ambiente pronto.'];
const filesStorageKey = 'so-boot-files';
const wifiStorageKey = 'so-boot-wifi';
const accessStorageKey = 'so-boot-access';
const accessSessionKey = 'so-boot-unlocked';
let topWindowZIndex = 10;
const wifiNetworks = [
  { id: 'merotec-office', ssid: 'Merotec Office', security: 'WPA2', signal: 4 },
  { id: 'atelier-5g', ssid: 'Atelier 5G', security: 'WPA3', signal: 3 },
  { id: 'visitantes', ssid: 'Visitantes SO', security: 'Aberta', signal: 2 },
  { id: 'cafe-aurora', ssid: 'Café Aurora', security: 'WPA2', signal: 2 },
];
const defaultFiles = [
  { id: 'boas-vindas', name: 'Boas-vindas.txt', type: 'TXT', content: 'Bem-vindo ao SO-boot. Seus arquivos ficam neste navegador.', updatedAt: Date.now() },
  { id: 'projetos', name: 'Projetos', type: 'DIR', content: '', updatedAt: Date.now() - 86400000 },
];

function getFiles() {
  try {
    const saved = JSON.parse(localStorage.getItem(filesStorageKey));
    return Array.isArray(saved) ? saved : defaultFiles;
  } catch { return defaultFiles; }
}

function saveFiles(files) { localStorage.setItem(filesStorageKey, JSON.stringify(files)); }

function getWifiState() {
  try {
    const saved = JSON.parse(localStorage.getItem(wifiStorageKey));
    return saved && typeof saved === 'object' ? saved : { connectedId: null };
  } catch { return { connectedId: null }; }
}

function saveWifiState(state) { localStorage.setItem(wifiStorageKey, JSON.stringify(state)); }

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
}

function launchAccess() {
  bootScreen.classList.add('hidden');
  accessScreen.classList.remove('hidden');
  desktop.classList.add('hidden');
  setupAccess();
}

function launchDesktop() {
  bootScreen.classList.add('hidden');
  accessScreen.classList.add('hidden');
  desktop.classList.remove('hidden');
}

async function pinDigest(pin, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

function getAccessRecord() {
  try {
    const record = JSON.parse(localStorage.getItem(accessStorageKey));
    return record && typeof record.salt === 'string' && typeof record.hash === 'string' ? record : null;
  } catch { return null; }
}

function setupAccess() {
  const form = document.querySelector('#access-form');
  const pin = document.querySelector('#access-pin');
  const confirmGroup = document.querySelector('#access-confirm-group');
  const confirm = document.querySelector('#access-confirm');
  const title = document.querySelector('#access-title');
  const description = document.querySelector('#access-description');
  const feedback = document.querySelector('#access-feedback');
  const submit = document.querySelector('#access-submit');
  const reset = document.querySelector('#reset-access');
  const existing = getAccessRecord();
  const isSetup = Boolean(existing);

  title.textContent = isSetup ? 'Bem-vindo de volta' : 'Proteja seu ambiente';
  description.textContent = isSetup ? 'Informe seu PIN para acessar o SO-boot.' : 'Crie um PIN para liberar este ambiente neste navegador.';
  submit.textContent = isSetup ? 'Entrar no ambiente' : 'Configurar acesso';
  pin.autocomplete = isSetup ? 'current-password' : 'new-password';
  confirmGroup.hidden = isSetup;
  confirm.required = !isSetup;
  reset.classList.toggle('hidden', !isSetup);
  form.reset();
  feedback.textContent = '';
  pin.focus();

  form.onsubmit = async (event) => {
    event.preventDefault();
    const value = pin.value.trim();
    if (!/^\d{4,12}$/.test(value)) {
      feedback.textContent = 'Use um PIN de 4 a 12 números.';
      feedback.className = 'access-feedback error';
      pin.focus();
      return;
    }
    submit.disabled = true;
    try {
      if (!isSetup) {
        if (value !== confirm.value.trim()) {
          feedback.textContent = 'Os PINs não conferem.';
          feedback.className = 'access-feedback error';
          confirm.focus();
          return;
        }
        const salt = crypto.randomUUID();
        const hash = await pinDigest(value, salt);
        localStorage.setItem(accessStorageKey, JSON.stringify({ salt, hash }));
      } else {
        const hash = await pinDigest(value, existing.salt);
        if (hash !== existing.hash) {
          feedback.textContent = 'PIN incorreto. Tente novamente.';
          feedback.className = 'access-feedback error';
          pin.select();
          return;
        }
      }
      sessionStorage.setItem(accessSessionKey, 'true');
      launchDesktop();
    } catch {
      feedback.textContent = 'Não foi possível validar o acesso neste navegador.';
      feedback.className = 'access-feedback error';
    } finally {
      submit.disabled = false;
    }
  };
  reset.onclick = () => {
    if (!window.confirm('Remover o PIN local deste navegador? O ambiente ficará sem proteção até você criar um novo PIN.')) return;
    localStorage.removeItem(accessStorageKey);
    sessionStorage.removeItem(accessSessionKey);
    setupAccess();
  };
}

function lockDesktop() {
  sessionStorage.removeItem(accessSessionKey);
  windowLayer.replaceChildren();
  desktop.classList.add('hidden');
  accessScreen.classList.remove('hidden');
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  setupAccess();
}

function updateGreeting() {
  const hour = new Date().getHours();
  const salutation = hour >= 5 && hour < 12
    ? 'Bom dia'
    : hour >= 12 && hour < 18
      ? 'Boa tarde'
      : 'Boa noite';

  greeting.textContent = `${salutation}, ${accountName}.`;
}

function terminalPrompt() {
  return `${accountName}@so-boot:~$`;
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
        // Continua procurando a instância compatível do SO-boot.
      }
    }
    return '';
  })();
  return apiServerReady;
}

async function apiFetch(path, options) {
  await resolveLocalServer();
  return fetch(localServerUrl(path), options);
}

async function loadAccountName() {
  try {
    const response = await apiFetch('/api/session', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || typeof data.accountName !== 'string' || !data.accountName.trim()) return;
    accountName = data.accountName.trim();
    updateGreeting();
    document.querySelectorAll('[data-terminal-account]').forEach((element) => {
      element.textContent = accountName;
    });
    document.querySelectorAll('[data-terminal-prompt]').forEach((element) => {
      element.textContent = terminalPrompt();
    });
  } catch {
    // O nome padrão mantém a interface funcional quando aberta sem o servidor local.
  }
}

function startBoot() {
  const stepDuration = 900;
  const finishBoot = () => {
    bootProgress.style.width = '100%';
    bootMessage.textContent = bootSteps.at(-1);
    window.setTimeout(launchAccess, 400);
  };

  bootProgress.style.width = '0%';
  bootMessage.textContent = bootSteps[0];
  bootSteps.slice(1, -1).forEach((message, index) => {
    window.setTimeout(() => {
      bootProgress.style.width = `${(index + 1) * 33}%`;
      bootMessage.textContent = message;
    }, stepDuration * (index + 1));
  });
  window.setTimeout(finishBoot, stepDuration * 3);
}

document.querySelector('#skip-boot').addEventListener('click', launchAccess);

function openWindow(name) {
  const existing = windowLayer.querySelector(`[data-window="${name}"]`);
  if (existing) {
    bringWindowToFront(existing);
    existing.querySelector('input, textarea, button')?.focus();
    return;
  }
  const template = document.querySelector(`#${name}-template`);
  const windowElement = template.content.firstElementChild.cloneNode(true);
  windowLayer.append(windowElement);
  setupWindowDragging(windowElement);
  windowElement.querySelector('.close-window').addEventListener('click', () => windowElement.remove());
  if (name === 'notes') setupNotes(windowElement);
  if (name === 'terminal') setupTerminal(windowElement);
  if (name === 'monitor') setupMonitor(windowElement);
  if (name === 'files') setupFiles(windowElement);
  if (name === 'wifi') setupWifi(windowElement);
  if (name === 'devices') setupDevices(windowElement);
}

function bringWindowToFront(windowElement) {
  windowElement.style.zIndex = String(++topWindowZIndex);
}

function setupWindowDragging(windowElement) {
  const header = windowElement.querySelector('header');
  let dragState = null;

  bringWindowToFront(windowElement);
  windowElement.addEventListener('pointerdown', () => bringWindowToFront(windowElement));
  header.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button') || window.matchMedia('(max-width: 570px)').matches) return;

    const bounds = windowElement.getBoundingClientRect();
    dragState = {
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
    };
    windowElement.style.left = `${bounds.left}px`;
    windowElement.style.top = `${bounds.top}px`;
    windowElement.style.transform = 'none';
    windowElement.classList.add('is-dragging');
    header.setPointerCapture(event.pointerId);
    bringWindowToFront(windowElement);
    event.preventDefault();
  });
  header.addEventListener('pointermove', (event) => {
    if (!dragState) return;
    const maxLeft = Math.max(8, window.innerWidth - windowElement.offsetWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - windowElement.offsetHeight - 8);
    const left = Math.min(Math.max(8, event.clientX - dragState.offsetX), maxLeft);
    const top = Math.min(Math.max(8, event.clientY - dragState.offsetY), maxTop);
    windowElement.style.left = `${left}px`;
    windowElement.style.top = `${top}px`;
  });
  const finishDrag = (event) => {
    if (!dragState) return;
    dragState = null;
    windowElement.classList.remove('is-dragging');
    if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
  };
  header.addEventListener('pointerup', finishDrag);
  header.addEventListener('pointercancel', finishDrag);
}

function setupDemoWifi(windowElement) {
  const list = windowElement.querySelector('#wifi-list');
  const panel = windowElement.querySelector('#wifi-connect-panel');
  const selectedName = windowElement.querySelector('#wifi-selected-name');
  const password = windowElement.querySelector('#wifi-password');
  const connectButton = windowElement.querySelector('#wifi-connect');
  const cancelButton = windowElement.querySelector('#wifi-cancel');
  const stateMessage = windowElement.querySelector('#wifi-state');
  let selectedNetwork = null;
  let connecting = false;

  const connectedNetwork = () => wifiNetworks.find((network) => network.id === getWifiState().connectedId);
  const updateDesktopNetwork = () => {
    const network = connectedNetwork();
    const value = document.querySelector('#network-value');
    if (value) value.textContent = network ? network.ssid : 'Desconectada';
  };
  const showMessage = (message, type = '') => {
    stateMessage.textContent = message;
    stateMessage.className = `wifi-state ${type}`.trim();
  };
  const render = () => {
    const current = connectedNetwork();
    list.replaceChildren();
    wifiNetworks.forEach((network) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `wifi-network${current?.id === network.id ? ' connected' : ''}`;
      row.innerHTML = `<span class="wifi-signal" aria-label="Sinal ${network.signal} de 4">${'▂▃▅▇'.slice(4 - network.signal)}</span><span class="wifi-network-info"><strong>${escapeHtml(network.ssid)}</strong><small>${network.security}${current?.id === network.id ? ' · Conectada' : ''}</small></span>${current?.id === network.id ? '<span class="wifi-check">✓</span>' : ''}`;
      row.addEventListener('click', () => {
        if (connecting) return;
        selectedNetwork = network;
        password.value = '';
        selectedName.textContent = network.ssid;
        panel.hidden = false;
        password.hidden = network.security === 'Aberta';
        password.required = network.security !== 'Aberta';
        connectButton.textContent = current?.id === network.id ? 'Reconectar' : 'Conectar';
        showMessage(network.security === 'Aberta' ? 'Esta é uma rede aberta.' : 'Informe a senha para conectar.');
        if (!password.hidden) password.focus();
      });
      list.append(row);
    });
    updateDesktopNetwork();
  };

  connectButton.addEventListener('click', () => {
    if (!selectedNetwork || connecting) return;
    if (selectedNetwork.security !== 'Aberta' && password.value.trim().length < 8) {
      showMessage('A senha precisa ter pelo menos 8 caracteres.', 'error');
      password.focus();
      return;
    }
    connecting = true;
    connectButton.disabled = true;
    connectButton.textContent = 'Conectando…';
    showMessage(`Conectando a ${selectedNetwork.ssid}…`);
    setTimeout(() => {
      saveWifiState({ connectedId: selectedNetwork.id });
      connecting = false;
      connectButton.disabled = false;
      panel.hidden = true;
      render();
      showMessage(`Conectada a ${selectedNetwork.ssid}.`, 'success');
    }, 700);
  });
  cancelButton.addEventListener('click', () => { panel.hidden = true; selectedNetwork = null; showMessage('Selecione uma rede para conectar.'); });
  windowElement.querySelector('#wifi-disconnect').addEventListener('click', () => {
    const current = connectedNetwork();
    if (!current) { showMessage('Nenhuma rede está conectada.'); return; }
    saveWifiState({ connectedId: null });
    panel.hidden = true;
    selectedNetwork = null;
    render();
    showMessage(`Desconectada de ${current.ssid}.`);
  });
  render();
  showMessage(connectedNetwork() ? `Conectada a ${connectedNetwork().ssid}.` : 'Selecione uma rede para conectar.');
}

function setupNotes(windowElement) {
  const textarea = windowElement.querySelector('#note-text');
  const saveState = windowElement.querySelector('#save-state');
  textarea.value = localStorage.getItem('so-boot-note') || '';
  textarea.addEventListener('input', () => { localStorage.setItem('so-boot-note', textarea.value); saveState.textContent = 'Salvo agora'; });
  windowElement.querySelector('#clear-note').addEventListener('click', () => { textarea.value = ''; localStorage.removeItem('so-boot-note'); saveState.textContent = 'Nota removida'; textarea.focus(); });
  textarea.focus();
}

async function executeRealTerminalCommand(command) {
  try {
    const response = await apiFetch('/api/terminal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    const data = await response.json();
    return escapeHtml(response.ok ? data.output || '(sem saída)' : data.error || 'Falha ao executar o comando.');
  } catch {
    return 'Servidor local indisponível. Inicie o SO-boot pelo atalho de administrador.';
  }
}

function setupTerminal(windowElement) {
  const form = windowElement.querySelector('#terminal-form');
  const input = windowElement.querySelector('#terminal-input');
  const output = windowElement.querySelector('#terminal-output');
  windowElement.querySelectorAll('[data-terminal-account]').forEach((element) => {
    element.textContent = accountName;
  });
  windowElement.querySelectorAll('[data-terminal-prompt]').forEach((element) => {
    element.textContent = terminalPrompt();
  });
  const commands = {
    help: 'Locais: <b>help</b>, <b>status</b>, <b>clear</b>, <b>date</b>, <b>ls</b>, <b>cat &lt;arquivo&gt;</b>, <b>touch &lt;arquivo&gt;</b><br>Windows: qualquer comando compatível com <b>cmd.exe</b>, por exemplo <b>whoami</b>, <b>ipconfig</b>, <b>dir</b> e <b>tasklist</b>.',
    status: 'Sistema operacional. Todos os serviços respondendo.',
    date: () => new Date().toLocaleString('pt-BR'),
    ls: () => getFiles().map((file) => `${file.type === 'DIR' ? '▣' : '▤'} ${escapeHtml(file.name)}`).join('&nbsp;&nbsp;') || 'Pasta vazia.',
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const rawCommand = input.value.trim();
    const [command, ...args] = rawCommand.split(/\s+/);
    const normalizedCommand = (command || '').toLowerCase();
    if (!normalizedCommand) return;
    output.insertAdjacentHTML('beforeend', `<p><span class="prompt">${escapeHtml(terminalPrompt())}</span> ${escapeHtml(rawCommand)}</p>`);
    let response;
    if (normalizedCommand === 'cat') {
      const file = getFiles().find((item) => item.name.toLowerCase() === args.join(' ').toLowerCase());
      response = !args.length ? 'uso: cat &lt;arquivo&gt;' : !file ? `arquivo não encontrado: ${escapeHtml(args.join(' '))}` : file.type === 'DIR' ? `${escapeHtml(file.name)} é uma pasta.` : escapeHtml(file.content || '(arquivo vazio)');
    } else if (normalizedCommand === 'touch') {
      const name = args.join(' ').trim();
      const files = getFiles();
      if (!name) response = 'uso: touch &lt;arquivo&gt;';
      else if (files.some((file) => file.name.toLowerCase() === name.toLowerCase())) response = `arquivo já existe: ${escapeHtml(name)}`;
      else { files.push({ id: crypto.randomUUID(), name, type: 'TXT', content: '', updatedAt: Date.now() }); saveFiles(files); response = `criado: ${escapeHtml(name)}`; }
    } else if (commands[normalizedCommand] === undefined) {
      input.disabled = true;
      response = await executeRealTerminalCommand(rawCommand);
      input.disabled = false;
    } else response = commands[normalizedCommand];
    if (normalizedCommand === 'clear') output.innerHTML = ''; else output.insertAdjacentHTML('beforeend', `<p>${typeof response === 'function' ? response() : response || `comando não encontrado: ${escapeHtml(normalizedCommand)}`}</p>`);
    input.value = '';
    output.scrollTop = output.scrollHeight;
  });
  input.focus();
}

function setupFiles(windowElement) {
  const list = windowElement.querySelector('#file-list');
  const summary = windowElement.querySelector('#files-summary');
  const title = windowElement.querySelector('#files-title');
  const newFileButton = windowElement.querySelector('#new-file');
  const homeButton = windowElement.querySelector('#files-home');
  const disksButton = windowElement.querySelector('#files-disks');
  const setActiveLocation = (activeButton) => {
    [homeButton, disksButton].forEach((button) => button.classList.toggle('active', button === activeButton));
  };
  const makeRow = ({ name, secondary, type, folder = false, onClick }) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'file-row';
    row.innerHTML = `<span class="file-symbol ${folder ? 'folder' : ''}">${folder ? '▣' : '▤'}</span><span class="file-name"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(secondary)}</small></span><span class="file-type">${escapeHtml(type)}</span>`;
    if (onClick) row.addEventListener('click', onClick);
    list.append(row);
  };
  const renderPersonalFiles = () => {
    setActiveLocation(homeButton);
    title.textContent = 'Meus arquivos';
    newFileButton.hidden = false;
    const files = getFiles().sort((left, right) => Number(right.type === 'DIR') - Number(left.type === 'DIR') || left.name.localeCompare(right.name, 'pt-BR'));
    summary.textContent = `${files.length} ${files.length === 1 ? 'item' : 'itens'} · sincronizado neste dispositivo`;
    list.replaceChildren();
    files.forEach((file) => {
      makeRow({ name: file.name, secondary: `${file.type === 'DIR' ? 'Pasta' : 'Arquivo de texto'} · ${new Date(file.updatedAt).toLocaleDateString('pt-BR')}`, type: file.type, folder: file.type === 'DIR', onClick: () => {
        if (file.type === 'DIR') return;
        const nextContent = prompt(`Editar ${file.name}`, file.content);
        if (nextContent === null) return;
        const updated = getFiles().map((item) => item.id === file.id ? { ...item, content: nextContent, updatedAt: Date.now() } : item);
        saveFiles(updated);
        renderPersonalFiles();
      }});
    });
  };
  const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes)) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), units.length - 1);
    return `${(bytes / (1024 ** index)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${units[index]}`;
  };
  const openDirectory = async (path) => {
    newFileButton.hidden = true;
    setActiveLocation(disksButton);
    title.textContent = path;
    summary.textContent = 'Lendo pasta local...';
    list.replaceChildren();
    try {
      const response = await apiFetch(`/api/directory?${new URLSearchParams({ path })}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível abrir a pasta.');
      title.textContent = data.path;
      summary.textContent = `${data.entries.length} ${data.entries.length === 1 ? 'item disponível' : 'itens disponíveis'}${data.truncated ? ' · lista limitada a 1000 itens' : ''}`;
      data.entries.forEach((entry) => {
        const secondary = entry.directory ? 'Pasta local' : `${formatBytes(entry.size)} · arquivo local`;
        makeRow({ name: entry.name, secondary, type: entry.directory ? 'DIR' : 'FILE', folder: entry.directory, onClick: entry.directory ? () => openDirectory(entry.path) : null });
      });
    } catch (error) {
      summary.textContent = error.message || 'Não foi possível acessar esta pasta.';
    }
  };
  const renderDisks = async () => {
    setActiveLocation(disksButton);
    title.textContent = 'Discos locais';
    newFileButton.hidden = true;
    summary.textContent = 'Consultando unidades do Windows...';
    list.replaceChildren();
    try {
      const response = await apiFetch('/api/disks', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível listar os discos.');
      const disks = Array.isArray(data.disks) ? data.disks : [];
      summary.textContent = disks.length ? `${disks.length} ${disks.length === 1 ? 'disco acessível' : 'discos acessíveis'} nesta sessão` : 'Nenhum disco local acessível nesta sessão.';
      disks.forEach((disk) => makeRow({ name: disk.name, secondary: `${formatBytes(disk.free)} livres de ${formatBytes(disk.total)}`, type: 'DISCO', folder: true, onClick: () => openDirectory(disk.path) }));
    } catch (error) {
      summary.textContent = error.message || 'Não foi possível listar os discos.';
    }
  };
  newFileButton.addEventListener('click', () => {
    const name = prompt('Nome do novo arquivo', 'Sem título.txt')?.trim();
    if (!name) return;
    const files = getFiles();
    if (files.some((file) => file.name.toLowerCase() === name.toLowerCase())) { alert('Já existe um item com este nome.'); return; }
    files.push({ id: crypto.randomUUID(), name, type: 'TXT', content: '', updatedAt: Date.now() });
    saveFiles(files);
    renderPersonalFiles();
  });
  homeButton.addEventListener('click', renderPersonalFiles);
  disksButton.addEventListener('click', renderDisks);
  renderPersonalFiles();
}

function setupMonitor(windowElement) {
  const chart = windowElement.querySelector('#chart');
  for (let i = 0; i < 20; i += 1) chart.insertAdjacentHTML('beforeend', '<i></i>');
  refreshMonitor(windowElement);
}

function setupDevices(windowElement) {
  const list = windowElement.querySelector('#devices-list');
  const summary = windowElement.querySelector('#devices-summary');
  const filter = windowElement.querySelector('#devices-filter');
  const refreshButton = windowElement.querySelector('#devices-refresh');
  let devices = [];

  const render = () => {
    const showIssues = filter.value === 'issues';
    const visibleDevices = showIssues ? devices.filter((device) => device.status === 'Requer atenção') : devices;
    list.replaceChildren();
    if (!visibleDevices.length) {
      list.textContent = showIssues ? 'Nenhum dispositivo requer atenção.' : 'Nenhum dispositivo foi retornado pelo Windows.';
      return;
    }
    visibleDevices.forEach((device) => {
      const row = document.createElement('article');
      const hasIssue = device.status === 'Requer atenção';
      row.className = `device-row${hasIssue ? ' has-issue' : ''}`;
      row.innerHTML = `<span class="device-symbol" aria-hidden="true">${hasIssue ? '!' : '✓'}</span><div class="device-info"><strong>${escapeHtml(device.name)}</strong><small>${escapeHtml(device.category)} · ${escapeHtml(device.manufacturer)}</small></div><span class="device-status">${hasIssue ? `Código ${device.errorCode}` : 'Operacional'}</span>`;
      list.append(row);
    });
  };
  const loadDevices = async () => {
    refreshButton.disabled = true;
    summary.textContent = 'Consultando dispositivos reais do Windows...';
    list.replaceChildren();
    try {
      const response = await apiFetch('/api/devices', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível consultar os dispositivos.');
      devices = Array.isArray(data.devices) ? data.devices : [];
      const issues = devices.filter((device) => device.status === 'Requer atenção').length;
      summary.textContent = `${devices.length} ${devices.length === 1 ? 'dispositivo encontrado' : 'dispositivos encontrados'}${issues ? ` · ${issues} requerem atenção` : ' · nenhum problema detectado'}`;
      render();
    } catch (error) {
      devices = [];
      summary.textContent = error.message || 'Inicie o servidor local do SO-boot para consultar os dispositivos.';
      list.textContent = 'Não foi possível carregar o gerenciador de dispositivos.';
    } finally {
      refreshButton.disabled = false;
    }
  };
  filter.addEventListener('change', render);
  refreshButton.addEventListener('click', loadDevices);
  loadDevices();
}

function refreshMonitor(windowElement = document) {
  const cpu = Math.floor(18 + Math.random() * 28);
  document.querySelector('#cpu-value').textContent = `${cpu}%`;
  document.querySelector('#cpu-bar').style.width = `${cpu}%`;
  const memory = (3.4 + Math.random() * .8).toFixed(1);
  document.querySelector('#memory-value').textContent = `${memory} GB`;
  document.querySelector('#memory-bar').style.width = `${Math.floor(memory / 8 * 100)}%`;
  windowElement.querySelector('#monitor-cpu')?.replaceChildren(`${cpu}% CPU`);
  windowElement.querySelectorAll('#chart i').forEach((bar) => { bar.style.height = `${20 + Math.random() * 80}%`; });
}

document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => openWindow(button.dataset.open)));
document.querySelector('#lock-desktop').addEventListener('click', lockDesktop);
function updateClock() {
  const now = new Date();
  const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  document.querySelector('#clock').textContent = time;
  document.querySelector('#dashboard-time').textContent = time;
  document.querySelector('#dashboard-date').textContent = now.toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}
updateClock();
updateGreeting();
loadAccountName();
document.querySelector('#network-value').textContent = 'Verificando...';
setInterval(updateClock, 1000);
setInterval(updateGreeting, 60000);
setInterval(refreshMonitor, 3200);

// Ao recarregar a página na mesma aba, mantém a sessão já autenticada e evita
// que as telas de inicialização e bloqueio fiquem sobre o desktop.
if (sessionStorage.getItem(accessSessionKey) === 'true' && getAccessRecord()) {
  launchDesktop();
} else {
  startBoot();
}

function setupWifi(windowElement) {
  const list = windowElement.querySelector('#wifi-list');
  const panel = windowElement.querySelector('#wifi-connect-panel');
  const selectedName = windowElement.querySelector('#wifi-selected-name');
  const password = windowElement.querySelector('#wifi-password');
  const connectButton = windowElement.querySelector('#wifi-connect');
  const cancelButton = windowElement.querySelector('#wifi-cancel');
  const stateMessage = windowElement.querySelector('#wifi-state');
  let networks = [];
  let connectedSsid = null;
  let selectedNetwork = null;
  let connecting = false;

  const showMessage = (message, type = '') => {
    stateMessage.textContent = message;
    stateMessage.className = `wifi-state ${type}`.trim();
  };
  const updateDesktopNetwork = () => {
    const value = document.querySelector('#network-value');
    if (value) value.textContent = connectedSsid || 'Desconectada';
  };
  const signalBars = (signal) => {
    const count = Math.max(1, Math.min(4, Math.ceil((signal || 0) / 25)));
    return '▂▃▅▇'.slice(4 - count);
  };
  const render = () => {
    list.replaceChildren();
    networks.forEach((network) => {
      const row = document.createElement('button');
      const connected = network.ssid === connectedSsid;
      row.type = 'button';
      row.className = `wifi-network${connected ? ' connected' : ''}`;
      row.innerHTML = `<span class="wifi-signal" aria-label="Sinal ${network.signal}%">${signalBars(network.signal)}</span><span class="wifi-network-info"><strong>${escapeHtml(network.ssid)}</strong><small>${escapeHtml(network.security)}${network.saved ? ' · Senha salva' : ''}${connected ? ' · Conectada' : ''}</small></span>${connected ? '<span class="wifi-check">✓</span>' : ''}`;
      row.addEventListener('click', () => {
        if (connecting) return;
        selectedNetwork = network;
        password.value = '';
        selectedName.textContent = network.ssid;
        panel.hidden = false;
        const canConnectWithoutPassword = network.security === 'Aberta' || network.saved === true;
        password.hidden = canConnectWithoutPassword;
        password.required = !canConnectWithoutPassword;
        connectButton.textContent = connected ? 'Reconectar' : 'Conectar';
        showMessage(network.security === 'Aberta' ? 'Esta é uma rede aberta.' : network.saved ? 'Senha salva pelo Windows. Conecte sem informá-la novamente.' : 'Informe a senha para conectar.');
        if (!password.hidden) password.focus();
      });
      list.append(row);
    });
    if (!networks.length) list.textContent = 'Nenhuma rede Wi-Fi visível no momento.';
    updateDesktopNetwork();
  };
  const loadNetworks = async (quiet = false) => {
    if (!quiet) showMessage('Consultando redes Wi-Fi reais do Windows...');
    try {
      const response = await apiFetch('/api/wifi', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível consultar as redes.');
      networks = Array.isArray(data.networks) ? data.networks : [];
      connectedSsid = typeof data.connectedSsid === 'string' ? data.connectedSsid : null;
      render();
      if (!quiet) showMessage(connectedSsid ? `Conectada a ${connectedSsid}.` : 'Selecione uma rede para conectar.');
    } catch (error) {
      networks = [];
      connectedSsid = null;
      render();
      showMessage(error.message || 'Inicie o servidor local do SO-boot para usar o Wi-Fi real.', 'error');
    }
  };

  connectButton.addEventListener('click', async () => {
    if (!selectedNetwork || connecting) return;
    if (selectedNetwork.security !== 'Aberta' && selectedNetwork.saved !== true && password.value.trim().length < 8) {
      showMessage('A senha precisa ter pelo menos 8 caracteres.', 'error');
      password.focus();
      return;
    }
    connecting = true;
    connectButton.disabled = true;
    connectButton.textContent = 'Conectando...';
    showMessage(`Solicitando conexão a ${selectedNetwork.ssid} no Windows...`);
    try {
      const response = await apiFetch('/api/wifi/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssid: selectedNetwork.ssid, password: password.hidden ? null : password.value }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || data.message || 'Não foi possível conectar.');
      panel.hidden = true;
      selectedNetwork = null;
      showMessage(`${data.message} Confirmando estado...`);
      setTimeout(() => loadNetworks(true), 1300);
    } catch (error) {
      showMessage(error.message || 'Não foi possível conectar a esta rede.', 'error');
    } finally {
      connecting = false;
      connectButton.disabled = false;
      connectButton.textContent = 'Conectar';
    }
  });
  cancelButton.addEventListener('click', () => {
    panel.hidden = true;
    selectedNetwork = null;
    showMessage('Selecione uma rede para conectar.');
  });
  windowElement.querySelector('#wifi-disconnect').addEventListener('click', async () => {
    if (!connectedSsid || connecting) {
      showMessage('Nenhuma rede Wi-Fi está conectada.');
      return;
    }
    connecting = true;
    showMessage('Solicitando desconexão ao Windows...');
    try {
      const response = await apiFetch('/api/wifi/disconnect', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || data.message || 'Não foi possível desconectar.');
      setTimeout(() => loadNetworks(false), 900);
    } catch (error) {
      showMessage(error.message || 'Não foi possível desconectar.', 'error');
    } finally {
      connecting = false;
    }
  });
  loadNetworks();
}
