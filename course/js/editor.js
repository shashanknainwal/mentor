// CodeMirror 5 when the CDN loaded it; a plain textarea otherwise.
export function createEditor(host, value, { onChange, onRunTests } = {}) {
  let debounce;
  const changed = (get) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => onChange && onChange(get()), 250);
  };

  if (window.CodeMirror) {
    const cm = window.CodeMirror(host, {
      value,
      mode: 'python',
      theme: 'playbook',
      lineNumbers: true,
      indentUnit: 4,
      tabSize: 4,
      indentWithTabs: false,
      matchBrackets: true,
      autoCloseBrackets: true,
      styleActiveLine: true,
      viewportMargin: 50,
      extraKeys: {
        Tab: (c) => (c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('    ', 'end')),
        'Shift-Tab': (c) => c.indentSelection('subtract'),
        'Ctrl-Enter': () => onRunTests && onRunTests(),
        'Cmd-Enter': () => onRunTests && onRunTests(),
        'Ctrl-/': 'toggleComment',
      },
    });
    cm.on('change', () => changed(() => cm.getValue()));
    return {
      getValue: () => cm.getValue(),
      setValue: (v) => cm.setValue(v),
      destroy: () => clearTimeout(debounce),
    };
  }

  const ta = document.createElement('textarea');
  ta.className = 'fallback';
  ta.spellcheck = false;
  ta.value = value;
  host.appendChild(ta);
  ta.addEventListener('input', () => changed(() => ta.value));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en } = ta;
      ta.setRangeText('    ', s, en, 'end');
      changed(() => ta.value);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onRunTests && onRunTests();
    }
  });
  return {
    getValue: () => ta.value,
    setValue: (v) => { ta.value = v; changed(() => ta.value); },
    destroy: () => clearTimeout(debounce),
  };
}
