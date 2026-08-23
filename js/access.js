import { dom, getAccessRecord, storageKeys } from './core.js';

const bootSteps = ['Verificando componentes essenciais...', 'Montando armazenamento local...', 'Iniciando interface do operador...', 'Ambiente pronto.'];

export function launchAccess() {
  dom.bootScreen.classList.add('hidden');
  dom.accessScreen.classList.remove('hidden');
  dom.desktop.classList.add('hidden');
  setupAccess();
}

export function launchDesktop() {
  dom.bootScreen.classList.add('hidden');
  dom.accessScreen.classList.add('hidden');
  dom.desktop.classList.remove('hidden');
}

async function pinDigest(pin, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export function setupAccess() {
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
        localStorage.setItem(storageKeys.access, JSON.stringify({ salt, hash: await pinDigest(value, salt) }));
      } else if (await pinDigest(value, existing.salt) !== existing.hash) {
        feedback.textContent = 'PIN incorreto. Tente novamente.';
        feedback.className = 'access-feedback error';
        pin.select();
        return;
      }
      sessionStorage.setItem(storageKeys.accessSession, 'true');
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
    localStorage.removeItem(storageKeys.access);
    sessionStorage.removeItem(storageKeys.accessSession);
    setupAccess();
  };
}

export function lockDesktop() {
  sessionStorage.removeItem(storageKeys.accessSession);
  dom.windowLayer.replaceChildren();
  dom.desktop.classList.add('hidden');
  dom.accessScreen.classList.remove('hidden');
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  setupAccess();
}

export function startBoot() {
  const stepDuration = 900;
  dom.bootProgress.style.width = '0%';
  dom.bootMessage.textContent = bootSteps[0];
  bootSteps.slice(1, -1).forEach((message, index) => {
    window.setTimeout(() => {
      dom.bootProgress.style.width = `${(index + 1) * 33}%`;
      dom.bootMessage.textContent = message;
    }, stepDuration * (index + 1));
  });
  window.setTimeout(() => {
    dom.bootProgress.style.width = '100%';
    dom.bootMessage.textContent = bootSteps.at(-1);
    window.setTimeout(launchAccess, 400);
  }, stepDuration * 3);
}
