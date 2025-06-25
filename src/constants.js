import { join, resolve } from 'path';
import { app } from 'electron';

const PATH_TO_SOCKET = '/tmp/nvim.sock';

function getPreloadPath() {
  const preloadAbsPath = join(app.getAppPath(), 'src', 'preload.mjs');
  return resolve(preloadAbsPath);
}

const NVIM_UI_OPTIONS = {
  rgb: false,
  override: false,
  ext_cmdline: false,
  ext_hlstate: true,
  ext_linegrid: true,
  ext_messages: false,
  ext_multigrid: false,
  ext_popupmenu: false,
  ext_tabline: false,
  ext_termcolors: false
};

function getBrowserWindowSettings() {
  let preloadPath = getPreloadPath();
  return {
    backgroundColor: '#fff',
    width: 1000,
    height: 1200,
    webPreferences: {
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: true,
      preload: preloadPath,
      enablePreferredSizeMode: true,
    }
  };
}

export {
  PATH_TO_SOCKET,
  NVIM_UI_OPTIONS,
  getBrowserWindowSettings,
};
