import { contextBridge, ipcRenderer } from 'electron';
import os from 'os';
import stringWidth from 'string-width';

contextBridge.exposeInMainWorld('Electron', {
  getHomeDir: () => {
    return os.homedir();
  },
  onRedrawEvent: (callback) => {
    ipcRenderer.on('redraw-event', (_event, args) => callback(args));
  },
  onGuifont: (callback) => {
    ipcRenderer.on('set-guifont', (_event, args) => callback(args));
  },

  onGlobalVariables : (callback) => {
    ipcRenderer.on('set-global-variables', (_event, args) => callback(args));
  },
  sendResize: (cols, rows) => {
    ipcRenderer.send('resize-request', { cols, rows });
  },
  sendFontMetrics: (metrics) => {
    ipcRenderer.send('font-metrics', metrics);
  },
  onGridSize: (callback) => {
    ipcRenderer.on('grid-size', (_event, args) => callback(args));
  },
  sendKeyEvent: (event) => {
    ipcRenderer.send('key-event', event);
  },
  sendMouseEvent: (event) => {
    ipcRenderer.send('mouse-event', event);
  },
  stringWidth: (str) => {
    return stringWidth(str);
  },
  readDir: (path) => ipcRenderer.invoke('read-dir', path),
  openFile: (path) => ipcRenderer.send('open-file', path),
});
