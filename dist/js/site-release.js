// Also inlined into the published HTML so startup never depends on a cached module.
const RELEASE_ID = /^[a-f0-9]{64}$/;

export async function checkForUpdate({ currentId, href, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  if (currentId === 'development') return null;
  if (!RELEASE_ID.test(currentId || '')) throw new Error('Invalid game release.');
  const url = new URL('release.json', new URL('./', href));
  url.searchParams.set('check', now());
  const response = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error('Could not check for an update.');
  const release = await response.json();
  if (!RELEASE_ID.test(release?.id || '')) throw new Error('Invalid game release.');
  if (release.id === currentId) return null;
  const page = new URL(href);
  page.searchParams.set('release', release.id);
  return page.href;
}

export function freshPageUrl(href, now = Date.now()) {
  const url = new URL(href);
  url.searchParams.set('refresh', now);
  return url.href;
}

export async function boot({ document = globalThis.document, location = globalThis.location,
  history = globalThis.history, fetchImpl = globalThis.fetch, loadApp = url => import(url) } = {}) {
  const status = document.getElementById('load-status');
  const retry = document.getElementById('retry-load');
  const currentId = document.querySelector('meta[name="game-release"]').content;
  try {
    const update = await checkForUpdate({ currentId, href: location.href, fetchImpl });
    if (update) {
      if (new URL(location.href).searchParams.get('release') === new URL(update).searchParams.get('release')) {
        throw new Error('The update is still being published. Please try again shortly.');
      }
      status.textContent = 'Updating the game…';
      location.replace(update);
      return false;
    }
    // Update markers are navigation details, never part of a shared invitation.
    const page = new URL(location.href);
    page.searchParams.delete('release');
    page.searchParams.delete('refresh');
    history.replaceState(history.state, '', page.href);
    const path = currentId === 'development' ? './js/app.js' : `./_releases/${currentId}/js/app.js`;
    await loadApp(new URL(path, page).href);
    return true;
  } catch (error) {
    status.textContent = error.message.startsWith('The update is still') ? error.message
      : 'The game couldn’t load. Check your connection and try again.';
    retry.hidden = false;
    retry.textContent = 'Try loading again';
    retry.onclick = () => location.replace(freshPageUrl(location.href));
    return false;
  }
}
