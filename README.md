# Casas en Alquiler — Cali, Colombia

App web local (Next.js + TypeScript) que busca casas en alquiler en los portales
inmobiliarios colombianos, las rankea por **mejor valor para inquilino** (más m² por menos
plata, penalizando distancia), verifica disponibilidad y distancia real a un punto, y lista el
**Top 10** con características, ubicación, precio, contacto e inmobiliaria.

Dos modos:
- **Buscar (Modo A):** rastrea los portales por ciudad/zona y parámetros.
- **Mi lista (Modo B):** evalúa una lista propia `{Barrio, Conjunto, Área, Precio, Link}` (CSV o
  pegada), sin rastrear.

## Setup

```bash
npm install
cp .env.example .env        # completa tus claves (opcional para empezar)
npx prisma db push          # crea la base SQLite (dev.db)
npm run dev                 # http://localhost:3000
```

### Variables de entorno (`.env`)

| Variable | Para qué | ¿Obligatoria? |
|---|---|---|
| `DATABASE_URL` | SQLite local | sí (ya viene `file:./dev.db`) |
| `GOOGLE_MAPS_API_KEY` | geocodificar barrios sin coords + distancia por conducción | opcional |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | mostrar el mapa en la UI | opcional |
| `BRIGHTDATA_API_KEY` + `BRIGHTDATA_UNLOCKER_ZONE` | Metrocuadrado (Tier C) y fallback anti-bloqueo | opcional |
| `BRIGHTDATA_API_KEY` + `BRIGHTDATA_SERP_ZONE` | "Descubrir sitios nuevos" en Configuración (búsqueda SERP) | opcional |

Sin claves la app funciona: usa las coordenadas que ya traen los portales y distancia en línea
recta (haversine). El mapa y la geocodificación de barrios quedan deshabilitados; Metrocuadrado
y el descubrimiento de sitios se omiten.

## Uso

**Desde la UI:** en *Buscar*, pulsa **1. Refrescar datos** (rastrea los portales y guarda en la
BD) y luego **2. Buscar** (filtra/rankea sobre lo guardado). Descarga el reporte Markdown o
verifica disponibilidad de los resultados.

**Desde la CLI:**
```bash
npm run crawl  -- --cities cali --type casa --pages 20 [--per 50] [--hard] [--geocode]
npm run search -- --ref 3.4516,-76.5320 --max 8 --min 80 --cities cali
npm run smoke  -- [adapterId]    # prueba en vivo de los adaptadores
npm test                          # tests unitarios (vitest)
```

## Documentación

Este README es la referencia pública. Las notas de diseño y decisión (recon por portal,
heurísticas, historial de cambios) son privadas y no forman parte de este repo.

## Arquitectura

```
app/            Next.js (UI + route handlers: /api/search,/refresh,/list,/verify,/report,/geocode)
components/      UI (formulario, tabla de resultados, mapa)
lib/
  adapters/      un archivo por fuente; todos implementan SourceAdapter (base/httpClient + parse)
  core/          schema (zod), geocode, distance, score, dedup, verify, pipeline, orchestrator,
                 query, modeB, report
    discovery/   queryBuilder, domainFilter, recon, pipeline, promptTemplate (descubrir sitios)
  providers/     googlemaps, brightdata, serpSearch
  db/            Prisma client
scripts/         crawl.ts, search.ts, smoke.ts
prisma/          schema.prisma (Listing, GeocodeCache, Run) + SQLite
```

### Ranking (configurable)

Filtros duros primero: `distancia ≤ máx (+ tolerancia por precisión)` y `área ≥ mín`. Luego:

```
cost_per_m2 = (precio + admin) / area              # menor = mejor
score = 0.50·norm(cost/m²) + 0.30·norm(área) + 0.20·norm(distancia)   # pesos editables
```

El checkbox **"Rankear por precio/valor"** se puede desactivar para que el ranking **ignore el
$/m²** (pone `wCost = 0`) y ordene solo por área y cercanía.

### Fuentes (13)

