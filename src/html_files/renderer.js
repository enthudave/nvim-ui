//const stringWidth = window.Electron.stringWidth;

class Grid {
  constructor() {

    this.cellWidth = 0;
    this.cellHeight = 0;
    this.columns = 0;
    this.rows = 0;
    this.frameBuffer = [];

    this.canvas = document.createElement('canvas');
    this.canvas.style.imageRendering = 'pixelated';
    this.context = this.canvas.getContext('2d');
  }
}

class Renderer {

  constructor() {
    this.globalVariables = {};
    this.grids = {};
    this.grids[1] = new Grid();
    this.dirtyCells = new Set();
    this.initial_font();
    this.highlights = new Map();
    this.highlightGroups = {};
    this.modeInfo = null;
    this.isDragging = false;
    this.mouseButton = null;
    this.cursorPos = { grid: 1, row: 0, col: 0 };
    this.cursorVisible = true;

    this.cursorElement = document.createElement('div');
    this.cursorElement.style.pointerEvents = 'none';
    this.cursorElement.style.backgroundColor = 'rgba(255, 0, 255, 0.5)';
    this.cursorElement.style.opacity = '1';
    this.cursorElement.style.transition = 'opacity 0.05s linear';
    this.cursorElement.style.zIndex = '10';

    this.nvimContainer = document.createElement('div');
    this.nvimContainer.id = 'nvim-container';
    this.nvimContainer.style.position = 'absolute';
    this.nvimContainer.style.overflow = 'hidden';
    this.nvimContainer.style.width = 'calc(100%)'; // Remaining width after sidebar
    this.nvimContainer.style.height = '100vh'; // Full height of the viewport
    this.nvimContainer.style.boxSizing = 'border-box';
    this.nvimContainer.style.top = '0';
    this.nvimContainer.appendChild(this.grids[1].canvas);
    this.nvimContainer.appendChild(this.cursorElement);

    document.body.style.overflow = 'hidden';
    document.body.style.position = 'relative';

    document.body.appendChild(this.nvimContainer);

    this.initEventListeners();
  };

  busy_start = () => {
    this.cursorElement.style.opacity = '0.0';
    if (this.blinkTimer) {
      clearInterval(this.blinkTimer);
      this.blinkTimer = null;
    }
  };

  busy_stop = () => {
    this.cursorElement.style.opacity = '1.0';
  };

  chdir = () => {
    return;
  };

  default_colors_set = (args) => {
    this.highlights.set(0, { foreground: args[0][0], background: args[0][1], special: args[0][2] });
    // set window background color
    document.body.style.backgroundColor = this.formatColor(args[0][1]);
    //this.sidebar.style.backgroundColor = this.formatColor(args[0][1]);
    //this.sidebar.style.color = this.formatColor(args[0][0]);
  };

  _renderCell(grid, row, col, overrideHl = null) {
    const cell = grid.frameBuffer[row][col];
    if (!cell || cell.skip) {
      return;
    }

    // Use overrideHl if provided, otherwise use the cell's own highlight.
    const { text, hl: cellHl } = cell;
    let currentHl = overrideHl || cellHl;

    if (currentHl === undefined) {
      // Fallback to a very basic default if no highlight info is available at all.
      // This should ideally not happen if frameBuffer cells always have a valid hl.
      currentHl = this.highlights.get(0) || { background: 0x000000, foreground: 0xFFFFFF, bold: false, italic: false, underline: false };
    }

    const background_x = Math.floor(col * grid.cellWidth);
    const background_y = Math.floor(row * grid.cellHeight);
    let x_text_offset = 0;
    const y_text = row * grid.cellHeight + grid.cellHeight / 2;
    let cellDisplayWidth = grid.cellWidth;

    if (grid.frameBuffer[row][col + 1]?.skip) {
      cellDisplayWidth = grid.cellWidth * 2;
    }

    const charActualWidth = grid.context.measureText(text).width;
    x_text_offset = (cellDisplayWidth - charActualWidth) / 2;
    const x_text_render_pos = col * grid.cellWidth + x_text_offset;

    grid.context.fillStyle = this.formatColor(currentHl.background);
    grid.context.fillRect(
      background_x,
      background_y,
      Math.ceil(cellDisplayWidth),
      Math.ceil(grid.cellHeight)
    );

    const styleParts = [];
    if (currentHl.bold) styleParts.push('bold');
    if (currentHl.italic) styleParts.push('italic');
    styleParts.push(this.contextFont);
    grid.context.font = styleParts.join(' ');

    grid.context.fillStyle = this.formatColor(currentHl.foreground);

    grid.context.textBaseline = 'middle';
    grid.context.fillText(text, x_text_render_pos, y_text);

    if (currentHl.underline) {
      const underlineY = row * grid.cellHeight + grid.cellHeight - 2;
      grid.context.beginPath();
      grid.context.moveTo(background_x, underlineY);
      grid.context.lineTo(background_x + cellDisplayWidth, underlineY);
      grid.context.strokeStyle = grid.context.fillStyle;
      grid.context.lineWidth = 1;
      grid.context.stroke();
    }
  }

