import { createConnection } from 'net';
import { createDecodeStream, encode } from 'msgpack-lite';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { NVIM_UI_OPTIONS, getBrowserWindowSettings } from './constants.js';
import { translateKey } from './main-utils.js';
import path from 'path';

// NvimRPC class facilitates communication between an Electron application and Neovim
// using a message-passing protocol over a socket connection.
class NvimRPC extends EventEmitter {
  constructor({ args = [] }) {
    super();
    this.msgId = 0; // Unique message ID for tracking requests
    this.pending = new Map(); // Map to hold pending requests
    this.window = new BrowserWindow(getBrowserWindowSettings());
    this.args = args;

    ipcMain.on('mouse-event', this._onMouseEvent);
    ipcMain.on('resize-request', this._onResizeRequest);
    ipcMain.on('key-event', this._onKeyEvent);

    this.window.webContents.on('did-finish-load', () => {
      if (this.client) {
        this._initializeWindowConnection();
      } else {
        console.error('[NvimRPC] Client not connected');
      }
    });

    this.window.on('close', () => {
      this._removeEventListeners();
    });

    this._promptForConnection();
  }

  _promptForConnection() {
    const connectPagePath = path.join(app.getAppPath(), 'src', 'html_files', 'connect.html');
    this.window.loadFile(connectPagePath);

    ipcMain.once('connection-choice', (event, choice) => {
      if (event.sender !== this.window.webContents) return;

      if (choice.type === 'spawn') {
        this._spawnNvim();
      } else if (choice.type === 'connect' && choice.socketPath) {
        this._connectToSocket(choice.socketPath);
      } else if (choice.type === 'container') {
        this._connectToContainer();
      }
    });
  }
  _connectToContainer() {
    // Use 'docker exec' to run a command in an already running container.
    // The '-i' flag is crucial to keep stdin open.
    this.child = spawn('docker', ['exec', '-i', 'devcontainer', 'nvim', '--embed']);

    // this.child = spawn('nvim', ['--embed', ...this.args]); // Start Neovim in embedded mode
    this.client = this.child.stdin; // Use child process stdin for communication

    const decoder = createDecodeStream(); // Create a decoder stream for incoming messages
    this.child.stdout.pipe(decoder); // Pipe Neovim's stdout to the decoder

    // Wait for the first data event from nvim before loading the window.
    // This ensures nvim is ready before the UI tries to attach.
    // decoder.once('data', (msg) => {
    // this._loadWindow();
    // this._handleMessage(msg); // Process the first message
    // });

    decoder.on('data', (msg) => this._handleMessage(msg)); // Handle subsequent messages
    decoder.on('error', (err) => this.emit('error', err)); // Emit error events

    this.child.on('spawn', () => this._loadWindow());
    this.child.on('error', (err) => {
      console.error('[NvimRPC] docker error: ', err);
      dialog.showErrorBox('Docker Error', `Failed to execute nvim in container 'devcontainer'.\nIs the container running?\n${err.message}`);
      this._promptForConnection();
    });
    this.child.on('close', async (code) => {
      console.log(`[NvimRPC] docker process exited with code ${code}`);
      await this.close();
      this.emit('close');
    });
  }


  _spawnNvim() {
    // If no socket path is provided, spawn a new Neovim process
    this.child = spawn('nvim', ['--embed', ...this.args]); // Start Neovim in embedded mode
    this.client = this.child.stdin; // Use child process stdin for communication
    const decoder = createDecodeStream(); // Create a decoder stream for incoming messages
    this.child.stdout.pipe(decoder); // Pipe Neovim's stdout to the decoder

    decoder.on('data', (msg) => this._handleMessage(msg)); // Handle incoming messages
    decoder.on('error', (err) => this.emit('error', err)); // Emit error events
    this.child.on('spawn', () => this._loadWindow());
    this.child.on('error', (err) => console.error('[NvimRPC] error: ', err)); // Emit error events for child process
    this.child.on('close', async () => {
      await this.close(); // Close the connection when the child process closes
      this.emit('close');
    }); // Emit close event when the process closes
  }

