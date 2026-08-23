import { apiFetch, escapeHtml, getFiles, refreshMonitor, saveFiles, storageKeys } from '../core.js';

export function setupMonitor(windowElement) {
  const chart = windowElement.querySelector('#chart');
  for (let index = 0; index < 20; index += 1) chart.insertAdjacentHTML('beforeend', '<i></i>');
  refreshMonitor(windowElement);
}

export function setupDevices(windowElement) {
  const list = windowElement.querySelector('#devices-list');
  const summary = windowElement.querySelector('#devices-summary');
  const filter = windowElement.querySelector('#devices-filter');
  const refreshButton = windowElement.querySelector('#devices-refresh');
  let devices = [];
  const render = () => {
    const visibleDevices = filter.value === 'issues' ? devices.filter((device) => device.status === 'Requer atenção') : devices;
    list.replaceChildren();
    if (!visibleDevices.length) {
      list.textContent = filter.value === 'issues' ? 'Nenhum dispositivo requer atenção.' : 'Nenhum dispositivo foi retornado pelo Windows.';
      return;
    }
    visibleDevices.forEach((device) => {
      const hasIssue = device.status === 'Requer atenção';
      const row = document.createElement('article');
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

export function setupWifi(windowElement) {
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
  const signalBars = (signal) => '▂▃▅▇'.slice(4 - Math.max(1, Math.min(4, Math.ceil((signal || 0) / 25))));
  const render = () => {
    list.replaceChildren();
    networks.forEach((network) => {
      const connected = network.ssid === connectedSsid;
      const row = document.createElement('button');
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
      const response = await apiFetch('/api/wifi/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ssid: selectedNetwork.ssid, password: password.hidden ? null : password.value }) });
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

function localData() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    files: getFiles(),
    note: localStorage.getItem(storageKeys.note) || '',
  };
}

export function setupSystem(windowElement) {
  const state = windowElement.querySelector('#system-state');
  const count = windowElement.querySelector('#system-file-count');
  const backup = windowElement.querySelector('#system-backup');
  const restore = windowElement.querySelector('#system-restore');
  const restoreInput = windowElement.querySelector('#system-restore-input');
  const clear = windowElement.querySelector('#system-clear');
  const updateSummary = (message = 'Dados locais prontos para uso.') => {
    const files = getFiles();
    count.textContent = `${files.length} ${files.length === 1 ? 'item local' : 'itens locais'}`;
    state.textContent = message;
  };
  backup.addEventListener('click', () => {
    const file = new Blob([JSON.stringify(localData(), null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = `so-boot-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
    updateSummary('Backup baixado. Guarde o arquivo em um local seguro.');
  });
  restore.addEventListener('click', () => restoreInput.click());
  restoreInput.addEventListener('change', async () => {
    const [file] = restoreInput.files;
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.files) || !data.files.every((item) => item && typeof item.name === 'string' && typeof item.type === 'string')) throw new Error();
      saveFiles(data.files);
      if (typeof data.note === 'string') localStorage.setItem(storageKeys.note, data.note);
      else localStorage.removeItem(storageKeys.note);
      updateSummary('Backup restaurado neste navegador.');
    } catch {
      updateSummary('Arquivo inválido: escolha um backup do SO-boot.');
    } finally {
      restoreInput.value = '';
    }
  });
  clear.addEventListener('click', () => {
    if (!window.confirm('Remover notas e arquivos locais deste navegador? Esta ação não pode ser desfeita sem um backup.')) return;
    localStorage.removeItem(storageKeys.files);
    localStorage.removeItem(storageKeys.note);
    updateSummary('Dados locais removidos. Um novo conjunto padrão será criado quando necessário.');
  });
  updateSummary();
}
