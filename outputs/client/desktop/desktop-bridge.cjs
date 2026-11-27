const { randomUUID } = require('node:crypto');

function installDesktopBridge({ ipcMain, window, isLocalPage, backupStore, knowledgeStore, wikiStore, timeoutMs = 15000, onLocale = () => {}, onTheme = () => {} }) {
  let ready = false;
  let pending;
  let capturing = false;
  const trusted = event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && isLocalPage(event.senderFrame?.url || '');
  const onReady = event => { if (trusted(event)) ready = true; };
  const onNotReady = event => { if (trusted(event)) ready = false; };
  const onLanguage = (event, locale) => { if (trusted(event) && ['zh-CN', 'en', 'es', 'ja', 'zh-TW', 'de', 'ar', 'fr'].includes(locale)) onLocale(locale); };
  const onAppearance = (event, theme) => {
    if (!trusted(event) || !theme || !['dark', 'light'].includes(theme.scheme) || typeof theme.paper !== 'string' || !/^#[a-f0-9]{6}$/iu.test(theme.paper)) return;
    onTheme({ paper: theme.paper, scheme: theme.scheme });
  };
  const onResult = (event, result) => {
    if (!trusted(event) || !pending || result?.id !== pending.id) return;
    clearTimeout(pending.timer);
    const resolve = pending.resolve;
    pending = undefined;
    resolve(result.ok === true);
  };
  ipcMain.on('learn:ready', onReady);
  ipcMain.on('learn:not-ready', onNotReady);
  ipcMain.on('learn:close-result', onResult);
  ipcMain.on('learn:locale', onLanguage);
  ipcMain.on('learn:theme', onAppearance);
  const backupActions = ['list', 'read', 'write', 'baseline', 'remove', 'begin', 'append', 'finish', 'abort', 'upgradeNeeded'];
  for (const action of backupActions) ipcMain.handle(`learn:backups-${action}`, (event, value) => {
    if (!trusted(event)) throw new Error('此页面无法访问本机备份。');
    return backupStore[action](value);
  });
  const knowledgeActions = knowledgeStore ? ['list', 'save', 'remove', 'importCards'] : [];
  for (const action of knowledgeActions) ipcMain.handle(`learn:knowledge-${action}`, (event, value) => {
    if (!trusted(event)) throw new Error('此页面无法访问本机知识库。');
    return knowledgeStore[action](value);
  });
  const wikiActions = wikiStore ? ['list', 'save', 'history', 'revision', 'restore'] : [];
  for (const action of wikiActions) ipcMain.handle(`learn:wiki-${action}`, (event, value) => {
    if (!trusted(event)) throw new Error('此页面无法访问个人知识库。');
    return wikiStore[action](value);
  });
  ipcMain.handle('learn:capture-ebook-selection', async (event, rect) => {
    if (!trusted(event) || capturing || !rect || !['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(rect[key]))) throw new Error('无法截取电子书选区。');
    const [width, height] = window.getContentSize();
    const zoom = window.webContents.getZoomFactor();
    const x = Math.floor(rect.x * zoom), y = Math.floor(rect.y * zoom);
    const right = Math.ceil((rect.x + rect.width) * zoom), bottom = Math.ceil((rect.y + rect.height) * zoom);
    if (x < 0 || y < 0 || right > width || bottom > height || right - x < 12 || bottom - y < 12) throw new Error('无法截取电子书选区。');
    capturing = true;
    try {
      let image = await window.webContents.capturePage({ x, y, width: right - x, height: bottom - y }, { stayHidden: true });
      if (image.isEmpty()) throw new Error('无法截取电子书选区。');
      const size = image.getSize();
      const scale = Math.min(1, 1800 / Math.max(size.width, size.height), Math.sqrt(2_000_000 / (size.width * size.height)));
      if (scale < 1) image = image.resize({ width: Math.max(1, Math.floor(size.width * scale)), height: Math.max(1, Math.floor(size.height * scale)), quality: 'best' });
      for (let attempt = 0; attempt < 4; attempt++) {
        const png = image.toPNG({ scaleFactor: 1 });
        if (png.length && png.length <= 1024 * 1024) return 'data:image/png;base64,' + png.toString('base64');
        const next = image.getSize();
        image = image.resize({ width: Math.max(1, Math.floor(next.width * .72)), height: Math.max(1, Math.floor(next.height * .72)), quality: 'best' });
      }
      throw new Error('压缩后图片仍超过 1 MB，请框选更小的区域以保持文字清晰。');
    } finally { capturing = false; }
  });
  return {
    waitForSave() {
      if (!ready) return Promise.resolve(false);
      if (pending) return pending.promise;
      const id = randomUUID();
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      const timer = setTimeout(() => { if (pending?.id === id) { pending = undefined; resolve(false); } }, timeoutMs);
      pending = { id, promise, resolve, timer };
      window.webContents.send('learn:prepare-close', id);
      return promise;
    },
    dispose() {
      if (pending) { clearTimeout(pending.timer); pending.resolve(false); pending = undefined; }
      ipcMain.removeListener('learn:ready', onReady); ipcMain.removeListener('learn:not-ready', onNotReady); ipcMain.removeListener('learn:close-result', onResult);
      ipcMain.removeListener('learn:locale', onLanguage);
      ipcMain.removeListener('learn:theme', onAppearance);
      for (const action of backupActions) ipcMain.removeHandler(`learn:backups-${action}`);
      for (const action of knowledgeActions) ipcMain.removeHandler(`learn:knowledge-${action}`);
      for (const action of wikiActions) ipcMain.removeHandler(`learn:wiki-${action}`);
      ipcMain.removeHandler('learn:capture-ebook-selection');
      void backupStore.abort?.();
    },
  };
}

/** One exit attempt at a time. Never tears down the server before renderer saves. */
function createCloseGuard({ save, shutdown, quit, choose }) {
  let running;
  let approved = false;
  return {
    get approved() { return approved; },
    request() {
      if (running) return running;
      const attempt = async () => {
        while (true) {
          const saved = await save().catch(() => false);
          if (!saved) {
            const choice = await choose();
            if (choice === 'retry') continue;
            if (choice !== 'leave') return;
          }
          await shutdown(); approved = true; quit(); return;
        }
      };
      running = attempt().finally(() => { running = undefined; });
      return running;
    },
  };
}
module.exports = { installDesktopBridge, createCloseGuard };
