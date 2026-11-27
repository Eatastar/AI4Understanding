const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('learnSomething', {
  captureEbookSelection: rect => ipcRenderer.invoke('learn:capture-ebook-selection', rect),
  setLocale: locale => { if (['zh-CN', 'en', 'es', 'ja', 'zh-TW', 'de', 'ar', 'fr'].includes(locale)) ipcRenderer.send('learn:locale', locale); },
  setTheme: theme => ipcRenderer.send('learn:theme', theme),
  knowledge: {
    list: () => ipcRenderer.invoke('learn:knowledge-list'),
    save: draft => ipcRenderer.invoke('learn:knowledge-save', draft),
    remove: id => ipcRenderer.invoke('learn:knowledge-remove', id),
    importCards: raw => ipcRenderer.invoke('learn:knowledge-importCards', raw),
  },
  wiki: {
    list: () => ipcRenderer.invoke('learn:wiki-list'),
    save: draft => ipcRenderer.invoke('learn:wiki-save', draft),
    history: id => ipcRenderer.invoke('learn:wiki-history', id),
    revision: key => ipcRenderer.invoke('learn:wiki-revision', key),
    restore: key => ipcRenderer.invoke('learn:wiki-restore', key),
  },
  onPrepareClose(handler, onCancel) {
    const listener = async (_event, id) => {
      try { await handler(); ipcRenderer.send('learn:close-result', { id, ok: true }); }
      catch { ipcRenderer.send('learn:close-result', { id, ok: false }); }
    };
    ipcRenderer.on('learn:prepare-close', listener);
    const cancelListener = () => onCancel();
    ipcRenderer.on('learn:cancel-close', cancelListener);
    ipcRenderer.send('learn:ready');
    return () => { ipcRenderer.removeListener('learn:prepare-close', listener); ipcRenderer.removeListener('learn:cancel-close', cancelListener); ipcRenderer.send('learn:not-ready'); };
  },
  backups: {
    list: () => ipcRenderer.invoke('learn:backups-list'),
    read: id => ipcRenderer.invoke('learn:backups-read', id),
    write: text => ipcRenderer.invoke('learn:backups-write', text),
    baseline: text => ipcRenderer.invoke('learn:backups-baseline', text),
    remove: id => ipcRenderer.invoke('learn:backups-remove', id),
    begin: input => ipcRenderer.invoke('learn:backups-begin', input),
    append: input => ipcRenderer.invoke('learn:backups-append', input),
    finish: id => ipcRenderer.invoke('learn:backups-finish', id),
    abort: id => ipcRenderer.invoke('learn:backups-abort', id),
    upgradeNeeded: () => ipcRenderer.invoke('learn:backups-upgradeNeeded'),
  },
});