  flush = () => {
    // Iterate only over the dirty cells
    for (const cellKey of this.dirtyCells) {
      const [grid, row, col] = cellKey.split(',').map(Number);
      this._renderCell(this.grids[grid], row, col);
    }

    // Clear the dirty set after flushing
    this.dirtyCells.clear();

    this.renderCursorOverlay();
  };

  grid_clear = (args) => {
    const [grid, top, bot, left, right] = args[0];
    for (let row = top; row < bot; row++) {
      if (!this.grids[grid].frameBuffer[row]) {
        console.error(`Row ${row} is out of bounds`);
        continue;
      }
      for (let col = left; col < right; col++) {
        if (!this.grids[grid].frameBuffer[row][col]) {
          console.error(`Column ${col} is out of bounds`);
          continue;
        }
        const defaultHl = this.highlights.get(0) || {};
        this.grids[grid].frameBuffer[row][col] = { text: ' ', hl: defaultHl };
      }
    }
  };

  grid_cursor_goto = (args) => {
    const [grid, row, col] = args[0];
    this.cursorPos = { grid, row, col };
  };

  grid_line = (args) => {
    try {
      for (const [grid, row, col_start, cells] of args) {
        let column = col_start;
        let lastHlId = null;
        let skipnext = false;
        for (const cell of cells) {
          const character = typeof cell[0] === 'string' ? cell[0] : ' ';
          const hlId = cell?.[1] !== undefined ? cell[1] : lastHlId;
          lastHlId = hlId;
          const repeat = cell.length === 3 ? cell[2] : 1;
          for (let i = 0; i < repeat; i++) {
            if (!this.grids[grid].frameBuffer[row]) {
              console.error(`Row ${row} is out of bounds`);
              continue;
            }

            this.dirtyCells.add(`${grid},${row},${column}`);

            const baseHl = this.highlights.get(hlId);
            const defaultHl = this.highlights.get(0);

            const isReversed = baseHl.reverse === true;

            const hl = {
              foreground: isReversed
                ? (baseHl.background !== undefined ? baseHl.background : defaultHl.background)
                : (baseHl.foreground !== undefined ? baseHl.foreground : defaultHl.foreground),
              background: isReversed
                ? (baseHl.foreground !== undefined ? baseHl.foreground : defaultHl.foreground)
                : (baseHl.background !== undefined ? baseHl.background : defaultHl.background),
              bold: baseHl.bold || false,
              italic: baseHl.italic || false,
              underline: baseHl.underline || false
            };

            // const fontWidth = Math.ceil(this.grids[1].context.measureText(character).width);
            // const normalWidth = Math.ceil(this.grids[1].context.measureText('W').width);
            // const alternative_width = fontWidth / Math.floor(this.grids[1].cellWidth);
            const width = window.Electron.stringWidth(character);


            if (skipnext) {
              this.grids[grid].frameBuffer[row][column] = { skip: true, hl: hl };
              skipnext = false;
            } else if (width === 2) {
              this.grids[grid].frameBuffer[row][column] = { text: character, hl: hl };
              skipnext = true;
            } else {
              this.grids[grid].frameBuffer[row][column] = { text: character, hl: hl };
            }
            column++;
          }
        }
      }
    } catch (error) {
      console.error('Error in grid_line:', error);
      throw error; // Re-throw the error to propagate it to the caller
    }
  };

  grid_resize = (args) => {
    try {
      const [grid, newCols, newRows] = args[0];
      if (!this.grids[grid]) {
        // Create a new grid if it doesn't exist
        this.grids[grid] = new Grid();
      }

      this.grids[grid].columns = newCols;
      this.grids[grid].rows = newRows;
      this.resizeGrid(this.grids[grid].columns, this.grids[grid].rows);

    } catch (error) {
      console.error('Error in grid_resize:', error);
      throw error; // Re-throw the error to propagate it to the caller
    }
  };

