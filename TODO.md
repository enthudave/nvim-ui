# Nvim GUI

- desensitize mouse drag
- key handling improvement
- update_menu event

- Nvim optionally sends various screen elements "semantically" as structured events instead of raw grid-lines,
   as specified by ui-ext-options. The UI must present such elements itself,
    Nvim will not draw them on the grid.

- set_icon event

- chdir event

- License

## Performance Optimizations

- Use CSS animations or `requestAnimationFrame` for smoother cursor blinking.
- Synchronize all rendering updates with the browser's repaint cycle using `requestAnimationFrame`.
- Debounce `redraw` events to prevent the renderer from being overwhelmed.
- Benchmark and consider switching to `@msgpack/msgpack` for better performance.
- Update to a newer version of Electron to leverage performance improvements.