  _connectToSocket(socketPath) {
    // If a socket path is provided, create a TCP connection to that socket
    this.socketPath = socketPath; // Store the socket path
    this.client = createConnection(this.socketPath); // Create a connection to the socket
    const decoder = createDecodeStream(); // Create a decoder stream for incoming messages
    this.client.pipe(decoder); // Pipe the socket data to the decoder
    decoder.on('data', (msg) => this._handleMessage(msg)); // Handle incoming messages
    decoder.on('error', (err) => {
      this.emit('error', err);
      dialog.showErrorBox('Connection Error', `Failed to connect to socket: ${socketPath}\n${err.message}`);
      this._promptForConnection(); // Show connection prompt again on error
    });
    this.client.on('connect', () => this._loadWindow());
    this.client.on('error', (err) => console.error('[NvimRPC] error: ', err)); // Emit error events for the socket
    this.client.on('close', () => this.emit('close')); // Emit close event when the connection closes
  }

  // Processes a decoded message based on its type
  _handleMessage(msg) {
    const [type, ...rest] = msg; // Destructure the message type and payload
    if (type === 0) {
      // Message type 0 indicates a request from Neovim, which requires a response
      const [msgid, method, params] = rest;
      this._rpcRequest(method, params, (response) => {
        // Send the response back to Neovim
        const reply = [1, msgid, null, response];
        this.client.write(encode(reply));
      });
    } else if (type === 1) {
      // Message type 1 indicates a response to a request
      const [msgid, error, result] = rest; // Extract message ID, error, and result
      const cb = this.pending.get(msgid); // Retrieve the callback for this message ID
      if (cb) {
        this.pending.delete(msgid); // Remove the callback from pending
        cb(error, result); // Call the callback with error and result
      }
      // Message type 2 indicates an event notification
    } else if (type === 2) {
      const [event, args] = rest; // Extract event name and arguments
      if (event === 'redraw') {
        // Handle 'redraw' events by sending them to the renderer process
        for (const update of args) {
          const [cmd, ...args] = update; // Extract command and its arguments

          this.window.webContents.send('redraw-event', { cmd, args }); // Send the command to the renderer
        }
      } else if (event === 'new-window') {
        // Handle 'new-window' events by emitting a new-window event
        this.emit('new-window'); // Emit a new-window event
      } else if (event === 'quit-ui') {
        // Handle 'quit-ui' events by closing the connection
        this.emit('quit-ui'); // Emit a quit-ui event
      } else if (event === 'reader-page-down') {
        this.window.webContents.send('reader-page-down');
      } else if (event === 'reader-page-up') {
        this.window.webContents.send('reader-page-up');
      } else if (event === 'reader-toggle') {
        this.window.webContents.send('reader-toggle');
      } else {
        console.error('[NVIMRPC] ', event); // Log unhandled events
      }
    }
  };

  _initializeWindowConnection() {
    //this.window.webContents.send('set-guifont', { fontName: 'Monospace', fontSize: 12 }, 100, 60);
    this.command("autocmd VimEnter * call rpcrequest(1, 'vimenter')");
    this.command('set termguicolors'); // Enable true color support in Neovim
    this.request('nvim_ui_attach', [100, 60, NVIM_UI_OPTIONS]);
  }

  _enterNeovim = async () => {
    let global_variables = {};
    await this.request('nvim_get_var', ['ui_font_multiplier_width'])
      .then(value => {
        global_variables['ui_font_multiplier_width'] = value;
      })
      .catch(err => {
        console.error('Failed to get variable:', err);
      });

    await this.request('nvim_get_var', ['ui_font_multiplier_height'])
      .then(value => {
        global_variables['ui_font_multiplier_height'] = value;
        //this.window.webContents.send('set-guifont', { fontName: 'Monospace',
        //fontSize: 12 * value }, value);
      })
      .catch(err => {
        console.error('Failed to get variable:', err);
      });

    this.window.webContents.send('set-global-variables', global_variables);

    this.command("autocmd VimLeavePre Copilot disable");
    this.command("command! NewGuiWindow call rpcnotify(1, 'new-window')");
    this.command("command! QuitUI call rpcnotify(1, 'quit-ui')");
    this.command("command! ReaderPageDown call rpcnotify(1, 'reader-page-down')");
    this.command("command! ReaderPageUp call rpcnotify(1, 'reader-page-up')");
    this.command("command! ReaderToggle call rpcnotify(1, 'reader-toggle')");

  };