  grid_scroll = (args) => {
    for (const entry of args) {
      // Support both 6- and 7-element arrays for backward compatibility
      const [grid, top, bot, left, right, rows, cols = 0] = entry;

      const height = bot - top;
      const width = right - left;

      // Vertical scroll (existing logic)
      const copyRegionVertical = (src, dest) => {
        for (let i = 0; i < height; i++) {
          const srcRow = src(i);
          const destRow = dest(i);
          if (
            srcRow >= top &&
            srcRow < bot &&
            destRow >= top &&
            destRow < bot &&
            this.grids[grid].frameBuffer[srcRow] &&
            this.grids[grid].frameBuffer[destRow]
          ) {
            for (let col = left; col < right; col++) {
              this.grids[grid].frameBuffer[destRow][col] = this.grids[grid].frameBuffer[srcRow][col];
              this.dirtyCells.add(`${grid},${destRow},${col}`);
            }
          }
        }
      };

      // Horizontal scroll
      const copyRegionHorizontal = (src, dest) => {
        for (let row = top; row < bot; row++) {
          if (!this.grids[grid].frameBuffer[row]) continue;
          for (let i = 0; i < width; i++) {
            const srcCol = src(i);
            const destCol = dest(i);
            if (
              srcCol >= left &&
              srcCol < right &&
              destCol >= left &&
              destCol < right
            ) {
              this.grids[grid].frameBuffer[row][destCol] = this.grids[grid].frameBuffer[row][srcCol];
              this.dirtyCells.add(`${grid},${row},${destCol}`);
            }
          }
        }
      };

      if (rows !== 0) {
        if (rows > 0) {
          copyRegionVertical(i => top + i, i => top + i - rows);
        } else {
          copyRegionVertical(i => bot - 1 - i, i => bot - 1 - i - rows);
        }
      }
      if (cols !== 0) {
        if (cols > 0) {
          copyRegionHorizontal(i => left + i, i => left + i - cols);
        } else {
          copyRegionHorizontal(i => right - 1 - i, i => right - 1 - i - cols);
        }
      }
    }
  };

  hl_attr_define = (args) => {
    for (const [id, hl, , info_array] of args) { // Renamed 'info' to 'info_array' for clarity
      if (id === 0) console.error(
        'hl_attr_define: id 0 is expected to be coming from default_colors_set!');
      // Log the raw 'hl' object and the 'info_array'
      this.highlights.set(id, { ...hl, info: info_array }); // Store info_array as 'info'
    }
  };

  hl_group_set = (args) => {
    for (const [name, id] of args) {
      this.highlightGroups[name] = { id };
    }
  };

  mode_change = (args) => {
    if (!this.cursorStyleEnabled) return;
    const modeConfig = this.cursorModes[args[0][0]];
    if (!modeConfig) return;
    this.setCursorMode(modeConfig);
  };

  mode_info_set = (args) => {
    const [enabled, modeInfoList] = args[0];
    this.cursorStyleEnabled = enabled;
    this.modeInfo = modeInfoList;
    this.cursorModes = {};

    for (const info of modeInfoList) {
      const mode = info.name;
      this.cursorModes[mode] = {
        shape: info.cursor_shape,
        blinkon: info.blinkon,
        blinkoff: info.blinkoff,
        blinkwait: info.blinkwait,
        hl_id: info.hl_id,
      };
    }
  };

  mouse_off = () => {
    this.mouseEnabled = false;
  };

  mouse_on = (args) => {
    this.mouseEnabled = args[0];
  };

  option_set = (args) => {
    for (const [name, value] of args) {
      //console.log(`Option set: ${name} = ${value}`);
      if (name === 'guifont' && value) {
        const parsed = this.parseGuifont(value);
        //console.log('Parsed guifont:', parsed);
        this.setGuifont(parsed);
        this.handleResize();
      }
    }
  };

  set_icon = () => {
    return;
  };

  set_title = (args) => {
    document.title = args[0] || 'Neovim';
  };

  update_menu = () => {
    //console.log('Update menu:', args);
  };

  win_viewport = (args) => {
    // Store the first (or only) viewport entry — later can support multigrid if needed
    this.viewport = args[0];
  };

