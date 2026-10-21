/* Keep option lists in the protected BrowserWindow's DOM. Native <select>
 * popups can use a separate Windows HWND without the parent's capture affinity.
 * Only explicitly installed panel controls use this adapter. */
(function () {
  let opened = null;
  function install(select) {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = select.id + '-trigger';
    trigger.className = 'capture-safe-trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-label', select.getAttribute('aria-label') || '选择');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const label = document.createElement('span');
    trigger.appendChild(label);
    const menu = document.createElement('div');
    menu.id = select.id + '-options';
    menu.className = 'capture-safe-options';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', trigger.getAttribute('aria-label'));
    menu.hidden = true;
    trigger.setAttribute('aria-controls', menu.id);
    select.hidden = true;
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    select.dataset.captureSafe = 'true';
    select.after(trigger);
    document.getElementById('app').appendChild(menu);
    let active = -1, prefix = '', prefixAt = 0;
    const enabled = index => index >= 0 && index < select.options.length && !select.options[index].disabled;
    function highlight(index) {
      if (!enabled(index)) return;
      active = index;
      for (const [i, option] of [...menu.children].entries()) option.classList.toggle('active', i === active);
      const option = menu.children[active];
      trigger.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    }
    function close(restoreFocus = false) {
      if (opened === api) opened = null;
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-activedescendant');
      prefix = '';
      if (restoreFocus && !trigger.disabled) trigger.focus({ preventScroll: true });
    }
    function sync() {
      label.textContent = select.selectedOptions[0]?.textContent || select.options[0]?.textContent || '';
      trigger.disabled = select.disabled;
      // Option removal/relabeling must never leave a stale selectable source.
      close();
    }
    function position() {
      const box = trigger.getBoundingClientRect(), pad = 8;
      const width = Math.max(0, window.innerWidth - pad * 2);
      const height = Math.max(0, window.innerHeight - pad * 2);
      // Measure afresh: the previous fixed width must not grow on every open.
      menu.style.width = 'max-content';
      menu.style.width = Math.min(width, Math.max(box.width, Math.min(280, menu.getBoundingClientRect().width))) + 'px';
      menu.style.maxHeight = Math.min(240, height) + 'px';
      const below = Math.max(0, window.innerHeight - box.bottom - pad - 4);
      const above = Math.max(0, box.top - pad - 4);
      const up = menu.getBoundingClientRect().height > below && above > below;
      menu.style.maxHeight = Math.min(240, up ? above : below) + 'px';
      const bounds = menu.getBoundingClientRect();
      menu.style.left = Math.max(pad, Math.min(box.left, window.innerWidth - pad - bounds.width)) + 'px';
      menu.style.top = Math.max(pad, up ? box.top - bounds.height - 4 : box.bottom + 4) + 'px';
    }
    function open() {
      if (select.disabled || ![...select.options].some((_, i) => enabled(i))) return;
      opened?.close();
      const nodes = [...select.options].map((option, i) => {
        const node = document.createElement('div');
        node.id = menu.id + '-' + i;
        node.setAttribute('role', 'option');
        node.setAttribute('aria-selected', String(i === select.selectedIndex));
        node.setAttribute('aria-disabled', String(option.disabled));
        node.dataset.index = String(i);
        node.textContent = option.textContent;
        return node;
      });
      menu.replaceChildren(...nodes);
      menu.hidden = false;
      opened = api;
      trigger.setAttribute('aria-expanded', 'true');
      position();
      highlight(enabled(select.selectedIndex) ? select.selectedIndex : [...select.options].findIndex((_, i) => enabled(i)));
    }
    function commit(index) {
      if (!enabled(index)) return;
      const changed = select.selectedIndex !== index;
      select.selectedIndex = index;
      sync();
      trigger.focus({ preventScroll: true });
      if (changed) {
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    function step(direction) {
      let index = active;
      for (let i = 0; i < select.options.length; i++) {
        index = (index + direction + select.options.length) % select.options.length;
        if (enabled(index)) { highlight(index); break; }
      }
    }
    trigger.addEventListener('click', () => menu.hidden ? open() : close());
    trigger.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey) return;
      const wasOpen = !menu.hidden;
      if (event.key === 'Tab') { close(); return; }
      if ((event.key === 'Escape' && wasOpen) || (event.altKey && event.key === 'ArrowUp')) {
        event.preventDefault(); event.stopPropagation(); close(true); return;
      }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (!wasOpen) { open(); return; }
        if (event.key === 'Enter' || event.key === ' ') { commit(active); return; }
        if (event.key === 'Home') highlight([...select.options].findIndex((_, i) => enabled(i)));
        else if (event.key === 'End') highlight([...select.options].findLastIndex((_, i) => enabled(i)));
        else step(event.key === 'ArrowDown' ? 1 : -1);
      } else if (!event.altKey && event.key.length === 1) {
        event.preventDefault();
        if (!wasOpen) open();
        const at = Date.now(); prefix = at - prefixAt < 700 ? prefix + event.key : event.key; prefixAt = at;
        const index = [...select.options].findIndex((option, i) => enabled(i) && option.textContent.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()));
        highlight(index);
      }
    });
    menu.addEventListener('pointerdown', event => event.preventDefault());
    menu.addEventListener('pointermove', event => {
      const option = event.target.closest('[role="option"]');
      if (option) highlight(Number(option.dataset.index));
    });
    menu.addEventListener('click', event => {
      const option = event.target.closest('[role="option"]');
      if (option) commit(Number(option.dataset.index));
    });
    select.addEventListener('change', sync);
    new MutationObserver(sync).observe(select, { childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['disabled', 'selected', 'label', 'value'] });
    const api = { sync, close };
    sync();
    return api;
  }
  document.addEventListener('pointerdown', event => {
    if (opened && !event.target.closest('.capture-safe-trigger, .capture-safe-options')) opened.close();
  }, true);
  window.addEventListener('blur', () => opened?.close());
  window.addEventListener('resize', () => opened?.close());
  document.addEventListener('visibilitychange', () => { if (document.hidden) opened?.close(); });
  document.addEventListener('scroll', event => {
    if (opened && !event.target.closest?.('.capture-safe-options')) opened.close();
  }, true);
  window.CueCaptureSafeSelect = { install, close: () => opened?.close() };
})();
