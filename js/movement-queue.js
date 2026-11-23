// Keep one waiting direction so held keys cannot build seconds of old moves.
export function movementQueue(write, onError) {
  let pending, sending = false;
  return async action => {
    pending = action;
    if (sending) return;
    sending = true;
    try {
      while (pending) {
        const next = pending;
        pending = null;
        await write(next);
      }
    } catch (error) {
      pending = null;
      onError(error);
    } finally { sending = false; }
  };
}
