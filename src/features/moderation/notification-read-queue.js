// Opening several messages must not lose writes while an earlier read is saving.
// Reset discards queued work; the owning inbox also aborts its in-flight models.
export function createNotificationReadQueue({canRun = () => true, onIdle = () => {}} = {}) {
  let epoch = 0, running = false;
  const pending = new Map();
  async function flush() {
    if (running || !pending.size || !canRun()) return;
    const current = epoch;
    running = true;
    try {
      while (current === epoch && pending.size && canRun()) {
        const [key, operation] = pending.entries().next().value;
        try { await operation(); } catch { /* Models retain their own error state. */ }
        if (current === epoch) pending.delete(key);
      }
    } finally { if (current === epoch) {running = false; if (!pending.size) onIdle();} }
  }
  return {
    add(key, operation) {
      if (!pending.has(key)) pending.set(key, operation);
      return flush();
    },
    flush,
    hasWork: () => pending.size > 0,
    reset() { epoch++; pending.clear(); running = false; }
  };
}
