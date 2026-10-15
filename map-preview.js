(() => {
  'use strict';
  const KEY_STORAGE = 'trasaStudio.mapsEmbedApiKey.v1';
  const MAX_LOCATIONS_PER_REQUEST = 27; // Origin + up to 25 intermediate points + destination.
  const $ = (id) => document.getElementById(id);
  const keyInput = $('embedApiKeyInput');
  const saveKeyButton = $('saveEmbedApiKeyBtn');
  const clearKeyButton = $('clearEmbedApiKeyBtn');
  const mapCanvas = $('routeMapCanvas');
  const routeFrame = $('routeMapFrame');
  const searchFrame = $('searchMapFrame');
  const placeholder = $('mapPlaceholder');
  const statusText = $('mapStatusText');
  const statusIcon = $('mapStatusIcon');
  const warning = $('routeWarning');
  const searchForm = $('mapSearchForm');
  const searchInput = $('mapSearchQuery');
  const searchLink = $('openSearchLink');
  let map = null;
  let Route = null;
  let activeKey = '';
  let apiLoadStarted = false;
  let drawSerial = 0;
  let debounceTimer = 0;
  let toastTimer = 0;
  let overlays = [];
  let lastSignature = '';

  // Do not allow the legacy editor script to assign google.com pages into frames.
  [routeFrame, searchFrame].forEach((frame) => {
    if (!frame) return;
    frame.style.display = 'none';
    const setAttribute = frame.setAttribute.bind(frame);
    const removeAttribute = frame.removeAttribute.bind(frame);
    frame.setAttribute = (name, value) => {
      if (String(name).toLowerCase() === 'src') return;
      return setAttribute(name, value);
    };
    frame.removeAttribute = (name) => {
      if (String(name).toLowerCase() === 'src') return;
      return removeAttribute(name);
    };
  });

  function toast(message, isError = false) {
    const element = $('toast');
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('error-toast', isError);
    element.classList.add('visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => element.classList.remove('visible'), 3300);
  }

  function setStatus(message, icon = '↗') {
    if (statusText) statusText.textContent = message;
    if (statusIcon) statusIcon.textContent = icon;
  }

  function setPlaceholder(title, message, visible = true) {
    if (!placeholder) return;
    const heading = placeholder.querySelector('strong');
    const paragraph = placeholder.querySelector('p');
    if (heading) heading.textContent = title;
    if (paragraph) paragraph.textContent = message;
    placeholder.classList.toggle('visible', visible);
  }

  function showWarning(message, isError = false) {
    if (!warning) return;
    warning.textContent = message;
    warning.hidden = false;
    warning.classList.toggle('error', isError);
  }

  function clearWarning() {
    if (warning) warning.hidden = true;
  }

  function stopsFromEditor() {
    return Array.from(document.querySelectorAll('#stopsList .stop-input')).map((input) => input.value.trim());
  }

  function selectedTravelMode() {
    const value = $('travelMode')?.value || 'walking';
    return ({ walking: 'WALKING', driving: 'DRIVING', bicycling: 'BICYCLING', transit: 'TRANSIT' })[value] || 'WALKING';
  }

  function splitRoute(stops) {
    const result = [];
    let start = 0;
    while (start < stops.length - 1) {
      const end = Math.min(start + MAX_LOCATIONS_PER_REQUEST - 1, stops.length - 1);
      result.push(stops.slice(start, end + 1));
      start = end; // Repeat the last point as the origin of the next chunk.
    }
    return result;
  }

  function clearOverlays() {
    overlays.forEach((overlay) => {
      try {
        if (typeof overlay.setMap === 'function') overlay.setMap(null);
        else if ('map' in overlay) overlay.map = null;
      } catch (_) { /* Ignore cleanup for overlays already removed by Maps. */ }
    });
    overlays = [];
  }

  async function drawRoute(force = false) {
    if (!map || !Route) return;
    const stops = stopsFromEditor();
    const mode = selectedTravelMode();
    if (stops.length < 2 || stops.some((stop) => !stop)) {
      ++drawSerial;
      clearOverlays();
      lastSignature = '';
      setStatus(stops.length < 2 ? 'Dodaj przynajmniej dwa punkty.' : 'Uzupełnij puste pola punktów.', 'i');
      setPlaceholder('Uzupełnij punkty trasy', 'Wpisz przynajmniej dwa kompletne adresy, aby narysować przebieg trasy.');
      return;
    }

    const signature = JSON.stringify([stops, mode]);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    const mySerial = ++drawSerial;
    clearOverlays();
    clearWarning();
    setPlaceholder('Wyznaczanie przebiegu…', 'Google Maps oblicza trasę według kolejności na liście.');
    setStatus(`Wyznaczanie trasy dla ${stops.length} punktów…`, '↻');
    const chunks = splitRoute(stops);
    const bounds = new google.maps.LatLngBounds();
    let boundsHaveData = false;

    try {
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        if (mySerial !== drawSerial) return;
        const chunk = chunks[chunkIndex];
        const request = {
          origin: chunk[0],
          destination: chunk[chunk.length - 1],
          travelMode: mode,
          fields: ['path', 'legs', 'viewport']
        };
        if (chunk.length > 2) request.intermediates = chunk.slice(1, -1).map((address) => ({ location: address }));
        const response = await Route.computeRoutes(request);
        if (mySerial !== drawSerial) return;
        const route = response?.routes?.[0];
        if (!route) throw new Error(`Google nie zwróciło przebiegu odcinka ${chunkIndex + 1}.`);

        const polylines = route.createPolylines({
          polylineOptions: { strokeColor: '#5b64ed', strokeOpacity: 0.94, strokeWeight: 5 }
        });
        polylines.forEach((line) => { line.setMap(map); overlays.push(line); });

        if (route.viewport) {
          bounds.union(route.viewport);
          boundsHaveData = true;
        } else if (Array.isArray(route.path)) {
          route.path.forEach((point) => {
            const lat = typeof point.lat === 'function' ? point.lat() : point.lat;
            const lng = typeof point.lng === 'function' ? point.lng() : point.lng;
            if (Number.isFinite(lat) && Number.isFinite(lng)) bounds.extend({ lat, lng });
          });
          boundsHaveData = true;
        }

        if (typeof route.createWaypointAdvancedMarkers === 'function') {
          const markers = await route.createWaypointAdvancedMarkers();
          markers.forEach((marker, markerIndex) => {
            if (chunkIndex > 0 && markerIndex === 0) {
              marker.map = null; // Hide the duplicated shared boundary point.
              return;
            }
            marker.map = map;
            overlays.push(marker);
          });
        }
      }
      if (mySerial !== drawSerial) return;
      setPlaceholder('', '', false);
      if (boundsHaveData && !bounds.isEmpty()) map.fitBounds(bounds, 48);
      setStatus(`${stops.length} punktów · ${chunks.length} odc. · kolejność zachowana`, '✓');
      if (chunks.length > 1) {
        showWarning(`Podgląd rysuje całą trasę w ${chunks.length} odcinkach ze wspólnymi punktami granicznymi. Kolejność wszystkich ${stops.length} przystanków została zachowana.`);
      } else {
        clearWarning();
      }
    } catch (error) {
      if (mySerial !== drawSerial) return;
      setPlaceholder('', '', false);
      setStatus('Mapa działa; obliczenie trasy się nie powiodło.', '!');
      showWarning(`Nie udało się wyznaczyć trasy: ${error?.message || String(error)}. Mapa pozostaje dostępna. Sprawdź, czy adresy punktów są rozpoznawalne oraz czy dzienny limit Demo Key nie został wykorzystany.`, true);
    }
  }

  function scheduleDraw(force = true) {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => drawRoute(force), 420);
  }

  async function initializeMap() {
    try {
      const mapsLib = await google.maps.importLibrary('maps');
      const routesLib = await google.maps.importLibrary('routes');
      Route = routesLib.Route;
      map = new mapsLib.Map(mapCanvas, {
        center: { lat: 52.5200, lng: 13.4050 },
        zoom: 12,
        mapId: 'DEMO_MAP_ID',
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true
      });
      if (window.google?.maps?.event) google.maps.event.addListenerOnce(map, 'idle', () => scheduleDraw(true));
      await drawRoute(true);
    } catch (error) {
      apiLoadStarted = false;
      setStatus('Nie udało się uruchomić mapy demonstracyjnej.', '!');
      setPlaceholder('Nie udało się uruchomić mapy', `Sprawdź Maps Demo Key i odśwież stronę. ${error?.message || ''}`);
    }
  }

  window.routeStudioMapsReady = initializeMap;
  window.gm_authFailure = () => {
    apiLoadStarted = false;
    setStatus('Google odrzuciło klucz mapy.', '!');
    setPlaceholder('Google odrzuciło klucz', 'Wklej Maps Demo Key przeznaczony do Maps JavaScript API, a nie klucz obsługujący wyłącznie Maps Embed API.');
  };

  function activateMap(key) {
    const candidate = String(key || '').trim();
    if (!candidate) {
      setStatus('Wklej klucz demonstracyjny Maps.', 'i');
      setPlaceholder('Wklej klucz demonstracyjny Maps', 'Kliknij „Uzyskaj klucz demo”, skopiuj klucz i wklej go w polu powyżej.');
      return;
    }
    if (map && Route) {
      if (candidate !== activeKey) {
        toast('Klucz został już użyty do załadowania mapy. Odśwież stronę, aby użyć innego.', true);
        return;
      }
      drawRoute(true);
      return;
    }
    if (apiLoadStarted) return;
    activeKey = candidate;
    apiLoadStarted = true;
    setStatus('Ładowanie mapy Google…', '↻');
    setPlaceholder('Ładowanie mapy…', 'Pobierana jest mapa demonstracyjna.');
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(candidate)}&v=weekly&loading=async&callback=routeStudioMapsReady`;
    script.onerror = () => {
      apiLoadStarted = false;
      setStatus('Nie udało się pobrać Google Maps JavaScript API.', '!');
      setPlaceholder('Błąd ładowania Google Maps', 'Sprawdź połączenie i spróbuj ponownie.');
    };
    document.head.appendChild(script);
  }

  if (saveKeyButton) saveKeyButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const key = keyInput?.value.trim() || '';
    if (!key) return toast('Najpierw wklej Maps Demo Key.', true);
    try { localStorage.setItem(KEY_STORAGE, key); } catch (_) { /* Storage is optional. */ }
    activateMap(key);
    toast('Klucz zapisano lokalnie. Ładowanie mapy…');
  }, true);

  if (clearKeyButton) clearKeyButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    try { localStorage.removeItem(KEY_STORAGE); } catch (_) { /* Storage is optional. */ }
    if (keyInput) keyInput.value = '';
    drawSerial += 1;
    clearOverlays();
    lastSignature = '';
    setPlaceholder('Wklej klucz demonstracyjny Maps', 'Klucz został usunięty z pamięci tej przeglądarki. Odśwież stronę, aby zakończyć bieżącą sesję mapy.');
    setStatus('Usunięto zapisany klucz.', 'i');
    toast('Usunięto klucz z localStorage.');
  }, true);

  if (searchForm) searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const query = searchInput?.value.trim() || '';
    if (!query) return toast('Wpisz nazwę atrakcji lub kategorię.', true);
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    if (searchLink) searchLink.href = url;
    window.open(url, '_blank', 'noopener,noreferrer');
    toast('Wyniki otwarto w nowej karcie Google Maps.');
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    const stopsList = $('stopsList');
    if (stopsList) {
      stopsList.addEventListener('input', () => scheduleDraw(true));
      stopsList.addEventListener('change', () => scheduleDraw(true));
      const observer = new MutationObserver(() => scheduleDraw(true));
      observer.observe(stopsList, { childList: true, subtree: true });
    }
    $('travelMode')?.addEventListener('change', () => scheduleDraw(true));
    let savedKey = '';
    try { savedKey = localStorage.getItem(KEY_STORAGE) || ''; } catch (_) { /* Storage is optional. */ }
    if (savedKey) {
      if (keyInput) keyInput.value = savedKey;
      activateMap(savedKey);
    } else {
      setStatus('Wklej klucz demonstracyjny, aby uruchomić mapę.', 'i');
      setPlaceholder('Wklej klucz demonstracyjny Maps', 'Uzyskaj Maps Demo Key i wklej go powyżej. Mapa zostanie wyświetlona bezpośrednio w aplikacji.');
    }
  });
})();
