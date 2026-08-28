# Aizyl Tools

Darmowe narzędzia przeglądarkowe, które działają w całości na komputerze użytkownika.
Osobne wdrożenie od `aizyl.pl`, wspólna marka i tokeny wizualne.

## Struktura

```
aizyl-tools/
├─ index.html            hub — kafle generowane z modules.json
├─ modules.json          jedyne źródło prawdy o modułach
├─ _headers              nagłówki HTTP (Cloudflare Pages)
├─ robots.txt
├─ shared/
│   ├─ tokens.css        kolory i typografia — kopia :root z aizyl.pl
│   ├─ layout.css        nagłówek, stopka, przyciski, kontener
│   └─ layout.js         wstrzykuje nav i stopkę na każdej podstronie
└─ modules/
    └─ diff/             porównanie dokumentów
```

## Dodanie nowego modułu

1. Utwórz `modules/<id>/index.html` (skopiuj `<head>` z modułu diff).
2. Wstaw `<div id="aizyl-nav"></div>` i `<div id="aizyl-footer"></div>`.
3. Dopisz wpis w `modules.json` i zmień `status` na `ready`.

Nawigacja i stopka są w `shared/layout.js` — nie kopiuj ich do modułów.
Na `aizyl.pl` nagłówek jest zduplikowany w sześciu plikach; tutaj celowo nie jest.

## Uruchomienie lokalne

`fetch('/modules.json')` nie zadziała po otwarciu pliku z dysku. Potrzebny serwer:

```
python -m http.server 8080
# albo
npx serve .
```

## Wdrożenie — Cloudflare Pages, DNS zostaje u obecnego dostawcy

Kolejność ma znaczenie. Odwrotna kończy się błędem 522.

1. Cloudflare → Workers & Pages → Create → Pages → połącz repo. Build command: puste. Output directory: `/`.
2. **Najpierw** w projekcie → Custom domains → Set up a custom domain → `tools.aizyl.pl`.
3. **Dopiero potem** u obecnego dostawcy DNS: rekord `CNAME`, nazwa `tools`, wartość `<projekt>.pages.dev`.

Nameservery `aizyl.pl` zostają nietknięte. GitHub Pages i poczta działają dalej.

## Do zrobienia na aizyl.pl

W `<ul class="nav-links">` we wszystkich sześciu plikach HTML dodaj:

```html
<li><a href="https://tools.aizyl.pl">Narzędzia</a></li>
```

Ruch ma krążyć w obie strony — inaczej hub nie ma po co istnieć.

## Uwagi techniczne

- **COOP/COEP** są w `_headers` wyłączone celowo. `require-corp` zablokowałoby Google Fonts
  i Tabler Icons z CDN. Włącz je per-moduł dopiero wtedy, gdy któryś będzie potrzebował
  SharedArrayBuffer (OCR, ffmpeg, wielowątkowy WASM) — i najpierw zhostuj fonty lokalnie.
- **Tabler Icons** przypięte do `3.19.0` zamiast `@latest`. Na `aizyl.pl` jest `@latest`,
  co oznacza, że wygląd strony może się zmienić bez Twojego udziału — warto to tam poprawić.
- **Umami** używa tego samego `data-website-id` co aizyl.pl. Jeśli chcesz rozdzielić statystyki,
  załóż osobną witrynę w panelu Umami i podmień identyfikator w obu plikach HTML.
- **mammoth i pdf.js** ładowane z cdnjs. Przy włączaniu COEP trzeba je będzie przenieść do repo.

## Znane ograniczenia modułu diff

- PDF-y ze skanów nie mają warstwy tekstowej — moduł to wykrywa i mówi wprost. Potrzebny OCR.
- DOCX czytany jako czysty tekst: bez tabel, formatowania i śledzonych zmian.
- Bardzo długie dokumenty renderują się wolno — brakuje wirtualizacji listy.
- Powyżej 6000 akapitów algorytm przełącza się w tryb awaryjny (wszystko jako usunięte + dodane).