Tier A (HTTP directo): **arriendo, bienco, century21, ciencuadras, elpaisfincaraiz, fincaraiz,
inmoalfaguara, inmobiliariajr, naranjoduque, properati, rentola**. Tier B: **mitula**
(agregador). Tier C: **metrocuadrado** (Bright Data).

Excluidos: **MercadoLibre** y **PuntoPropiedad** (su robots.txt prohíbe crawlers de IA) ·
**habi.co** (solo venta, sin arriendos).

### Descubrir sitios nuevos

Panel **"Descubrir sitios nuevos"** en Configuración: busca (vía Bright Data SERP — Google/Bing)
portales adicionales usando las mismas ciudades/tipo que Buscar, y hace un reconocimiento ligero
de cada candidato (robots.txt, alcanzable, señales anti-bot, relevancia por palabras clave). Los
candidatos ya implementados/excluidos/bloqueados se muestran aparte. Marca **Priorizado** y usa
**"Copiar prompt"** para pegar en una sesión de Claude Code y construir el adaptador ahí — la app
no puede generar código de adaptador por sí misma. Requiere `BRIGHTDATA_API_KEY` +
`BRIGHTDATA_SERP_ZONE`; sin ellos el botón queda deshabilitado con un aviso. Es heurístico
(triage), no una garantía de viabilidad.

### Disponibilidad / link muerto

- **Autoritativo:** el crawl marca `isActive=false` cualquier aviso que ya no aparezca en las
  páginas vigentes de su portal (rentado/retirado).
- **Secundario:** `verifyUrl` (botón "Verificar disponibilidad") detecta 404/redirect/"arrendado"
  en portales server-rendered. No detecta soft-404 en sitios 100% SPA (cubierto por el crawl).

## Notas / limitaciones

- **Contacto** desigual: teléfono confiable en Ciencuadras y Properati; FincaRaíz/Rentola lo
  ocultan; sitios de una sola agencia dan el número de la agencia.
- Algunos avisos reportan área de **lote/campestre** (m² muy altos); como el ranking premia área,
  pueden subir al tope. Ajusta los pesos o filtra por tipo si no los quieres.
- `admin` no siempre está disponible (se asume 0 cuando falta).
- **Máx. resultados por portal** (`--per` / campo en la UI): limita cuántos avisos se traen de
  cada portal al refrescar (0 = sin límite). Los portales devuelven primero sus avisos más
  relevantes/recientes.
- **Inmuebles repetidos** entre portales se fusionan en una fila; la columna *Fuente* muestra
  `a+b 🔁` con un tooltip que lista todos los portales y su URL donde se encontró.
- **Filtros de búsqueda:** distancia máx, área mín, habitaciones mín y **rango de precio**
  (mín/máx). Son filtros duros (se aplican antes del ranking). Cada campo tiene un tooltip ⓘ.
- **Persistencia:** el formulario, la configuración y el **historial de búsquedas** se guardan en
  el navegador (localStorage), así que sobreviven a recargas y reinicios del servidor. El panel
  *Búsquedas anteriores* permite revisar/restaurar o borrar búsquedas pasadas.
- **Filtros por columna:** en *Precio* y *m²* puedes escribir expresiones (`<2M`, `>=800k`,
  `1M-2M`, `=90`) además de ordenar; el conteo muestra `N de M` y un typo se marca en rojo sin
  vaciar la tabla. En *Revisión* hay un filtro por estado (Elegible / Vista / Sin marca).
- **Casas marcadas (`/marked`):** junta todas las casas de todos los historiales agrupadas por
  estado (Elegible / Vista / Sin estado), permite re-marcar, **elegir qué columnas mostrar**
  (selector "Columnas", persistido) y **exportar a Excel (.xlsx)** las filtradas (Barrio/Conjunto,
  Ciudad, m², $/m², Distancia, Habitaciones, Estado, Enlace). La distancia exportada es la de la
  búsqueda más reciente donde apareció cada casa.
- Respeta los `robots.txt`: rate-limit ~1 req/s, UA real, sin endpoints de contacto bloqueados.