  initEventListeners() {
    window.Electron.onGuifont((guifont) => this.setGuifont(guifont));
    window.Electron.onGlobalVariables((args) => this.setGlobalVariables(args));
    window.Electron.onVimCmd(({ cmd, args }) => this.handleVimCmd(cmd, args));
    window.addEventListener('keydown', (event) => this.handleKeydown(event));
    window.addEventListener('resize', () => this.handleResize());

    // Iterate over all grids in the object and attach event listeners to their canvases
    for (const [, grid] of Object.entries(this.grids)) {
      grid.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
      grid.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
      grid.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
      grid.canvas.addEventListener('mousewheel', this.handleMouseWheel.bind(this), { passive: false });
    }
  }

  sendMouseEvent(event, action) {
    if (!this.mouseEnabled) return;

    // Get the bounding rectangle of the nvim-container
    const containerRect = this.nvimContainer.getBoundingClientRect();

    // Calculate the cursor position relative to the nvim-container
    const offsetX = event.clientX - containerRect.left;
    const offsetY = event.clientY - containerRect.top;

    const col = Math.floor(offsetX / this.grids[1].cellWidth);
    let row = Math.floor(offsetY / this.grids[1].cellHeight);

    const modifier = this.getMouseModifier(event);
    const button = action === 'press' ? this.getMouseButton(event) : this.mouseButton;

    if (this.isDragging && (action === 'drag' || action === 'release')) {
      --row;
    }

    window.Electron.sendMouseEvent({
      grid: 1,
      row,
      col,
      button,
      action,
      modifier,
    });
  }


  handleMouseWheel(event) {
    if (!this.mouseEnabled) return;
    event.preventDefault();

    const threshold = 3;
    const { deltaY, deltaX } = event;

    // If neither axis exceeds threshold, do nothing
    if (Math.abs(deltaY) < threshold && Math.abs(deltaX) < threshold) return;

    const containerRect = this.nvimContainer.getBoundingClientRect();
    const offsetX = event.clientX - containerRect.left;
    const offsetY = event.clientY - containerRect.top;

    const col = Math.floor(offsetX / this.grids[1].cellWidth);
    const row = Math.floor(offsetY / this.grids[1].cellHeight);
    const modifier = this.getMouseModifier(event);

    // Prioritize the axis with the larger delta
    if (Math.abs(deltaY) >= Math.abs(deltaX)) {
      const direction = deltaY < 0 ? 'up' : 'down';
      window.Electron.sendMouseEvent({
        grid: 1,
        row,
        col,
        button: 'wheel',
        action: direction,
        modifier,
      });
    } else {
      const direction = deltaX < 0 ? 'left' : 'right';
      window.Electron.sendMouseEvent({
        grid: 1,
        row,
        col,
        button: 'wheel',
        action: direction,
        modifier,
      });
    }
  }
  handleMouseWheel_a(event) {
    if (!this.mouseEnabled) return;
    event.preventDefault();

    const threshold = 3;
    const delta = event.deltaY;

    if (Math.abs(delta) < threshold) return;

    const direction = delta < 0 ? 'up' : 'down';

    const containerRect = this.nvimContainer.getBoundingClientRect();
    const offsetX = event.clientX - containerRect.left;
    const offsetY = event.clientY - containerRect.top;

    const col = Math.floor(offsetX / this.grids[1].cellWidth);
    const row = Math.floor(offsetY / this.grids[1].cellHeight);
    const modifier = this.getMouseModifier(event);

    window.Electron.sendMouseEvent({
      grid: 1,
      row,
      col,
      button: 'wheel',
      action: direction,
      modifier,
    });
  }

  handleMouseDown(event) {
    this.mouseDown = true;
    this.mouseButton = this.getMouseButton(event);
    this.sendMouseEvent(event, 'press');
  }

  getMouseButton(event) {
    switch (event.button) {
      case 0: return 'left';
      case 1: return 'middle';
      case 2: return 'right';
      default: return 'left';
    }
  }

  getMouseModifier(event) {
    return (event.ctrlKey ? 'C' : '') +
      (event.shiftKey ? 'S' : '') +
      (event.altKey ? 'A' : '');
  }

  handleMouseMove(event) {
    if (!this.mouseDown) return;
    this.isDragging = true;
    this.sendMouseEvent(event, 'drag');
  }

  handleMouseUp(event) {
    if (!this.mouseDown) return;
    this.mouseDown = false;
    this.sendMouseEvent(event, 'release');
    this.isDragging = false
  }

