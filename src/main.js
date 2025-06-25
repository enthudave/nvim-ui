import { app } from 'electron';
import NvimRPC from './nvim-rpc.js';
import fixPath from 'fix-path';
import os from 'os';

fixPath();
process.chdir(os.homedir());
let shouldQuit = false;

// Set NODE_ENV manually depending on build
// process.env.NODE_ENV = 'production';
process.env.NODE_ENV = 'development';

// Set args manually depending on build
// const args = process.argv.slice(1); // For packaged
const args = process.argv.slice(2); // For development

process.on('unhandledRejection', (reason) => {
  console.error('[Default] unhandledRejection:', reason);
});
let instances = {};

function newInstance() {
  const nrOfKeys = Object.keys(instances).length;
  const newInstanceId = 'nvim' + String(nrOfKeys + 1);
  instances[newInstanceId] = new NvimRPC({
    args
  });

  //console.log('initial instances: ', Object.keys(instances).length);

  instances[newInstanceId].on('new-window', () => {
    newInstance();
  });

  instances[newInstanceId].on('quit-ui', async () => {
    //console.log('Quit UI');
    for (const id in instances) {
      if (instances[id]) {
        instances[id].command('quit');
      }
    }
    //console.log('All instances quit, exiting app');
    shouldQuit = true;
  });

  instances[newInstanceId].on('close', () => {
    delete instances[newInstanceId];
    //console.log('instance deleted');
  });
}


function start() {

  newInstance();

  app.on('window-all-closed', () => {
    // TODO: make this customizable for the user
    if (process.platform !== 'darwin') {
      app.quit();
    } else {
      if (shouldQuit) {
        app.quit();
      }
    }
  });

  app.on('activate', () => {
    //console.log('activate');
    if (Object.keys(instances).length === 0) {
      //console.log('No instances, creating new one');
      newInstance();
    }
  });

};

app.whenReady().then(() => {
  start();
});
