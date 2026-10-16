(() => {
  'use strict';
  const KEY_STORAGE = 'trasaStudio.mapsEmbedApiKey.v1';
  const ROUTE_CACHE_STORAGE = 'trasaStudio.routePreviewCache.v1';
  const MAX_LOCATIONS_PER_REQUEST = 27; // Origin + up to 25 intermediate points + destination.
  const MAX_ROUTE_CACHE_ENTRIES = 32;
  const MAX_PERSISTED_CACHE_CHARS = 750000;
  const ROUTE_DRAW_DEBOUNCE_MS = 800;
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
  let routesQuotaExhausted = false;
  const stopMarkers = new Map();
  const routeCache = new Map();
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

  function stopLabel(index) {
    let value = index + 1;
    let label = '';
    while (value > 0) {
      value -= 1;
      label = String.fromCharCode(65 + value % 26) + label;
      value = Math.floor(value / 26);
    }
    return label;
  }

  function clearOverlays() {
    overlays.forEach((overlay) => {
      try {
        if (typeof overlay.setMap === 'function') overlay.setMap(null);
        else if ('map' in overlay) overlay.map = null;
      } catch (_) { /* Ignore cleanup for overlays already removed by Maps. */ }
    });
    overlays = [];
    stopMarkers.clear();
  }

  function markerContent(label) {
    const pin = document.createElement('div');
    pin.textContent = label;
    Object.assign(pin.style, {
      display: 'grid',
      placeItems: 'center',
      width: '24px',
      height: '24px',
      boxSizing: 'border-box',
      border: '1.5px solid #ffffff',
      borderRadius: '50%',
      background: '#5b64ed',
      color: '#ffffff',
      font: '700 9px/1 "Segoe UI", Arial, sans-serif',
      boxShadow: '0 1px 4px rgba(0,0,0,.55)',
      whiteSpace: 'nowrap'
    });
    return pin;
  }

  function asLatLngLiteral(location) {
    if (!location) return null;
    const lat = typeof location.lat === 'function' ? location.lat() : location.lat;
    const lng = typeof location.lng === 'function' ? location.lng() : location.lng;
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  function routeLegLocation(leg, property, pathIndex) {
    const directLocation = asLatLngLiteral(leg?.[property]);
    if (directLocation) return directLocation;
    const path = Array.isArray(leg?.path) ? leg.path : [];
    return asLatLngLiteral(path[pathIndex < 0 ? path.length - 1 : pathIndex]);
  }

  function routeMarkerPositions(route) {
    const legs = Array.isArray(route?.legs) ? route.legs : [];
    if (!legs.length) return [];
    const positions = [routeLegLocation(legs[0], 'startLocation', 0)];
    legs.forEach((leg) => positions.push(routeLegLocation(leg, 'endLocation', -1)));
    return positions;
  }

  function drawStopMarkers(positions, startIndex, stops, markerLibrary, bounds) {
    positions.forEach((position, offset) => {
      const index = startIndex + offset;
      if (!position || index >= stops.length || stopMarkers.has(index)) return;
      const marker = new markerLibrary.AdvancedMarkerElement({
        map,
        position,
        title: `${stopLabel(index)} · ${stops[index]}`,
        content: markerContent(stopLabel(index)),
        collisionBehavior: google.maps.CollisionBehavior.REQUIRED,
        zIndex: 1000 + index
      });
      stopMarkers.set(index, marker);
      overlays.push(marker);
      bounds.extend(position);
    });
  }

  // RouteLegs are returned by Compute Routes and contain the snapped start/end
  // position of every requested stop. This works with a JS demo key even where
  // createWaypointAdvancedMarkers() is unavailable or yields no markers.
  function drawRouteLegMarkers(route, startIndex, stops, markerLibrary, bounds) {
    drawStopMarkers(routeMarkerPositions(route), startIndex, stops, markerLibrary, bounds);
  }

  function routeCacheKey(mode, chunk) {
    return JSON.stringify([mode, chunk]);
  }

  function snapshotRoute(route) {
    const path = Array.isArray(route?.path) ? route.path.map(asLatLngLiteral).filter(Boolean) : [];
    const positions = routeMarkerPositions(route);
    if (!path.length && !positions.some(Boolean)) return null;
    return { path, positions };
  }

  function trimRouteCache() {
    while (routeCache.size > MAX_ROUTE_CACHE_ENTRIES) routeCache.delete(routeCache.keys().next().value);
  }

  function persistRouteCache() {
    try {
      const records = Array.from(routeCache.entries())
        .filter(([, entry]) => entry.snapshot)
        .map(([key, entry]) => ({ key, snapshot: entry.snapshot }));
      while (records.length && JSON.stringify(records).length > MAX_PERSISTED_CACHE_CHARS) records.shift();
      sessionStorage.setItem(ROUTE_CACHE_STORAGE, JSON.stringify(records));
    } catch (_) { /* Cache is an optimization; storage can be unavailable or full. */ }
  }

  function restoreRouteCache() {
    try {
      const records = JSON.parse(sessionStorage.getItem(ROUTE_CACHE_STORAGE) || '[]');
      if (!Array.isArray(records)) return;
      records.forEach((record) => {
        if (!record || typeof record.key !== 'string' || !record.snapshot
          || !Array.isArray(record.snapshot.path) || !Array.isArray(record.snapshot.positions)) return;
        routeCache.set(record.key, { snapshot: record.snapshot });
      });
      trimRouteCache();
    } catch (_) { /* Ignore an invalid or unavailable session cache. */ }
  }

  function cacheRoute(key, route) {
    routeCache.delete(key);
    routeCache.set(key, { route, snapshot: snapshotRoute(route) });
    trimRouteCache();
    persistRouteCache();
  }

  function cachedRoute(key) {
    const entry = routeCache.get(key);
    if (!entry) return null;
    routeCache.delete(key);
    routeCache.set(key, entry); // LRU: frequently used route segments stay cached.
    return entry;
  }

  function drawRouteDots(path) {
    const positions = Array.isArray(path) ? path.map(asLatLngLiteral).filter(Boolean) : [];
    if (positions.length < 2) return;
    const dots = new google.maps.Polyline({
      path: positions,
      strokeOpacity: 0,
      icons: [{
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 2.5,
          fillColor: '#4c55e6',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeOpacity: 1,
          strokeWeight: 1.35
        },
        offset: '0',
        repeat: '18px'
      }],
      zIndex: 2
    });
    dots.setMap(map);
    overlays.push(dots);
  }

  function drawCachedRoute(snapshot, startIndex, stops, markerLibrary, bounds) {
    if (snapshot.path.length > 1) {
      const line = new google.maps.Polyline({
        path: snapshot.path,
        strokeColor: '#5b64ed',
        strokeOpacity: 0.65,
        strokeWeight: 5,
        zIndex: 1
      });
      line.setMap(map);
      overlays.push(line);
      snapshot.path.forEach((point) => bounds.extend(point));
    }
    drawRouteDots(snapshot.path);
    drawStopMarkers(snapshot.positions, startIndex, stops, markerLibrary, bounds);
  }

  function drawComputedRoute(route, startIndex, stops, markerLibrary, bounds) {
    const polylines = route.createPolylines({
      polylineOptions: { strokeColor: '#5b64ed', strokeOpacity: 0.65, strokeWeight: 5, zIndex: 1 }
    });
    polylines.forEach((line) => { line.setMap(map); overlays.push(line); });
    drawRouteDots(route.path);
    drawRouteLegMarkers(route, startIndex, stops, markerLibrary, bounds);
    if (route.viewport) {
      bounds.union(route.viewport);
    } else if (Array.isArray(route.path)) {
      route.path.forEach((point) => {
        const position = asLatLngLiteral(point);
        if (position) bounds.extend(position);
      });
    }
  }

  // This fallback only uses coordinates already saved with the route. A Maps
  // JavaScript demo key cannot be used to make Geocoding API requests.
  async function drawFallbackMarkers(stops, startIndex, locations, markerLibrary, bounds, serial, unresolved) {
    for (let offset = 0; offset < stops.length; offset += 1) {
      const index = startIndex + offset;
      if (stopMarkers.has(index)) continue;
      try {
        const position = locations[index];
        if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) {
          unresolved.push({ label: stopLabel(index), reason: 'brak współrzędnych w imporcie' });
          continue;
        }
        const marker = new markerLibrary.AdvancedMarkerElement({
          map,
          position,
          title: `${stopLabel(index)} · ${stops[offset]}`,
          content: markerContent(stopLabel(index)),
          collisionBehavior: google.maps.CollisionBehavior.REQUIRED,
          zIndex: 1000 + index
        });
        stopMarkers.set(index, marker);
        overlays.push(marker);
        bounds.extend(position);
      } catch (error) {
        if (serial !== drawSerial) return;
        const reason = error?.message || String(error);
        unresolved.push({ label: stopLabel(index), reason });
      }
    }
  }

  async function drawRoute(force = false) {
    if (!map) return;
    const stops = stopsFromEditor();
    const mode = selectedTravelMode();
    if (stops.length === 0 || stops.some((stop) => !stop)) {
      ++drawSerial;
      clearOverlays();
      lastSignature = '';
      setStatus(stops.length === 0 ? 'Dodaj przynajmniej jeden punkt.' : 'Uzupełnij puste pola punktów.', 'i');
      setPlaceholder('Uzupełnij punkty trasy', 'Wpisz przynajmniej dwa kompletne adresy, aby narysować przebieg trasy.');
      return;
    }

    const signature = JSON.stringify([stops, mode]);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    const mySerial = ++drawSerial;
    clearOverlays();
    clearWarning();
    setPlaceholder('Dodawanie punktów do mapy…', 'Markery są tworzone z odpowiedzi Compute Routes; podgląd nie używa Geocoding API.');
    setStatus(`Dodawanie ${stops.length} punktów do mapy…`, '↻');
    const chunks = splitRoute(stops);
    const bounds = new google.maps.LatLngBounds();
    const routeFailures = [];
    const unresolved = [];
    let successfulChunks = 0;
    let cachedChunks = 0;
    let chunkStartIndex = 0;

    try {
      const markerLibrary = await google.maps.importLibrary('marker');
      if (mySerial !== drawSerial) return;
      let locations = [];
      try {
        locations = JSON.parse($('stopsList').dataset.stopLocations || '[]');
      } catch (error) {
        showWarning(`Nie udało się odczytać zapisanych współrzędnych punktów: ${error.message}`, true);
      }
      setPlaceholder('', '', false);

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        if (mySerial !== drawSerial) return;
        const chunk = chunks[chunkIndex];
        const cacheKey = routeCacheKey(mode, chunk);
        const cached = cachedRoute(cacheKey);
        if (cached) {
          try {
            if (cached.route) drawComputedRoute(cached.route, chunkStartIndex, stops, markerLibrary, bounds);
            else drawCachedRoute(cached.snapshot, chunkStartIndex, stops, markerLibrary, bounds);
            successfulChunks += 1;
            cachedChunks += 1;
          } catch (error) {
            // A cached rendering object can become invalid when Maps reloads; fetch it once more below.
            routeCache.delete(cacheKey);
          }
          if (routeCache.has(cacheKey)) {
            chunkStartIndex += chunk.length - 1;
            continue;
          }
        }
        if (!Route) {
          chunkStartIndex += chunk.length - 1;
          continue;
        }
        if (routesQuotaExhausted) {
          chunkStartIndex += chunk.length - 1;
          continue;
        }
        const request = {
          origin: chunk[0],
          destination: chunk[chunk.length - 1],
          travelMode: mode,
          fields: ['path', 'legs', 'viewport']
        };
        if (chunk.length > 2) request.intermediates = chunk.slice(1, -1).map((address) => ({ location: address }));
        try {
          const response = await Route.computeRoutes(request);
          if (mySerial !== drawSerial) return;
          const route = response?.routes?.[0];
          if (!route) throw new Error(`Google nie zwróciło przebiegu odcinka ${chunkIndex + 1}.`);
          cacheRoute(cacheKey, route);
          drawComputedRoute(route, chunkStartIndex, stops, markerLibrary, bounds);
          successfulChunks += 1;
        } catch (error) {
          if (mySerial !== drawSerial) return;
          const reason = error?.message || String(error);
          if (/RESOURCE_EXHAUSTED|QUOTA_EXCEEDED|quota exceeded/i.test(reason)) {
            routesQuotaExhausted = true;
            routeFailures.push(`limit dzienny Routes API został wyczerpany (odcinek ${chunkIndex + 1})`);
          } else {
            routeFailures.push(`odcinek ${chunkIndex + 1}: ${reason}`);
          }
        }
        chunkStartIndex += chunk.length - 1;
      }
      if (mySerial !== drawSerial) return;
      if (!Route && chunks.length) routeFailures.push('obliczanie przebiegu trasy jest niedostępne');
      await drawFallbackMarkers(stops, 0, locations, markerLibrary, bounds, mySerial, unresolved);
      if (mySerial !== drawSerial) return;
      const locatedCount = stopMarkers.size;
      if (!bounds.isEmpty()) map.fitBounds(bounds, 48);
      setStatus(`${locatedCount}/${stops.length} punktów na mapie · ${successfulChunks}/${chunks.length} odc. trasy${cachedChunks ? ` · ${cachedChunks} z cache` : ''}`, locatedCount === stops.length ? '✓' : '!');
      if (locatedCount === 0 && successfulChunks === 0) {
        setPlaceholder('Nie udało się wyświetlić punktów', 'Sprawdź adresy i klucz Maps. Trasa nie została narysowana.');
      }

      const warnings = [];
      if (routeFailures.length) {
        warnings.push(`Nie udało się narysować ${routeFailures.length} odc. trasy (${routeFailures.join('; ')}).`);
      }
      if (unresolved.length) {
        const missingImportedCoordinates = unresolved.every(point => point.reason === 'brak współrzędnych w imporcie');
        warnings.push(missingImportedCoordinates
          ? `Nie udało się wyświetlić ${unresolved.length} punktów, ponieważ import nie zawiera ich współrzędnych, a odpowiedź Compute Routes nie utworzyła markerów. Podgląd celowo nie korzysta z Geocoding API.`
          : `Nie udało się znaleźć lokalizacji ${unresolved.length} punktów: ${unresolved.map(point => `${point.label} (${point.reason})`).join('; ')}.`);
      }
      if (warnings.length) {
        showWarning(`${warnings.join(' ')} Pozostałe rozpoznane punkty są widoczne na mapie.`, true);
      } else if (chunks.length > 1) {
        showWarning(`Trasa jest rysowana w ${chunks.length} odcinkach ze wspólnymi punktami granicznymi. Wszystkie ${locatedCount} rozpoznane punkty są widoczne na mapie.`);
      } else {
        clearWarning();
      }
    } catch (error) {
      if (mySerial !== drawSerial) return;
      setPlaceholder('Nie udało się przygotować mapy punktów', `Sprawdź klucz Maps. ${error?.message || String(error)}`);
      setStatus('Nie udało się wyświetlić punktów.', '!');
      showWarning(`Nie udało się umieścić punktów na mapie: ${error?.message || String(error)}.`, true);
    }
  }

  function scheduleDraw(force = true) {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => drawRoute(force), ROUTE_DRAW_DEBOUNCE_MS);
  }

  async function initializeMap() {
    try {
      const mapsLib = await google.maps.importLibrary('maps');
      map = new mapsLib.Map(mapCanvas, {
        center: { lat: 52.5200, lng: 13.4050 },
        zoom: 12,
        mapId: 'DEMO_MAP_ID',
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true
      });
      try {
        const routesLib = await google.maps.importLibrary('routes');
        Route = routesLib.Route;
      } catch (error) {
        Route = null;
        showWarning(`Nie udało się włączyć rysowania przebiegu trasy: ${error?.message || String(error)}. Punkty nadal będą dodawane do mapy.`);
      }
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
    restoreRouteCache();
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
