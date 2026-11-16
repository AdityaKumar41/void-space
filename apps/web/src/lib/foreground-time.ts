export function startForegroundTime(onHeartbeat: () => void, intervalMs = 15_000): () => void {
  let timer: number | null = null;
  const stop = () => {
    if (timer === null) return;
    window.clearInterval(timer);
    timer = null;
    onHeartbeat();
  };
  const syncVisibility = () => {
    if (document.visibilityState === 'visible' && timer === null) {
      onHeartbeat();
      timer = window.setInterval(onHeartbeat, intervalMs);
    } else if (document.visibilityState !== 'visible') {
      stop();
    }
  };

  document.addEventListener('visibilitychange', syncVisibility);
  syncVisibility();
  return () => {
    document.removeEventListener('visibilitychange', syncVisibility);
    stop();
  };
}
