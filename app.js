(() => {
  'use strict';

  const STORAGE_ROUTES = 'trasaStudio.savedRoutes.v1';
  const STORAGE_DRAFT = 'trasaStudio.currentDraft.v1';
  const STORAGE_EMBED_KEY = 'trasaStudio.mapsEmbedApiKey.v1';
  const MAX_EMBED_WAYPOINTS = 20; // Official Maps Embed API limit; 22 locations including origin/destination.
  const MODE_CODES = { driving: '0', bicycling: '1', walking: '2', transit: '3' };
  const MODE_LABELS = { driving: 'samochodem', bicycling: 'rowerem', walking: 'pieszo', transit: 'transportem publicznym' };

  const $ = (id) => document.getElementById(id);
  const els = {
    routeName: $('routeName'), travelMode: $('travelMode'), savedRoutes: $('savedRoutes'), stopsList: $('stopsList'),
    stopCount: $('stopCount'), remainingCount: $('remainingCount'), addStopBtn: $('addStopBtn'), reverseStopsBtn: $('reverseStopsBtn'),
    newRouteBtn: $('newRouteBtn'), saveRouteBtn: $('saveRouteBtn'), importBtn: $('importBtn'), importFileInput: $('importFileInput'),
    exportJsonBtn: $('exportJsonBtn'), exportLinkBtn: $('exportLinkBtn'), shareAppBtn: $('shareAppBtn'),
    routeMapFrame: $('routeMapFrame'), mapPlaceholder: $('mapPlaceholder'), mapStatusIcon: $('mapStatusIcon'), mapStatusText: $('mapStatusText'), urlLength: $('urlLength'),
    embedApiKeyInput: $('embedApiKeyInput'), saveEmbedApiKeyBtn: $('saveEmbedApiKeyBtn'), clearEmbedApiKeyBtn: $('clearEmbedApiKeyBtn'),
    embedSegmentControls: $('embedSegmentControls'), embedPrevSegmentBtn: $('embedPrevSegmentBtn'), embedNextSegmentBtn: $('embedNextSegmentBtn'), embedSegmentLabel: $('embedSegmentLabel'),
    searchMapPlaceholder: $('searchMapPlaceholder'),
    openMapsBtn: $('openMapsBtn'), copyLinkBtn: $('copyLinkBtn'), generatedLink: $('generatedLink'), copyGeneratedBtn: $('copyGeneratedBtn'), routeWarning: $('routeWarning'),
    shortLinkInput: $('shortLinkInput'), saveShortLinkBtn: $('saveShortLinkBtn'), savedShortLinkRow: $('savedShortLinkRow'), savedShortLinkAnchor: $('savedShortLinkAnchor'), removeShortLinkBtn: $('removeShortLinkBtn'),
    mapSearchForm: $('mapSearchForm'), mapSearchQuery: $('mapSearchQuery'), searchMapFrame: $('searchMapFrame'), openSearchLink: $('openSearchLink'),
    importDialog: $('importDialog'), importText: $('importText'), chooseImportFileBtn: $('chooseImportFileBtn'), confirmImportBtn: $('confirmImportBtn'), importError: $('importError'), toast: $('toast')
  };

  let state = {
    id: null,
    title: 'Berlin — trasa testowa',
    mode: 'walking',
    stops: [
      'Lichtenberg, Weitlingstraße 22, 10317 Berlin, Germany',
      'Molecule Men, An den Treptowers 1, 12435 Berlin, Germany',
      'Holzmarkt 25, Holzmarktstraße 25, 10243 Berlin, Germany',
      'East Side Gallery, Mühlenstraße, 10243 Berlin, Germany'
    ],
    shortLink: ''
  };
  let savedRoutes = [];
  let renderTimer = null;
  let toastTimer = null;
  let draggedIndex = null;
  let embedApiKey = '';
  let previewSegmentIndex = 0;

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function uuid() { return `route-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
  function cleanTitle(value) { return (value || '').trim().slice(0, 100) || 'Moja trasa'; }
  function completeStops() { return state.stops.map(v => String(v || '').trim()); }
  function hasBlankStops() { return completeStops().some(v => !v); }
  function validStops() { return completeStops().filter(Boolean); }

  // Mirrors the custom Maps path format discussed in this session.
  // This is deliberately not the documented ?api=1&waypoints=... format.
  function encodePathPlace(place) {
    return encodeURIComponent(place.trim())
      .replace(/%20/g, '+')
      .replace(/%2C/gi, ',');
  }

  function buildDirectionsUrl() {
    const stops = completeStops();
    if (stops.length < 2 || stops.some(v => !v)) return '';
    const routePath = stops.map(encodePathPlace).join('/');
    const code = MODE_CODES[state.mode] || MODE_CODES.walking;
    return `https://www.google.com/maps/dir/${routePath}/data=!4m2!4m1!3e${code}?entry=ttu`;
  }

  // The regular Google Maps web UI blocks framing via X-Frame-Options.
  // For in-app maps use the official Maps Embed API, which requires a user-provided key.
  // The Embed API allows up to 20 intermediate waypoints: 22 stops including origin/destination.
  function buildRouteChunks(stops = completeStops()) {
    if (stops.length < 2 || stops.some(stop => !String(stop || '').trim())) return [];
    const maxLocations = MAX_EMBED_WAYPOINTS + 2;
    const chunks = [];
    let start = 0;
    while (start < stops.length - 1) {
      const end = Math.min(start + maxLocations - 1, stops.length - 1);
      chunks.push(stops.slice(start, end + 1));
      start = end; // Share the previous chunk's final stop as the next chunk's origin.
    }
    return chunks;
  }

  function buildDirectionsEmbedUrl(stops) {
    if (!embedApiKey || !Array.isArray(stops) || stops.length < 2) return '';
    const params = new URLSearchParams();
    params.set('key', embedApiKey);
    params.set('origin', stops[0]);
    params.set('destination', stops[stops.length - 1]);
    if (stops.length > 2) params.set('waypoints', stops.slice(1, -1).join('|'));
    params.set('mode', state.mode || 'walking');
    return `https://www.google.com/maps/embed/v1/directions?${params.toString()}`;
  }

  function setIframeSource(frame, url) {
    const current = frame.getAttribute('src') || '';
    if (url) {
      if (current !== url) frame.setAttribute('src', url);
    } else if (current) {
      frame.removeAttribute('src');
    }
  }

  function updateEmbedSegmentControls(chunks) {
    const canPreview = Boolean(embedApiKey) && chunks.length > 1;
    els.embedSegmentControls.hidden = !canPreview;
    if (!canPreview) return;
    previewSegmentIndex = Math.max(0, Math.min(previewSegmentIndex, chunks.length - 1));
    const start = chunks.slice(0, previewSegmentIndex).reduce((total, chunk) => total + chunk.length - 1, 0) + 1;
    const end = start + chunks[previewSegmentIndex].length - 1;
    els.embedSegmentLabel.textContent = `Odcinek ${previewSegmentIndex + 1} z ${chunks.length} · punkty ${start}–${end}`;
    els.embedPrevSegmentBtn.disabled = previewSegmentIndex === 0;
    els.embedNextSegmentBtn.disabled = previewSegmentIndex >= chunks.length - 1;
  }

  function updateSearchMap(query = '') {
    const term = String(query || '').trim();
    const searchUrl = term
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(term)}`
      : 'https://www.google.com/maps/search/?api=1';
    els.openSearchLink.href = searchUrl;
    if (embedApiKey && term) {
      const params = new URLSearchParams({ key: embedApiKey, q: term });
      setIframeSource(els.searchMapFrame, `https://www.google.com/maps/embed/v1/search?${params.toString()}`);
      els.searchMapPlaceholder.classList.remove('visible');
    } else {
      setIframeSource(els.searchMapFrame, '');
      els.searchMapPlaceholder.classList.add('visible');
      if (term) {
        // Keep search useful even when the user has not configured an Embed API key.
        window.open(searchUrl, '_blank', 'noopener,noreferrer');
      }
    }
  }

  function loadEmbedApiKey() {
    try { embedApiKey = (localStorage.getItem(STORAGE_EMBED_KEY) || '').trim(); }
    catch { embedApiKey = ''; }
    if (embedApiKey) els.embedApiKeyInput.value = embedApiKey;
  }

  function decodePathPlace(value) {
    try { return decodeURIComponent(value.replace(/\+/g, '%20')); }
    catch { return value.replace(/\+/g, ' '); }
  }

  function extractPossibleUrl(text) {
    const input = String(text || '').trim();
    const match = input.match(/https?:\/\/[^\s<>"']+/i);
    return (match ? match[0] : input).replace(/[\])},.;]+$/, '');
  }

  function parseDirectionsUrl(rawValue) {
    const value = extractPossibleUrl(rawValue);
    let url;
    try { url = new URL(value); } catch { throw new Error('To nie wygląda na prawidłowy adres URL. Wklej pełny link Google Maps Directions lub plik JSON.'); }
    const host = url.hostname.toLowerCase();
    if (host === 'maps.app.goo.gl' || host === 'goo.gl' || host.endsWith('.goo.gl')) {
      throw new Error('To skrócony link Google Maps. Przeglądarka nie pozwala rozwinąć go lokalnie bez żądania do Google. Wklej pełny link /maps/dir/… albo zapisz go w polu „Krótki link Google Maps”.');
    }

    // Standard Maps URL form: /maps/dir/?api=1&origin=...&destination=...&waypoints=...
    if (url.pathname.includes('/maps/dir') && (url.searchParams.has('origin') || url.searchParams.has('destination'))) {
      const origin = url.searchParams.get('origin') || '';
      const destination = url.searchParams.get('destination') || '';
      const waypoints = (url.searchParams.get('waypoints') || '').split('|').filter(Boolean);
      const stops = [origin, ...waypoints, destination].map(s => s.trim()).filter(Boolean);
      if (stops.length < 2) throw new Error('Link zawiera mniej niż dwa rozpoznane punkty.');
      const modeName = url.searchParams.get('travelmode') || 'walking';
      return { title: 'Zaimportowana trasa', stops, mode: MODE_CODES[modeName] !== undefined ? modeName : 'walking', shortLink: '' };
    }

    const marker = '/maps/dir/';
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex < 0) throw new Error('Nie znaleziono ścieżki /maps/dir/ w tym adresie. Otwórz Google Maps i skopiuj pełny link z wyznaczoną trasą.');
    let path = url.pathname.slice(markerIndex + marker.length);
    const segments = path.split('/');
    const dataIndex = segments.findIndex(segment => segment.startsWith('data='));
    const routeSegments = (dataIndex >= 0 ? segments.slice(0, dataIndex) : segments).filter(Boolean);
    const stops = routeSegments.map(decodePathPlace).map(s => s.trim()).filter(Boolean);
    if (stops.length < 2) throw new Error('Nie udało się odczytać co najmniej dwóch punktów z linku. Upewnij się, że to pełna trasa w formacie /maps/dir/punkt-1/punkt-2/… .');

    let mode = 'walking';
    const routeData = segments.find(segment => segment.startsWith('data=')) || '';
    const codeMatch = routeData.match(/!3e([0-3])/);
    if (codeMatch) mode = ({ '0': 'driving', '1': 'bicycling', '2': 'walking', '3': 'transit' })[codeMatch[1]] || 'walking';
    return { title: 'Zaimportowana trasa', stops, mode, shortLink: '' };
  }

  function normaliseRoute(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('Plik JSON nie zawiera obiektu trasy.');
    let sourceStops = obj.stops || obj.points || obj.waypoints;
    if (!Array.isArray(sourceStops) && typeof obj.url === 'string') return parseDirectionsUrl(obj.url);
    if (!Array.isArray(sourceStops) && typeof obj.googleMapsUrl === 'string') return parseDirectionsUrl(obj.googleMapsUrl);
    if (!Array.isArray(sourceStops)) throw new Error('Nie znaleziono tablicy „stops” w danych JSON.');
    const stops = sourceStops.map(item => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') return String(item.address || item.location || item.name || item.label || '').trim();
      return '';
    }).filter(Boolean);
    if (stops.length < 2) throw new Error('Trasa musi zawierać co najmniej dwa niepuste punkty.');
    const mode = ['walking', 'driving', 'bicycling', 'transit'].includes(obj.mode) ? obj.mode : 'walking';
    return { id: obj.id || null, title: cleanTitle(obj.title || obj.name || 'Zaimportowana trasa'), stops, mode, shortLink: typeof obj.shortLink === 'string' ? obj.shortLink : '' };
  }

  function routeExportObject(route = state) {
    return {
      format: 'trasa-studio-v1',
      id: route.id || null,
      title: cleanTitle(route.title),
      mode: route.mode || 'walking',
      stops: route.stops.map(s => String(s || '').trim()),
      googleMapsUrl: route === state ? buildDirectionsUrl() : buildDirectionsUrlFor(route),
      shortLink: route.shortLink || '',
      exportedAt: new Date().toISOString()
    };
  }

  function buildDirectionsUrlFor(route) {
    const stops = (route.stops || []).map(s => String(s || '').trim());
    if (stops.length < 2 || stops.some(s => !s)) return '';
    const code = MODE_CODES[route.mode] || MODE_CODES.walking;
    return `https://www.google.com/maps/dir/${stops.map(encodePathPlace).join('/')}/data=!4m2!4m1!3e${code}?entry=ttu`;
  }

  function persistDraft() {
    try { localStorage.setItem(STORAGE_DRAFT, JSON.stringify({ ...state, title: cleanTitle(state.title) })); }
    catch { /* Local storage can be disabled or full; the app remains usable in memory. */ }
  }

  function loadStorage() {
    try {
      const parsedRoutes = JSON.parse(localStorage.getItem(STORAGE_ROUTES) || '[]');
      if (Array.isArray(parsedRoutes)) savedRoutes = parsedRoutes.filter(r => r && Array.isArray(r.stops)).slice(0, 300);
      const draft = JSON.parse(localStorage.getItem(STORAGE_DRAFT) || 'null');
      if (draft && Array.isArray(draft.stops)) {
        state = { id: draft.id || null, title: cleanTitle(draft.title), mode: ['walking', 'driving', 'bicycling', 'transit'].includes(draft.mode) ? draft.mode : 'walking', stops: draft.stops.map(s => String(s || '')), shortLink: typeof draft.shortLink === 'string' ? draft.shortLink : '' };
      }
    } catch { savedRoutes = []; }
  }

  function persistSavedRoutes() {
    try { localStorage.setItem(STORAGE_ROUTES, JSON.stringify(savedRoutes)); }
    catch { showToast('Nie udało się zapisać biblioteki. Wyeksportuj trasy do pliku JSON.', true); }
  }

  function renderSavedRoutes() {
    const previous = state.id || '';
    els.savedRoutes.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = savedRoutes.length ? 'Wybierz zapisaną trasę…' : 'Brak zapisanych tras';
    els.savedRoutes.append(placeholder);
    savedRoutes.forEach(route => {
      const option = document.createElement('option');
      option.value = route.id;
      option.textContent = `${route.title || 'Moja trasa'} · ${(route.stops || []).length} pkt.`;
      els.savedRoutes.append(option);
    });
    els.savedRoutes.value = previous && savedRoutes.some(r => r.id === previous) ? previous : '';
  }

  function renderStops(focusLast = false) {
    els.stopsList.replaceChildren();
    state.stops.forEach((stop, index) => {
      const row = document.createElement('li');
      row.className = `stop-row${index === 0 ? ' is-start' : ''}${index === state.stops.length - 1 ? ' is-end' : ''}`;
      row.dataset.index = String(index);
      row.draggable = false;

      const drag = document.createElement('button');
      drag.type = 'button'; drag.className = 'drag-handle'; drag.textContent = '⠿';
      drag.title = 'Przeciągnij, aby zmienić kolejność'; drag.setAttribute('aria-label', `Uchwyt do zmiany kolejności punktu ${index + 1}`);
      drag.draggable = true; drag.dataset.dragHandle = 'true';
      const number = document.createElement('span'); number.className = 'stop-index'; number.textContent = String(index + 1);
      const main = document.createElement('div'); main.className = 'stop-main';
      const input = document.createElement('input'); input.className = 'text-field stop-input'; input.type = 'text'; input.value = stop;
      input.maxLength = 300; input.dataset.stopInput = 'true'; input.dataset.index = String(index);
      input.placeholder = index === 0 ? 'Adres punktu początkowego' : index === state.stops.length - 1 ? 'Adres punktu końcowego' : 'Nazwa atrakcji lub adres';
      input.setAttribute('aria-label', `Punkt ${index + 1}`);
      const caption = document.createElement('small'); caption.className = 'stop-caption';
      caption.textContent = index === 0 ? 'START · PUNKT POCZĄTKOWY' : index === state.stops.length - 1 ? 'META · PUNKT KOŃCOWY' : 'PRZYSTANEK POŚREDNI';
      main.append(input, caption);
      const actions = document.createElement('div'); actions.className = 'stop-actions';
      const up = makeStopAction('↑', 'Przenieś punkt wyżej', 'move-up', index === 0);
      const down = makeStopAction('↓', 'Przenieś punkt niżej', 'move-down', index === state.stops.length - 1);
      const duplicate = makeStopAction('+', 'Duplikuj punkt', 'duplicate', false);
      const remove = makeStopAction('×', 'Usuń punkt', 'remove', false); remove.classList.add('delete-stop');
      actions.append(up, down, duplicate, remove);
      row.append(drag, number, main, actions);
      els.stopsList.append(row);
    });
    updateCounter();
    if (focusLast) {
      const last = els.stopsList.querySelector('li:last-child .stop-input');
      if (last) { last.focus(); last.select(); }
    }
  }

  function makeStopAction(symbol, title, action, disabled) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = `stop-action ${action}`; btn.textContent = symbol; btn.title = title;
    btn.setAttribute('aria-label', title); btn.dataset.action = action; btn.disabled = disabled;
    return btn;
  }

  function updateCounter() {
    els.stopCount.textContent = String(state.stops.length);
    els.remainingCount.textContent = 'Bez limitu punktów na trasę';
    els.addStopBtn.disabled = false;
    els.addStopBtn.style.opacity = '1';
    els.addStopBtn.style.cursor = 'pointer';
  }

  function updateShortLinkUI() {
    const link = (state.shortLink || '').trim();
    els.shortLinkInput.value = link;
    els.savedShortLinkRow.hidden = !link;
    if (link) {
      els.savedShortLinkAnchor.href = link;
      els.savedShortLinkAnchor.textContent = link;
    }
  }

  function updateRoutePreview({ immediate = false } = {}) {
    window.clearTimeout(renderTimer);
    const doUpdate = () => {
      const blanks = hasBlankStops();
      const routeUrl = buildDirectionsUrl();
      const count = state.stops.length;
      els.generatedLink.value = routeUrl;
      els.urlLength.textContent = `${routeUrl.length.toLocaleString('pl-PL')} znaków`;
      const canOpen = !!routeUrl && !blanks;
      els.openMapsBtn.disabled = !canOpen;
      els.copyLinkBtn.disabled = !canOpen;
      els.copyGeneratedBtn.disabled = !canOpen;
      els.openMapsBtn.style.opacity = canOpen ? '1' : '.48';
      els.copyLinkBtn.style.opacity = canOpen ? '1' : '.48';
      els.copyGeneratedBtn.style.opacity = canOpen ? '1' : '.48';

      if (blanks) {
        setIframeSource(els.routeMapFrame, '');
        els.embedSegmentControls.hidden = true;
        els.mapStatusIcon.textContent = '!';
        els.mapStatusText.textContent = 'Uzupełnij puste pola punktów, aby odświeżyć trasę.';
        els.routeWarning.hidden = false;
        els.routeWarning.textContent = 'Co najmniej jeden punkt jest pusty. Uzupełnij go lub usuń pusty wiersz; dzięki temu kolejność na liście i w linku będzie jednoznaczna.';
        els.mapPlaceholder.classList.add('visible');
        els.mapPlaceholder.querySelector('strong').textContent = 'Dokończ wpisywanie punktów';
        els.mapPlaceholder.querySelector('p').textContent = 'Wszystkie wiersze muszą zawierać nazwę miejsca lub adres.';
        return;
      }
      if (count < 2 || !routeUrl) {
        setIframeSource(els.routeMapFrame, '');
        els.embedSegmentControls.hidden = true;
        els.mapStatusIcon.textContent = '↗';
        els.mapStatusText.textContent = 'Dodaj przynajmniej dwa punkty.';
        els.routeWarning.hidden = true;
        els.mapPlaceholder.classList.add('visible');
        els.mapPlaceholder.querySelector('strong').textContent = 'Twoja trasa pojawi się tutaj';
        els.mapPlaceholder.querySelector('p').textContent = 'Dodaj minimum dwa kompletne punkty, aby zobaczyć trasę.';
        return;
      }

      els.routeWarning.hidden = routeUrl.length <= 2048;
      if (routeUrl.length > 2048) {
        els.routeWarning.textContent = `Link ma ${routeUrl.length.toLocaleString('pl-PL')} znaków — przekracza 2048 znaków opisane w dokumentacji standardowych Maps URLs. Używany tu niestandardowy format ścieżki bywa akceptowany, ale Google nie gwarantuje go dla każdej przeglądarki ani dla bardzo długich tras.`;
      }

      const chunks = buildRouteChunks();
      updateEmbedSegmentControls(chunks);
      if (embedApiKey) {
        const safeIndex = Math.max(0, Math.min(previewSegmentIndex, chunks.length - 1));
        previewSegmentIndex = safeIndex;
        setIframeSource(els.routeMapFrame, buildDirectionsEmbedUrl(chunks[safeIndex]));
        els.mapPlaceholder.classList.remove('visible');
        els.mapStatusIcon.textContent = '↗';
        els.mapStatusText.textContent = chunks.length > 1
          ? `${count} punktów · ${MODE_LABELS[state.mode] || 'pieszo'} · podgląd odcinka ${safeIndex + 1}/${chunks.length}`
          : `${count} punktów · ${MODE_LABELS[state.mode] || 'pieszo'} · kolejność zachowana`;
      } else {
        setIframeSource(els.routeMapFrame, '');
        els.mapPlaceholder.classList.add('visible');
        els.mapPlaceholder.querySelector('strong').textContent = 'Google blokuje zwykły link w iframe';
        els.mapPlaceholder.querySelector('p').textContent = 'Wpisz opcjonalny klucz Maps Embed API powyżej, aby osadzić podgląd. Pełna niestandardowa trasa otworzy się w Google Maps po kliknięciu przycisku.';
        els.mapStatusIcon.textContent = 'i';
        els.mapStatusText.textContent = `${count} punktów · link gotowy · podgląd iframe wymaga klucza API`;
      }
      persistDraft();
    };
    if (immediate) doUpdate(); else renderTimer = window.setTimeout(doUpdate, 600);
  }

  function syncStateFromFields() {
    state.title = cleanTitle(els.routeName.value);
    state.mode = els.travelMode.value;
    updateRoutePreview();
    persistDraft();
  }

  function renderAll({ focusLast = false, immediate = true } = {}) {
    els.routeName.value = state.title;
    els.travelMode.value = state.mode;
    renderStops(focusLast);
    updateShortLinkUI();
    updateRoutePreview({ immediate });
    renderSavedRoutes();
    persistDraft();
  }

  function showToast(message, isError = false) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.toggle('error-toast', isError);
    els.toast.classList.add('visible');
    toastTimer = window.setTimeout(() => els.toast.classList.remove('visible'), 3200);
  }

  async function copyText(text, successMessage = 'Skopiowano do schowka.') {
    if (!text) { showToast('Nie ma jeszcze kompletnego linku do skopiowania.', true); return; }
    try {
      await navigator.clipboard.writeText(text);
      showToast(successMessage);
    } catch {
      const helper = document.createElement('textarea'); helper.value = text; helper.setAttribute('readonly', '');
      helper.style.position = 'fixed'; helper.style.opacity = '0'; helper.style.pointerEvents = 'none';
      document.body.append(helper); helper.select();
      let succeeded = false;
      try { succeeded = document.execCommand('copy'); } catch { succeeded = false; }
      helper.remove();
      showToast(succeeded ? successMessage : 'Nie udało się skopiować automatycznie. Zaznacz i skopiuj tekst z pola linku.', !succeeded);
    }
  }

  function downloadFile(filename, content, mime = 'application/json;charset=utf-8') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.style.display = 'none';
    document.body.append(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function slugify(value) {
    return cleanTitle(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trasa';
  }

  function saveCurrentRoute() {
    const stops = completeStops();
    if (stops.length < 2 || stops.some(v => !v)) { showToast('Uzupełnij przynajmniej dwa punkty przed zapisem.', true); return; }
    state.title = cleanTitle(els.routeName.value);
    state.mode = els.travelMode.value;
    let route = state.id ? savedRoutes.find(r => r.id === state.id) : null;
    const payload = { id: state.id || uuid(), title: state.title, mode: state.mode, stops: [...state.stops], shortLink: state.shortLink || '', updatedAt: new Date().toISOString() };
    if (route) Object.assign(route, payload);
    else { route = payload; savedRoutes.unshift(route); }
    state.id = route.id;
    persistSavedRoutes(); persistDraft(); renderSavedRoutes();
    els.savedRoutes.value = state.id;
    showToast(`Zapisano trasę „${state.title}” (${state.stops.length} pkt.).`);
  }

  function loadSavedRoute(id) {
    const route = savedRoutes.find(r => r.id === id);
    if (!route) return;
    state = { id: route.id, title: cleanTitle(route.title), mode: route.mode || 'walking', stops: route.stops.map(s => String(s || '')), shortLink: route.shortLink || '' };
    renderAll(); showToast(`Wczytano trasę „${state.title}”.`);
  }

  function newRoute() {
    state = { id: null, title: 'Nowa trasa', mode: 'walking', stops: ['', ''], shortLink: '' };
    renderAll({ focusLast: true });
    showToast('Utworzono nową trasę. Wpisz pierwszy i ostatni punkt.');
  }

  function moveStop(index, offset) {
    const destination = index + offset;
    if (destination < 0 || destination >= state.stops.length) return;
    const [item] = state.stops.splice(index, 1); state.stops.splice(destination, 0, item);
    renderAll();
  }

  function handleStopAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const row = button.closest('.stop-row'); if (!row) return;
    const index = Number(row.dataset.index);
    if (button.dataset.action === 'move-up') moveStop(index, -1);
    if (button.dataset.action === 'move-down') moveStop(index, 1);
    if (button.dataset.action === 'duplicate') {
      state.stops.splice(index + 1, 0, state.stops[index]);
      renderAll({ focusLast: false });
      const copiedRow = els.stopsList.querySelectorAll('.stop-row')[index + 1];
      if (copiedRow) { const input = copiedRow.querySelector('.stop-input'); input.focus(); input.select(); }
    }
    if (button.dataset.action === 'remove') {
      state.stops.splice(index, 1);
      if (!state.stops.length) state.stops = [''];
      renderAll();
    }
  }

  function addStop() {
    state.stops.push(''); renderAll({ focusLast: true });
  }

  function routeAsShareUrl() {
    if (window.location.protocol === 'file:' || state.stops.length < 2 || hasBlankStops()) return ''; 
    const payload = { title: state.title, mode: state.mode, stops: state.stops, shortLink: state.shortLink || '' };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    return `${window.location.href.split('#')[0]}#trip=${encoded}`;
  }

  function restoreShareUrl() {
    const match = window.location.hash.match(/#trip=([A-Za-z0-9_-]+)/);
    if (!match) return false;
    try {
      const base64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
      const json = decodeURIComponent(escape(atob(padded)));
      const parsed = normaliseRoute(JSON.parse(json));
      state = { id: null, title: parsed.title || 'Udostępniona trasa', mode: parsed.mode, stops: parsed.stops, shortLink: parsed.shortLink || '' };
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      return true;
    } catch (error) { showToast(`Nie udało się otworzyć linku aplikacji: ${error.message}`, true); return false; }
  }

  function importTextValue(value) {
    const text = String(value || '').trim();
    if (!text) throw new Error('Wklej link lub dane do zaimportowania.');
    if (/^https?:\/\//i.test(extractPossibleUrl(text))) return parseDirectionsUrl(text);
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error('Nie udało się odczytać danych. Sprawdź, czy wklejasz pełny link Google Maps lub poprawny plik JSON.'); }
    if (Array.isArray(parsed)) {
      if (parsed.every(item => item && Array.isArray(item.stops))) {
        savedRoutes = parsed.map(route => ({ ...normaliseRoute(route), id: route.id || uuid() }));
        persistSavedRoutes(); renderSavedRoutes();
        return { libraryImported: savedRoutes.length };
      }
      throw new Error('Tablica JSON powinna zawierać zapisane obiekty tras z polem „stops”.');
    }
    if (parsed.routes && Array.isArray(parsed.routes)) {
      savedRoutes = parsed.routes.map(route => ({ ...normaliseRoute(route), id: route.id || uuid() }));
      persistSavedRoutes(); renderSavedRoutes();
      return { libraryImported: savedRoutes.length };
    }
    return normaliseRoute(parsed);
  }

  function applyImport(value) {
    try {
      const parsed = importTextValue(value);
      if (parsed && parsed.libraryImported !== undefined) {
        els.importError.hidden = true; els.importDialog.close();
        showToast(`Zaimportowano ${parsed.libraryImported} tras do biblioteki.`); return;
      }
      state = { id: null, title: cleanTitle(parsed.title || 'Zaimportowana trasa'), mode: parsed.mode || 'walking', stops: parsed.stops, shortLink: parsed.shortLink || '' };
      renderAll(); els.importError.hidden = true; els.importDialog.close();
      showToast(`Zaimportowano ${state.stops.length} punktów.`);
    } catch (error) {
      els.importError.textContent = error.message || 'Nie udało się zaimportować danych.';
      els.importError.hidden = false;
    }
  }

  function setupEvents() {
    els.routeName.addEventListener('input', syncStateFromFields);
    els.travelMode.addEventListener('change', syncStateFromFields);
    els.stopsList.addEventListener('input', event => {
      const input = event.target.closest('[data-stop-input]');
      if (!input) return;
      const index = Number(input.dataset.index);
      if (index >= 0 && index < state.stops.length) state.stops[index] = input.value;
      updateRoutePreview(); persistDraft();
    });
    els.stopsList.addEventListener('change', () => { updateRoutePreview({ immediate: true }); persistDraft(); });
    els.stopsList.addEventListener('click', handleStopAction);
    els.stopsList.addEventListener('dragstart', event => {
      const handle = event.target.closest('[data-drag-handle]');
      const row = handle && handle.closest('.stop-row');
      if (!row) { event.preventDefault(); return; }
      draggedIndex = Number(row.dataset.index); row.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(draggedIndex));
    });
    els.stopsList.addEventListener('dragover', event => {
      const row = event.target.closest('.stop-row'); if (!row || draggedIndex === null) return;
      event.preventDefault(); els.stopsList.querySelectorAll('.drag-target').forEach(r => r.classList.remove('drag-target'));
      row.classList.add('drag-target'); event.dataTransfer.dropEffect = 'move';
    });
    els.stopsList.addEventListener('dragleave', event => { const row = event.target.closest('.stop-row'); if (row && !row.contains(event.relatedTarget)) row.classList.remove('drag-target'); });
    els.stopsList.addEventListener('drop', event => {
      const row = event.target.closest('.stop-row'); if (!row || draggedIndex === null) return;
      event.preventDefault(); const destination = Number(row.dataset.index);
      if (destination !== draggedIndex) { const [item] = state.stops.splice(draggedIndex, 1); state.stops.splice(destination, 0, item); }
      draggedIndex = null; renderAll();
    });
    els.stopsList.addEventListener('dragend', () => { draggedIndex = null; els.stopsList.querySelectorAll('.dragging,.drag-target').forEach(r => r.classList.remove('dragging', 'drag-target')); });
    els.addStopBtn.addEventListener('click', addStop);
    els.reverseStopsBtn.addEventListener('click', () => { state.stops.reverse(); renderAll(); showToast('Odwrócono kolejność punktów.'); });
    els.newRouteBtn.addEventListener('click', newRoute);
    els.saveRouteBtn.addEventListener('click', saveCurrentRoute);
    els.savedRoutes.addEventListener('change', () => { if (els.savedRoutes.value) loadSavedRoute(els.savedRoutes.value); });
    els.importBtn.addEventListener('click', () => { els.importText.value = ''; els.importError.hidden = true; els.importDialog.showModal(); });
    els.chooseImportFileBtn.addEventListener('click', () => els.importFileInput.click());
    els.confirmImportBtn.addEventListener('click', () => applyImport(els.importText.value));
    els.importFileInput.addEventListener('change', async () => {
      const file = els.importFileInput.files && els.importFileInput.files[0]; if (!file) return;
      try { const contents = await file.text(); els.importText.value = contents; applyImport(contents); }
      catch { showToast('Nie udało się odczytać pliku.', true); }
      finally { els.importFileInput.value = ''; }
    });
    els.exportJsonBtn.addEventListener('click', () => {
      const all = savedRoutes.length ? savedRoutes.map(route => routeExportObject(route)) : [];
      const currentObject = routeExportObject();
      if (state.id && all.some(route => route.id === state.id)) {
        downloadFile(`${slugify(state.title)}.json`, JSON.stringify(currentObject, null, 2));
      } else if (savedRoutes.length > 0) {
        const choice = window.confirm('OK — eksportuj całą bibliotekę tras. Anuluj — eksportuj tylko aktualną trasę.');
        downloadFile(choice ? 'trasa-studio-biblioteka.json' : `${slugify(state.title)}.json`, JSON.stringify(choice ? all : currentObject, null, 2));
      } else downloadFile(`${slugify(state.title)}.json`, JSON.stringify(currentObject, null, 2));
      showToast('Przygotowano eksport JSON.');
    });
    els.exportLinkBtn.addEventListener('click', () => {
      const link = buildDirectionsUrl();
      if (!link) { showToast('Uzupełnij wszystkie punkty, aby wyeksportować link.', true); return; }
      const body = `${cleanTitle(state.title)}\n${link}${state.shortLink ? `\n\nKrótki link Google Maps:\n${state.shortLink}` : ''}\n`;
      downloadFile(`${slugify(state.title)}-link.txt`, body, 'text/plain;charset=utf-8'); showToast('Wyeksportowano link do pliku TXT.');
    });
    els.shareAppBtn.addEventListener('click', async () => {
      const url = routeAsShareUrl();
      if (!url) { showToast('Najpierw opublikuj aplikację na GitHub Pages — link do aplikacji działa po hostingu.', true); return; }
      await copyText(url, 'Skopiowano link do aplikacji z osadzoną trasą.');
    });
    els.saveEmbedApiKeyBtn.addEventListener('click', () => {
      embedApiKey = els.embedApiKeyInput.value.trim();
      try {
        if (embedApiKey) localStorage.setItem(STORAGE_EMBED_KEY, embedApiKey);
        else localStorage.removeItem(STORAGE_EMBED_KEY);
      } catch { showToast('Nie udało się zapisać klucza w localStorage.', true); }
      previewSegmentIndex = 0;
      updateRoutePreview({ immediate: true });
      const query = els.mapSearchQuery.value.trim();
      if (query) updateSearchMap(query);
      showToast(embedApiKey ? 'Zapisano klucz. Jeśli jest poprawny, mapa pojawi się po chwili.' : 'Wyczyszczono klucz API. Pełna trasa nadal otwiera się w Google Maps.');
    });
    els.clearEmbedApiKeyBtn.addEventListener('click', () => {
      embedApiKey = '';
      els.embedApiKeyInput.value = '';
      try { localStorage.removeItem(STORAGE_EMBED_KEY); } catch { /* Ignore storage restrictions. */ }
      updateRoutePreview({ immediate: true });
      updateSearchMap('');
      showToast('Usunięto klucz API z tej przeglądarki.');
    });
    els.embedPrevSegmentBtn.addEventListener('click', () => {
      previewSegmentIndex = Math.max(0, previewSegmentIndex - 1);
      updateRoutePreview({ immediate: true });
    });
    els.embedNextSegmentBtn.addEventListener('click', () => {
      previewSegmentIndex += 1;
      updateRoutePreview({ immediate: true });
    });
    els.openMapsBtn.addEventListener('click', () => { const link = buildDirectionsUrl(); if (link) window.open(link, '_blank', 'noopener,noreferrer'); });
    els.copyLinkBtn.addEventListener('click', () => copyText(buildDirectionsUrl(), 'Skopiowano link Google Maps.'));
    els.copyGeneratedBtn.addEventListener('click', () => copyText(buildDirectionsUrl(), 'Skopiowano link Google Maps.'));
    els.saveShortLinkBtn.addEventListener('click', () => {
      const value = els.shortLinkInput.value.trim();
      if (!value) { showToast('Wklej krótki link Google Maps.', true); return; }
      let url;
      try { url = new URL(value); } catch { showToast('Wklej prawidłowy adres URL.', true); return; }
      if (!['http:', 'https:'].includes(url.protocol)) { showToast('Link musi zaczynać się od http:// lub https://.', true); return; }
      state.shortLink = url.href; updateShortLinkUI(); persistDraft();
      if (state.id) { const route = savedRoutes.find(r => r.id === state.id); if (route) { route.shortLink = state.shortLink; persistSavedRoutes(); } }
      showToast('Zapisano krótki link razem z aktualną trasą.');
    });
    els.removeShortLinkBtn.addEventListener('click', () => {
      state.shortLink = ''; updateShortLinkUI(); persistDraft();
      const route = savedRoutes.find(r => r.id === state.id); if (route) { route.shortLink = ''; persistSavedRoutes(); }
      showToast('Usunięto krótki link.');
    });
    els.mapSearchForm.addEventListener('submit', event => {
      event.preventDefault();
      const query = els.mapSearchQuery.value.trim();
      if (!query) { showToast('Wpisz nazwę atrakcji lub adres.', true); return; }
      updateSearchMap(query);
      if (embedApiKey) showToast('Załadowano wyszukiwanie w osadzonej mapie (jeśli klucz jest poprawny).');
      else showToast('Google Maps otworzyło wyniki w nowej karcie; iframe wymaga klucza Embed API.');
    });
  }

  loadStorage();
  loadEmbedApiKey();
  const restored = restoreShareUrl();
  setupEvents();
  renderAll();
  updateSearchMap('');
  if (!restored && state.stops.length) showToast('Gotowe. Edytuj punkty lub zaimportuj własny link Google Maps.');
})();
