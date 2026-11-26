const PREFIX = "backbeat:payment-draft:";
const storageListeners = new Set<() => void>();
const logoutListeners = new Set<() => void>();

export function subscribePaymentDrafts(listener: () => void) {
  storageListeners.add(listener);
  return () => { storageListeners.delete(listener); };
}

export function subscribePaymentDraftLogout(listener: () => void) {
  logoutListeners.add(listener);
  return () => { logoutListeners.delete(listener); };
}

export function readPaymentDraft(bookingId: string): string | null {
  try {
    return window.sessionStorage.getItem(PREFIX + bookingId);
  } catch {
    return null;
  }
}

export function writePaymentDraft(bookingId: string, raw: string | null) {
  try {
    if (raw === null) window.sessionStorage.removeItem(PREFIX + bookingId);
    else window.sessionStorage.setItem(PREFIX + bookingId, raw);
  } catch {
    // Blocked storage: the editor still works in memory until a reload.
  }
  for (const listener of storageListeners) listener();
}

export function clearPaymentDrafts() {
  try {
    const storage = window.sessionStorage;
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (key?.startsWith(PREFIX)) storage.removeItem(key);
    }
  } catch {
    // Blocked storage must not prevent signing out.
  }
  for (const listener of storageListeners) listener();
}

export function invalidatePaymentDraftsOnLogout() {
  // Revoke mounted editors first. The server action needn't emit a browser auth event.
  for (const listener of logoutListeners) listener();
  clearPaymentDrafts();
}
