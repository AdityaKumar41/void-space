// Pages cannot send COOP/COEP headers. Wait until the isolation worker controls
// this page before reloading; updatefound fires too early on a first visit.
(() => {
  const workerUrl = new URL('coi-serviceworker.js', document.currentScript.src)
  window.VOID_STUDIO_ISOLATION_READY = (async () => {
    const retryKey = 'void-studio-isolation-retry'
    if (window.crossOriginIsolated) {
      sessionStorage.removeItem(retryKey)
      return
    }
    if (!window.isSecureContext || !navigator.serviceWorker) {
      throw new Error('This browser cannot enable the isolation required by Studio. Use a current browser over HTTPS.')
    }
    await navigator.serviceWorker.register(workerUrl)
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, {once: true}))
    }
    if (sessionStorage.getItem(retryKey)) {
      throw new Error('Studio could not enable browser isolation. Allow site data and reload this page.')
    }
    sessionStorage.setItem(retryKey, '1')
    location.reload()
    // The next, isolated document boots the engine; this document must not.
    await new Promise(() => {})
  })()
})()
