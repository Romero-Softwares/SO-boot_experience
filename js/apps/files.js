import { apiFetch, escapeHtml, getFiles, saveFiles } from '../core.js';

export function setupFiles(windowElement) {
  const list = windowElement.querySelector('#file-list');
  const summary = windowElement.querySelector('#files-summary');
  const title = windowElement.querySelector('#files-title');
  const newFileButton = windowElement.querySelector('#new-file');
  const homeButton = windowElement.querySelector('#files-home');
  const disksButton = windowElement.querySelector('#files-disks');
  const setActiveLocation = (activeButton) => [homeButton, disksButton].forEach((button) => button.classList.toggle('active', button === activeButton));
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
    files.forEach((file) => makeRow({
      name: file.name,
      secondary: `${file.type === 'DIR' ? 'Pasta' : 'Arquivo de texto'} · ${new Date(file.updatedAt).toLocaleDateString('pt-BR')}`,
      type: file.type,
      folder: file.type === 'DIR',
      onClick: () => {
        if (file.type === 'DIR') return;
        const nextContent = prompt(`Editar ${file.name}`, file.content);
        if (nextContent === null) return;
        saveFiles(getFiles().map((item) => item.id === file.id ? { ...item, content: nextContent, updatedAt: Date.now() } : item));
        renderPersonalFiles();
      },
    }));
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
      data.entries.forEach((entry) => makeRow({ name: entry.name, secondary: entry.directory ? 'Pasta local' : `${formatBytes(entry.size)} · arquivo local`, type: entry.directory ? 'DIR' : 'FILE', folder: entry.directory, onClick: entry.directory ? () => openDirectory(entry.path) : null }));
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
    if (files.some((file) => file.name.toLowerCase() === name.toLowerCase())) {
      alert('Já existe um item com este nome.');
      return;
    }
    files.push({ id: crypto.randomUUID(), name, type: 'TXT', content: '', updatedAt: Date.now() });
    saveFiles(files);
    renderPersonalFiles();
  });
  homeButton.addEventListener('click', renderPersonalFiles);
  disksButton.addEventListener('click', renderDisks);
  renderPersonalFiles();
}