  _removeEventListeners() {
    ipcMain.removeListener('mouse-event', this._onMouseEvent);
    ipcMain.removeListener('resize-request', this._onResizeRequest);
    ipcMain.removeListener('key-event', this._onKeyEvent);
  };

  _onKeyEvent = (event, keyevent) => {
    if (
      this.window.isDestroyed() ||
      event.sender !== this.window.webContents
    ) return;

    if (['Shift', 'Control', 'Alt', 'Meta'].includes(keyevent.key)) return;

    const input = translateKey(keyevent);
    if (input) {
      this.request('nvim_input', [input]);
    }
  };

  _onResizeRequest = (event, { cols, rows }) => {
    if (
      this.window.isDestroyed() || event.sender !== this.window.webContents
    ) return; // Ignore events not from the current window
    this.request('nvim_ui_try_resize', [cols, rows])
      .catch(err => console.error('Resize failed:', err));
  };

  _onMouseEvent = (event, { grid, row, col, button, action, modifier }) => {
    if (
      this.window.isDestroyed() || event.sender !== this.window.webContents
    ) return; // Ignore events not from the current window
    this.request('nvim_input_mouse', [button, action, modifier, grid, row, col]);
  };

  _loadWindow() {
    //console.log('[NvimRPC] Loading window');
    // Use app.getAppPath() for robust pathing in dev and prod
    const indexPath = path.join(app.getAppPath(), 'src', 'html_files', 'index.html');
    this.window.loadFile(indexPath);

    //this.window.webContents.openDevTools({ mode: 'detach' }); // Open the developer tools for debugging
  }

  _rpcRequest(method, params, responder) {
    if (method === 'vimenter') {
      this._enterNeovim(); // Call the method to enter Neovim
      responder(null);
    } else {
      console.warn(`[Neovim] Unknown request method: ${method}`);
      responder(null);
    }
  }

  // Sends a message to Neovim with the specified type, method, and parameters
  _send(type, method, params = []) {
    const msgid = this.msgId++; // Increment and get a unique message ID
    const message = [type, msgid, method, params]; // Construct the message array
    this.client.write(encode(message)); // Encode and send the message to Neovim
    return msgid; // Return the message ID for tracking
  }

  // Sends a request to Neovim and returns a promise that resolves with the result
  request(method, params = []) {
    return new Promise((resolve, reject) => {
      const msgid = this._send(0, method, params); // Send a request message (type 0)
      this.pending.set(msgid, (err, result) => {
        if (err) reject(err); // Reject the promise if there's an error
        else resolve(result); // Resolve the promise with the result
      });
    });
  }

  // Sends a notification to Neovim without expecting a response
  notify(method, params = []) {
    const message = [2, method, params]; // Construct a notification message (type 2)
    this.client.write(encode(message)); // Encode and send the notification
  }

  // High-level method to execute a command in Neovim
  command(cmd) {
    return this.request('nvim_command', [cmd]); // Send a command request to Neovim
  }

  // High-level method to evaluate an expression in Neovim
  eval(expr) {
    return this.request('nvim_eval', [expr]); // Send an evaluation request to Neovim
  }

  // Closes the socket connection to Neovim
  async close() {
    if (this.window !== undefined) {
      // console.log('[NvimRPC] Closing window');

      this.client.end(); // End the connection to Neovim
      this.window.close(); // Close the Electron window
    } else {
      // console.log('[NvimRPC] No window to close');
    }
  }
}

export default NvimRPC;
