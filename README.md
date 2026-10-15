# Trasa Studio — kreator rozbudowanych tras Google Maps

Statyczna aplikacja frontendowa bez frameworka i bez backendu. Działa jako zwykła strona HTML i nadaje się do publikacji na GitHub Pages.

## Pliki

- `index.html` — szkielet aplikacji
- `styles.css` — responsywny interfejs
- `app.js` — zarządzanie punktami, generowanie linków, import/eksport i `localStorage`
- `map-preview.js` — opcjonalny podgląd mapy z Maps JavaScript API / Maps Demo Key
- `wow.css` i `wow.js` — dodatkowy motyw Aurora, interaktywne tło, telemetria i skróty klawiaturowe

## Uruchomienie lokalne

Najprościej otworzyć `index.html` w przeglądarce. Dla pełnej obsługi linków schowka i linków do współdzielenia zalecane jest uruchomienie przez lokalny serwer (np. rozszerzenie Live Server) lub hosting HTTPS.

## Publikacja na GitHub Pages

1. Utwórz repozytorium GitHub.
2. Prześlij do katalogu głównego wszystkie pliki aplikacji: `index.html`, `styles.css`, `wow.css`, `layout-refinement.css`, `contrast-fixes.css`, `app.js`, `map-preview.js` i `wow.js` (oraz opcjonalnie `README.md`). Zachowaj nazwy plików i umieść je w jednym katalogu.
3. Wejdź w **Settings → Pages**.
4. W sekcji źródła wybierz publikację z gałęzi (np. `main`) i katalogu `/root`.
5. Zapisz ustawienia i otwórz adres GitHub Pages pokazany przez GitHub.

Aplikacja nie wymaga kompilacji, frameworków ani pakietów. Klucz demonstracyjny Maps JavaScript API jest opcjonalny i służy wyłącznie do wyświetlania interaktywnej mapy oraz próby narysowania przebiegu.

## Funkcje

- Brak sztucznego limitu liczby punktów w jednej trasie; praktyczne ograniczenia mogą wynikać z pamięci przeglądarki oraz możliwości Google Maps.
- Edycja nazw i adresów, dodawanie, usuwanie, duplikowanie punktów, kontrolki góra/dół, odwracanie kolejności i przeciąganie punktów.
- Generowanie niestandardowego linku ścieżkowego: `https://www.google.com/maps/dir/punkt-1/punkt-2/…/data=!4m2!4m1!3e2?entry=ttu` (kod końcówki zmienia się zależnie od wybranego środka transportu).
- Interaktywny podgląd przez Maps JavaScript API / Maps Demo Key; dłuższe trasy są rysowane w segmentach zachodzących na siebie wspólnym punktem. Wyszukiwanie atrakcji otwiera Google Maps w nowej karcie.
- Zapisane trasy w `localStorage`; import/eksport tras jako JSON, eksport linku do TXT.
- Możliwość wklejenia i przechowania krótkiego linku Google Maps utworzonego przez opcję „Udostępnij”.
- Link do aplikacji z trasą zakodowaną w `#trip=...` (po publikacji strony HTTPS).
- Projekt mobilny i desktopowy, wszystkie podstawowe funkcje działają bez frameworków.

## Ograniczenia i istotna uwaga o Google Maps

Aplikacja odtwarza niestandardowy format ścieżki `/maps/dir/...`, którego używaliśmy w planie podróży. Google oficjalnie dokumentuje osobny format Maps URLs oparty na `?api=1`, w którym obowiązuje limit punktów pośrednich zależny od platformy oraz limit długości URL 2048 znaków. Działania niestandardowej ścieżki z kilkudziesięcioma punktami nie można zagwarantować w każdej wersji Google Maps.

