/**
 * toast.js — minimal toast notifications.
 *
 * Expects a `#toasts` container (see base.css for styling).
 * Framework-free and safe: messages are inserted via textContent.
 */

const MAX_TOASTS = 4;
const DEFAULT_TIMEOUT_MS = 4500;

/**
 * Show a toast message.
 *
 * @param {string} message Plain-text message (never interpreted as HTML).
 * @param {{ type?: 'info' | 'error' | 'success', timeout?: number }} [options]
 */
export function toast(message, options = {}) {
  const { type = 'info', timeout = DEFAULT_TIMEOUT_MS } = options;
  const root = document.getElementById('toasts');
  if (!root) return;

  // keep the stack bounded — drop the oldest
  while (root.children.length >= MAX_TOASTS) {
    root.firstElementChild?.remove();
  }

  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', 'status');

  const text = document.createElement('p');
  text.textContent = String(message ?? '');

  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.textContent = '×';
  close.addEventListener('click', () => dismiss(el));

  el.append(text, close);
  root.append(el);

  if (timeout > 0) {
    setTimeout(() => dismiss(el), timeout);
  }
}

function dismiss(el) {
  if (!el.isConnected) return;
  el.classList.add('is-leaving');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
  // fallback for environments where the transition never runs
  setTimeout(() => el.remove(), 300);
}
