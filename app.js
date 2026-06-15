import { Nostalgist } from 'https://cdn.jsdelivr.net/npm/nostalgist@0.21.1/+esm';

const DB_NAME = 'pacman-pwa-db';
const DB_VERSION = 1;
const STORE = 'files';
const ROM_KEY = 'pacman-rom';
const SAVE_KEY = 'pacman-save-state';

const $ = (id) => document.getElementById(id);
const setup = $('setup');
const romInput = $('rom-input');
const importRomButton = $('import-rom');
const startOverlay = $('start-overlay');
const toast = $('toast');
const menu = $('menu');
const saveInput = $('save-input');

let db;
let nostalgist;
let currentDirection = null;
let started = false;
let saving = false;
let lastTouch = null;
let menuPressTimer = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function put(key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function get(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function del(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function showToast(message, ms = 1500) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), ms);
}

async function saveState() {
  if (!nostalgist || saving) return;
  try {
    saving = true;
    const result = await nostalgist.saveState();
    if (result?.state) await put(SAVE_KEY, result.state);
  } catch (e) {
    console.warn('Save failed', e);
  } finally {
    saving = false;
  }
}

async function launchGame() {
  const rom = await get(ROM_KEY);
  if (!rom) {
    setup.classList.remove('hidden');
    return;
  }

  setup.classList.add('hidden');
  startOverlay.classList.remove('hidden');
  showToast('Loading…', 1000);

  const savedState = await get(SAVE_KEY);

  nostalgist = await Nostalgist.launch({
    element: '#game-canvas',
    core: 'fceumm',
    rom,
    state: savedState || undefined,
    size: 'auto',
    style: {
      backgroundColor: 'black',
      height: '100%',
      left: '0',
      position: 'fixed',
      top: '0',
      width: '100%',
      zIndex: '1'
    },
    retroarchConfig: {
      input_overlay_enable: false,
      menu_show_core_updater: false,
      savestate_thumbnail_enable: false,
      video_smooth: false
    }
  });

  started = true;
  showToast(savedState ? 'Save loaded' : 'Ready');
  setInterval(saveState, 15000);
}

async function holdDirection(direction) {
  if (!nostalgist || !direction) return;
  try {
    if (currentDirection && currentDirection !== direction) {
      await nostalgist.pressUp(currentDirection);
    }
    currentDirection = direction;
    await nostalgist.pressDown(direction);
  } catch (e) {
    console.warn('Input failed', e);
  }
}

function directionFromSwipe(dx, dy) {
  if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

async function handleTap() {
  if (!nostalgist) return;
  startOverlay.classList.add('hidden');
  await nostalgist.press({ button: 'start', time: 160 });
  saveState();
}

function setupTouchControls() {
  document.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    lastTouch = { x: t.clientX, y: t.clientY, time: Date.now() };
  }, { passive: false });

  document.addEventListener('touchend', async (e) => {
    if (!lastTouch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - lastTouch.x;
    const dy = t.clientY - lastTouch.y;
    const direction = directionFromSwipe(dx, dy);
    if (direction) {
      e.preventDefault();
      startOverlay.classList.add('hidden');
      await holdDirection(direction);
    } else if (Date.now() - lastTouch.time < 420) {
      await handleTap();
    }
    lastTouch = null;
  }, { passive: false });
}

function setupHiddenMenu() {
  const zone = $('hidden-menu-zone');
  const openMenu = () => menu.classList.remove('hidden');
  const cancel = () => clearTimeout(menuPressTimer);
  zone.addEventListener('touchstart', () => { menuPressTimer = setTimeout(openMenu, 1800); });
  zone.addEventListener('touchend', cancel);
  zone.addEventListener('touchcancel', cancel);

  $('close-menu').addEventListener('click', () => menu.classList.add('hidden'));
  $('save-now').addEventListener('click', async () => { await saveState(); showToast('Saved'); });
  $('replace-rom').addEventListener('click', () => romInput.click());
  $('delete-data').addEventListener('click', async () => {
    if (!confirm('Delete the stored ROM and save state?')) return;
    await del(ROM_KEY);
    await del(SAVE_KEY);
    location.reload();
  });
  $('export-save').addEventListener('click', async () => {
    await saveState();
    const state = await get(SAVE_KEY);
    if (!state) return showToast('No save yet');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(state);
    a.download = 'pacman-save.state';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  });
  $('import-save').addEventListener('click', () => saveInput.click());
  saveInput.addEventListener('change', async () => {
    const file = saveInput.files?.[0];
    if (!file) return;
    await put(SAVE_KEY, file);
    showToast('Save imported');
    setTimeout(() => location.reload(), 700);
  });
}

importRomButton.addEventListener('click', () => romInput.click());
romInput.addEventListener('change', async () => {
  const file = romInput.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.nes')) {
    showToast('Choose a .nes file', 2200);
    return;
  }
  await put(ROM_KEY, new File([file], file.name, { type: 'application/octet-stream' }));
  await del(SAVE_KEY);
  showToast('ROM stored');
  setTimeout(() => location.reload(), 500);
});

startOverlay.addEventListener('click', handleTap);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveState();
});
window.addEventListener('pagehide', saveState);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

(async function init() {
  try {
    db = await openDb();
    setupTouchControls();
    setupHiddenMenu();
    await launchGame();
  } catch (e) {
    console.error(e);
    setup.classList.remove('hidden');
    $('setup-text').textContent = 'Something failed to load. Check that the site is online and try importing the ROM again.';
  }
})();
