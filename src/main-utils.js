const isMac = process.platform === 'darwin';
// Keys are matched against event.key values, which for named keys are strings like 'Enter', 'Escape', etc.
// For printable characters, event.key returns the actual character — including ' ' (space).
// Therefore, we map ' ' → '<Space>' to handle the spacebar input correctly.
function translateKey(e) {
  // console.log('Key event:', e);
  const specialKeys = {
    Escape: 'Esc',
    Enter: 'CR',
    Backspace: 'BS',
    Tab: 'Tab',
    ' ': 'Space',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    Delete: 'Del',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    '<': 'LT',
    ...(isMac ? { Help: 'Insert' } : { Help: 'Help' })
  };

  if (e.key === 'CapsLock') {
    return;
  }

  if (specialKeys[e.key]) {
    // console.log('Special key:', e.key);
    return applyModifiers(true, specialKeys[e.key], e);
  }

  // Match F1–F12 keys
  if (/^F\d{1,2}$/.test(e.key)) {
    return applyModifiers(true, e.key, e);
  }

  return applyModifiers(false, e.key, e);
}

function applyModifiers(wrap = false, base, e) {
  let returnValue = base;
  const mods = [];
  if (
    e.shift &&
    (base.length > 1 || e.ctrl || e.alt || e.meta)
  ) mods.push('S');
  if (e.ctrl) mods.push('C');
  if (e.alt) mods.push('A');
  if (e.meta) mods.push('D'); // or 'M' or 'Cmd'

  if (mods.length > 0) {
    returnValue = `<${mods.join('-')}-${base}>`;
  } else {
    returnValue = wrap ? `<${returnValue}>` : returnValue;
  }
  // console.log('Transformed key:', returnValue);
  return returnValue;
}

export {
  translateKey,
};