Zwykła przeglądarkowa strona `https://www.google.com/maps` lub `/maps/dir/...` jest blokowana we własnym `iframe` przez Google (`X-Frame-Options: sameorigin`). Aplikacja nie próbuje już osadzać tych adresów. Do testowego podglądu możesz wkleić Maps Demo Key przeznaczony do Maps JavaScript API: [oficjalna instrukcja Google](https://developers.google.com/maps/documentation/javascript/demo-key). Klucz demonstracyjny nie wymaga konfiguracji rozliczeń, ale ma ograniczony zestaw funkcji, limity i jest przeznaczony do prototypów. Nie umieszczaj prywatnego, nieograniczonego klucza w publicznym repozytorium.

Podgląd wykorzystuje Routes Library w Maps JavaScript API, które obsługuje do 25 punktów pośrednich w pojedynczym żądaniu (maksymalnie 27 lokalizacji wraz z początkiem i końcem). Dla dłuższych tras Trasa Studio dzieli trasę na odcinki zachodzące na siebie ostatnim/pierwszym punktem i rysuje je na jednej mapie, jeśli klucz demonstracyjny pozwala na obliczenie trasy w danym trybie. Pełna, niestandardowa ścieżka `/maps/dir/...` nadal jest generowana i otwierana w osobnej karcie Google Maps; Google nie gwarantuje obsługi bardzo długich tras w jednym linku.

Przeglądarka nie pozwala stronie odczytywać zawartości innej domeny (same-origin policy), więc aplikacja nie może automatycznie przejąć skróconego linku z przycisku „Udostępnij” wewnątrz iframe. Wygeneruj link pełnej trasy w Google Maps, wybierz „Udostępnij → Kopiuj link”, a następnie wklej go w polu „Krótki link Google Maps”. Skróconych adresów `maps.app.goo.gl` nie da się rozwinąć do listy punktów wyłącznie lokalnym kodem frontendowym.

Dane zapisane w `localStorage` pozostają w danej przeglądarce i na danym urządzeniu. Aby przenieść je gdzie indziej, użyj eksportu JSON.


## Podgląd mapy z Maps Demo Key

1. Otwórz link „Uzyskaj klucz demo” w aplikacji i wygeneruj Maps Demo Key.
2. Wklej klucz do pola podglądu i wybierz „Włącz mapę”. Klucz jest przechowywany wyłącznie w `localStorage` tej przeglądarki.
3. Mapa renderuje się w elemencie strony przy użyciu Maps JavaScript API; zwykła strona Google Maps nie jest osadzana w iframe (Google blokuje takie osadzanie). Wyszukiwanie atrakcji otwiera wyniki w nowej karcie.
4. Podgląd tras dowolną liczbę punktów dzieli je na odcinki do 27 lokalizacji, z powtórzonym punktem granicznym, zachowując kolejność. Demo Key jest przeznaczony do prototypów, ma ograniczone funkcje/limity i nie jest kluczem produkcyjnym.

Oficjalna dokumentacja: https://developers.google.com/maps/documentation/javascript/demo-key

## Aurora Edition — ulepszenia interfejsu

Ta paczka zawiera również:

- `wow.css` — dodatkową warstwę wizualną: ciemny interfejs typu glassmorphism, świetlne gradienty, neonowe akcenty, responsywne karty, stany focus i animacje.
- `wow.js` — animowane tło cząsteczkowe reagujące na wskaźnik myszy, przełącznik jasnego/ciemnego motywu zapamiętywany w `localStorage`, telemetrię punktów i długości linku, podstawową kontrolę jakości listy, skróty klawiaturowe i delikatne ujawnianie paneli przy przewijaniu.

### Skróty klawiaturowe

- `Ctrl` / `⌘` + `S` — zapisz trasę.
- `Ctrl` / `⌘` + `Enter` — otwórz aktualną trasę w Google Maps.
- `/` poza polem edycji — otwórz i skup wyszukiwarkę atrakcji.
- `Alt` + `↑` / `↓` w polu punktu — przesuń ten punkt o jedno miejsce w górę lub w dół.

Animacje są ograniczone, gdy system operacyjny zgłasza `prefers-reduced-motion`. Tło cząsteczkowe jest lekkie, nie wymaga obrazów zewnętrznych i wstrzymuje animację, gdy karta jest ukryta.

## Uwagi dotyczące podglądu mapy

Zwykły interfejs strony Google Maps nie może być osadzany we własnym `iframe` — Google blokuje takie próby polityką same-origin / nagłówkami bezpieczeństwa. Podgląd trasy korzysta z elementu mapy Google Maps JavaScript API i opcjonalnego klucza demonstracyjnego wpisywanego w aplikacji. Biblioteka `map-preview.js` próbuje obliczyć i narysować kolejne części trasy z zachowaniem punktów wspólnych na granicach odcinków. Możliwość wyznaczania tras zależy od aktualnych możliwości klucza demo, dostępności tras, limitów i aktualnego API Google; nie jest gwarantowana dla każdej kombinacji klucza i bardzo długiej trasy.

Nie umieszczaj w publicznym repozytorium prywatnego, nieograniczonego klucza API. Demo Key jest przeznaczony do prototypów; sprawdź bieżące warunki i ograniczenia na oficjalnej stronie: https://developers.google.com/maps/documentation/javascript/demo-key


## Układ i responsywność

`layout-refinement.css` dopracowuje szerokość całego widoku, pełną szerokość nagłówka, proporcje edytora i mapy oraz układ responsywny dla laptopów, tabletów i telefonów. Pozostałe pliki pozostają bez zmian funkcjonalnych.

## Jasny motyw i ikony
Plik `contrast-fixes.css` musi pozostać w tym samym katalogu co `index.html`. Jest ładowany na końcu i naprawia kontrast powierzchni oraz kolorów w jasnym motywie, a kilka ikon jest rysowanych przez CSS, aby uniknąć brakujących glifów na różnych platformach.


## Final release UI polish

The final release lowers the theme-toggle glyph and removes decorative icons from text-labelled buttons. Icon-only controls retain their visual glyphs. The interface uses a Polish-capable system-font fallback stack, and routes have no application-imposed stop-count limit. Google Maps URL/API limits still apply externally.
