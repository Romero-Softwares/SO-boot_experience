import { apiFetch, escapeHtml, getFiles, saveFiles, storageKeys, terminalPrompt } from '../core.js';

export function setupNotes(windowElement) {
  const textarea = windowElement.querySelector('#note-text');
  const saveState = windowElement.querySelector('#save-state');
  textarea.value = localStorage.getItem(storageKeys.note) || '';
  textarea.addEventListener('input', () => {
    localStorage.setItem(storageKeys.note, textarea.value);
    saveState.textContent = 'Salvo agora';
  });
  windowElement.querySelector('#clear-note').addEventListener('click', () => {
    textarea.value = '';
    localStorage.removeItem(storageKeys.note);
    saveState.textContent = 'Nota removida';
    textarea.focus();
  });
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

export function setupTerminal(windowElement) {
  const form = windowElement.querySelector('#terminal-form');
  const input = windowElement.querySelector('#terminal-input');
  const output = windowElement.querySelector('#terminal-output');
  windowElement.querySelectorAll('[data-terminal-account]').forEach((element) => { element.textContent = terminalPrompt().split('@')[0]; });
  windowElement.querySelectorAll('[data-terminal-prompt]').forEach((element) => { element.textContent = terminalPrompt(); });
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
      else {
        files.push({ id: crypto.randomUUID(), name, type: 'TXT', content: '', updatedAt: Date.now() });
        saveFiles(files);
        response = `criado: ${escapeHtml(name)}`;
      }
    } else if (commands[normalizedCommand] === undefined) {
      input.disabled = true;
      response = await executeRealTerminalCommand(rawCommand);
      input.disabled = false;
    } else {
      response = commands[normalizedCommand];
    }
    if (normalizedCommand === 'clear') output.innerHTML = '';
    else output.insertAdjacentHTML('beforeend', `<p>${typeof response === 'function' ? response() : response || `comando não encontrado: ${escapeHtml(normalizedCommand)}`}</p>`);
    input.value = '';
    output.scrollTop = output.scrollHeight;
  });
  input.focus();
}