  formatColor(n) {
    return `#${n.toString(16).padStart(6, '0')}`;
  }

  handleVimCmd(cmd, args) {
    const handler = this[cmd];
    if (handler) {
      try {
        handler(args);
      } catch (error) {
        console.error(`Error in cmd '${cmd}':`, error);
      }
    } else {
      console.error(`Unhandled cmd: ${cmd}`);
    }
  };

  handleKeydown(event) {
    window.Electron.sendKeyEvent({
      key: event.key,
      code: event.code,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
    });
    event.preventDefault();
  };

  initial_font() {
    this.setGuifont({ fontName: 'monospace', fontSize: 16 });
  }

  setGuifont(guifont) {
    if (guifont) {
      //console.log('guifont: ', guifont)

      const { fontName, fontSize } = guifont;

      this.contextFont = `${fontSize}px ${fontName}`;
      this.grids[1].context.font = this.contextFont;

      this.fontWidth = Math.ceil(this.grids[1].context.measureText('W').width);
      this.fontHeight = fontSize;
      this.setCellDimensions();
    }
  };

  setCellDimensions() {
    let height_multiplier = (this.globalVariables['ui_font_multiplier_height'] != null)
      ? this.globalVariables['ui_font_multiplier_height']
      : 5;
    let width_multiplier = (this.globalVariables['ui_font_multiplier_width'] != null)
      ? this.globalVariables['ui_font_multiplier_width']
      : 2.5;

    //console.log('setCellDimensions: ', height_multiplier, width_multiplier);
    this.grids[1].cellHeight = Math.ceil(this.fontHeight * (1 + height_multiplier / 10));
    this.grids[1].cellWidth = Math.ceil(this.fontWidth * (1 + width_multiplier / 10));
  }

  setGlobalVariables(args) {
    //console.log('setGlobalVariables:', args);
    this.globalVariables = args;
    this.setCellDimensions();
    this.handleResize();
  }

  handleResize() {
    const container = document.getElementById('nvim-container');
    this.width = container.clientWidth;
    this.height = container.clientHeight;
    if (this.shouldResizeGrid()) {
      //console.log('this.grids[1].columns:', this.grids[1].columns,
      //'this.grids[1].rows:', this.grids[1].rows);
      window.Electron.sendResize(this.grids[1].columns, this.grids[1].rows);
    }
  };

  shouldResizeGrid() {
    //const newColumns = Math.floor(this.width / this.grids[1].cellWidth) - 1;
    const newRows = Math.floor(this.height / this.grids[1].cellHeight) - 1;
    const newColumns = Math.floor(this.width / this.grids[1].cellWidth);
    //const newRows = Math.floor(this.height / this.grids[1].cellHeight);
    // Check if the grid size has changed
    if (newColumns !== this.grids[1].columns || newRows !== this.grids[1].rows) {
      this.grids[1].columns = newColumns;
      this.grids[1].rows = newRows;
      return true; // Grid size has changed
    }
    return false; // Grid size remains the same
  };

