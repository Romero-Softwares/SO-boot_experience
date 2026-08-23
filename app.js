import { dom, getAccessRecord, loadAccountName, refreshMonitor, storageKeys, updateClock, updateGreeting } from './js/core.js';
import { launchAccess, launchDesktop, lockDesktop, startBoot } from './js/access.js';
import { setupFiles } from './js/apps/files.js';
import { setupNotes, setupTerminal } from './js/apps/notes-terminal.js';
import { setupDevices, setupMonitor, setupSystem, setupWifi } from './js/apps/system.js';

let topWindowZIndex = 10;

const windowSetups = {
  notes: setupNotes,
  terminal: setupTerminal,
  monitor: setupMonitor,
  files: setupFiles,
  wifi: setupWifi,
  devices: setupDevices,
  system: setupSystem,
};

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
    const layerBounds = dom.windowLayer.getBoundingClientRect();
    dragState = { offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top };
    windowElement.style.left = `${bounds.left - layerBounds.left}px`;
    windowElement.style.top = `${bounds.top - layerBounds.top}px`;
    windowElement.style.transform = 'none';
    windowElement.classList.add('is-dragging');
    header.setPointerCapture(event.pointerId);
    bringWindowToFront(windowElement);
    event.preventDefault();
  });
  header.addEventListener('pointermove', (event) => {
    if (!dragState) return;
    const layerBounds = dom.windowLayer.getBoundingClientRect();
    const maxLeft = Math.max(0, layerBounds.width - windowElement.offsetWidth);
    const maxTop = Math.max(0, layerBounds.height - windowElement.offsetHeight);
    const left = event.clientX - layerBounds.left - dragState.offsetX;
    const top = event.clientY - layerBounds.top - dragState.offsetY;
    windowElement.style.left = `${Math.min(Math.max(0, left), maxLeft)}px`;
    windowElement.style.top = `${Math.min(Math.max(0, top), maxTop)}px`;
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

function openWindow(name) {
  const existing = dom.windowLayer.querySelector(`[data-window="${name}"]`);
  if (existing) {
    bringWindowToFront(existing);
    existing.querySelector('input, textarea, button')?.focus();
    return;
  }
  const template = document.querySelector(`#${name}-template`);
  const setup = windowSetups[name];
  if (!template || !setup) return;
  const windowElement = template.content.firstElementChild.cloneNode(true);
  dom.windowLayer.append(windowElement);
  setupWindowDragging(windowElement);
  windowElement.querySelector('.close-window').addEventListener('click', () => windowElement.remove());
  setup(windowElement);
}

document.querySelector('#skip-boot').addEventListener('click', launchAccess);
document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => openWindow(button.dataset.open)));
document.querySelector('#lock-desktop').addEventListener('click', lockDesktop);
updateClock();
updateGreeting();
loadAccountName();
document.querySelector('#network-value').textContent = 'Verificando...';
setInterval(updateClock, 1000);
setInterval(updateGreeting, 60000);
setInterval(refreshMonitor, 3200);

if (sessionStorage.getItem(storageKeys.accessSession) === 'true' && getAccessRecord()) {
  launchDesktop();
} else {
  startBoot();
}