  resizeGrid(cols, rows) {
    if (!cols || !rows || cols <= 0 || rows <= 0) {
      throw new Error(`Invalid grid size: cols=${cols}, rows=${rows}`);
    }
    if (!this.grids[1].cellWidth || !this.grids[1].cellHeight) {
      throw new Error(`Invalid cell dimensions: cellWidth=${this.grids[1].cellWidth}, cellHeight=${this.grids[1].cellHeight}`);
    }

    const dpr = window.devicePixelRatio || 1;

    //this.grids[1].canvas.width = Math.ceil(this.width * dpr);
    //this.grids[1].canvas.height = Math.ceil(this.height * dpr);
    //this.grids[1].canvas.style.width = `${this.width}px`;
    //this.grids[1].canvas.style.height = `${this.height}px`;

    // Adjust canvas dimensions for high-DPI scaling
    this.grids[1].canvas.width = Math.ceil(cols * this.grids[1].cellWidth * dpr);
    this.grids[1].canvas.height = Math.ceil(rows * this.grids[1].cellHeight * dpr);
    this.grids[1].canvas.style.width = `${Math.ceil(cols * this.grids[1].cellWidth)}px`;
    this.grids[1].canvas.style.height = `${Math.ceil(rows * this.grids[1].cellHeight)}px`;

    // Apply scaling to the context
    this.grids[1].context.scale(dpr, dpr);


    // Update the frame buffer to match the new grid size
    this.grids[1].frameBuffer = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ text: ' ', hl: this.highlights.get(0) }))
    );
  };

  parseGuifont(guifont) {
    const match = guifont.match(/([^:]+):h(\d+)/);
    if (!match) {
      console.error('Could not parse guifont:', guifont);
      return null;
    }
    return {
      fontName: match[1],
      fontSize: parseInt(match[2], 10),
    };
  };

  mapCursorShape(shape) {
    switch (shape) {
      case 'block':
        return 'block';
      case 'horizontal':
        return 'underline';
      case 'vertical':
        return 'bar';
      default:
        return 'block';
    }
  }

  setCursorMode(modeConfig) {
    if (!modeConfig) return;

    this.cursorShape = this.mapCursorShape(modeConfig.shape);
    this.cursorBlinkOn = modeConfig.blinkon;
    this.cursorBlinkOff = modeConfig.blinkoff;

    const forcedGroupName = 'Cursor'; // We specifically want to use the 'Cursor' group's style
    const neovimSuggestedHlId = modeConfig.hl_id;

    if (this.highlightGroups[forcedGroupName] && this.highlightGroups[forcedGroupName].id !== undefined) {
      const forcedHlId = this.highlightGroups[forcedGroupName].id;
      this.cursorHlId = forcedHlId;
    } else {
      this.cursorHlId = neovimSuggestedHlId;
    }

  };

  renderCursorOverlay() {
    if (this.blinkTimer) {
      clearInterval(this.blinkTimer);
      this.blinkTimer = null;
    }

    const { grid: gridId, row, col } = this.cursorPos;
    const currentGrid = this.grids[gridId];
    this.dirtyCells.add(`${gridId},${row},${col}`);

    if (!this.cursorVisible || !currentGrid || !currentGrid.frameBuffer[row] || !currentGrid.frameBuffer[row][col]) {
      this.cursorElement.style.visibility = 'hidden';
      this.cursorElement.style.display = 'none';
      return;
    }

    const cellData = currentGrid.frameBuffer[row][col];
    const originalCellHl = cellData.hl || this.highlights.get(0) || { foreground: 0xFFFFFF, background: 0x000000 };

    if (this.cursorShape === 'block') {
      this.cursorElement.style.visibility = 'hidden';
      this.cursorElement.style.display = 'none';

      const cursorModeHlDefinition = this.highlights.get(this.cursorHlId);
      // Log what was retrieved from the highlights map
      const defaultColorsHl = this.highlights.get(0) || {}; // Fallback default colors

      let blockCursorHl = { ...originalCellHl }; // Start with a copy of the cell's original highlight.

      if (cursorModeHlDefinition) {
        if (cursorModeHlDefinition.reverse) {
          // Reverse foreground and background from original cell's highlight
          blockCursorHl.foreground = originalCellHl.background;
          blockCursorHl.background = originalCellHl.foreground;
          // Keep other properties like bold/italic from original, unless cursor def overrides
          blockCursorHl.bold = cursorModeHlDefinition.bold !== undefined ? cursorModeHlDefinition.bold : originalCellHl.bold;
          blockCursorHl.italic = cursorModeHlDefinition.italic !== undefined ? cursorModeHlDefinition.italic : originalCellHl.italic;
          blockCursorHl.underline = cursorModeHlDefinition.underline !== undefined ? cursorModeHlDefinition.underline : originalCellHl.underline;

        } else {
          // Apply specific foreground/background from cursor definition,
          // falling back to default colors if cursor def doesn't specify,
          // and then to original cell's colors if still undefined.
          blockCursorHl.foreground = cursorModeHlDefinition.foreground !== undefined ? cursorModeHlDefinition.foreground : defaultColorsHl.foreground;
          blockCursorHl.background = cursorModeHlDefinition.background !== undefined ? cursorModeHlDefinition.background : defaultColorsHl.background;
          // Carry over other style attributes from cursor definition or original
          blockCursorHl.bold = cursorModeHlDefinition.bold !== undefined ? cursorModeHlDefinition.bold : originalCellHl.bold;
          blockCursorHl.italic = cursorModeHlDefinition.italic !== undefined ? cursorModeHlDefinition.italic : originalCellHl.italic;
          blockCursorHl.underline = cursorModeHlDefinition.underline !== undefined ? cursorModeHlDefinition.underline : originalCellHl.underline;
        }
      }

      // Initial draw of the cell with cursor styling.
      this._renderCell(currentGrid, row, col, blockCursorHl);
      let blockCursorIsStyled = true; // Tracks if the cell is currently styled as cursor

      // Handle blinking for the block cursor by redrawing the cell.
      if (this.cursorBlinkOn > 0 && this.cursorBlinkOff > 0) {
        this.blinkTimer = setInterval(() => {
          // Check if cursor is still at the same position and shape
          if (this.cursorPos.grid === gridId && this.cursorPos.row === row && this.cursorPos.col === col && this.cursorShape === 'block' && this.cursorVisible) {
            blockCursorIsStyled = !blockCursorIsStyled;
            if (blockCursorIsStyled) {
              this._renderCell(currentGrid, row, col, blockCursorHl);
            } else {
              // Redraw the cell with its original highlight attributes.
              this._renderCell(currentGrid, row, col, originalCellHl);
            }
          } else {
            // Cursor moved or shape changed, clear timer and redraw original cell if needed
            clearInterval(this.blinkTimer);
            this.blinkTimer = null;
            // Ensure the cell where the cursor *was* is restored.
            // This might be complex if another flush hasn't happened.
            // For now, we rely on the next flush or cursor render to fix it.
            // A more robust solution might force a redraw of the old cell here.
          }
        }, this.cursorBlinkOn + this.cursorBlinkOff);
      }
    } else if (this.cursorShape === 'bar' || this.cursorShape === 'underline') {
      // For bar or underline, use the div overlay element.
      // The underlying cell on the canvas should be in its normal state (drawn by flush).

      const xPx = col * currentGrid.cellWidth;
      const yPx = row * currentGrid.cellHeight;

      this.cursorElement.style.display = 'block';
      this.cursorElement.style.position = 'absolute';
      this.cursorElement.style.left = `${xPx}px`;
      this.cursorElement.style.top = `${yPx}px`;
      this.cursorElement.textContent = ''; // Bar/underline don't display text.
      this.cursorElement.style.font = 'initial';
      this.cursorElement.style.padding = '0';
      this.cursorElement.style.margin = '0';
      this.cursorElement.style.letterSpacing = 'initial';
      this.cursorElement.style.textAlign = 'initial';
      this.cursorElement.style.color = 'transparent';

      const cursorModeHlDefinition = this.highlights.get(this.cursorHlId);
      const defaultFgColor = (this.highlights.get(0) || {}).foreground;

      if (cursorModeHlDefinition && cursorModeHlDefinition.foreground !== undefined) {
        this.cursorElement.style.backgroundColor = this.formatColor(cursorModeHlDefinition.background);
      } else if (defaultFgColor !== undefined) {
        this.cursorElement.style.backgroundColor = this.formatColor(defaultFgColor);
      } else {
        this.cursorElement.style.backgroundColor = '#FFFFFF'; // Fallback color.
      }

      if (this.cursorShape === 'bar') {
        this.cursorElement.style.width = `2px`;
        this.cursorElement.style.height = `${currentGrid.cellHeight}px`;
      } else if (this.cursorShape === 'underline') {
        this.cursorElement.style.width = `${currentGrid.cellWidth}px`;
        this.cursorElement.style.height = `2px`;
        this.cursorElement.style.top = `${yPx + currentGrid.cellHeight - 2}px`;
      }

      if (this.cursorBlinkOn > 0 && this.cursorBlinkOff > 0) {
        this.cursorElement.style.visibility = 'visible';
        this.blinkTimer = setInterval(() => {
          if (this.cursorPos.grid === gridId && this.cursorPos.row === row && this.cursorPos.col === col && (this.cursorShape === 'bar' || this.cursorShape === 'underline') && this.cursorVisible) {
            this.cursorElement.style.visibility =
              this.cursorElement.style.visibility === 'hidden' ? 'visible' : 'hidden';
          } else {
            clearInterval(this.blinkTimer);
            this.blinkTimer = null;
            this.cursorElement.style.visibility = 'hidden'; // Hide if cursor moved/changed
          }
        }, this.cursorBlinkOn + this.cursorBlinkOff);
      } else {
        this.cursorElement.style.visibility = 'visible';
      }
    } else {
      this.cursorElement.style.visibility = 'hidden';
      this.cursorElement.style.display = 'none';
    }
  };
}

//new Renderer();
const renderer = new Renderer();
