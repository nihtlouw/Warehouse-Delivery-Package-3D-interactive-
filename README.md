# Gudang Paket 3D — Interactive Warehouse & Delivery Depot

A single-file, dependency-light 3D walkthrough of a parcel sorting warehouse with a
management office, a pallet-rack storage hall, a main conveyor with seven dispatch
lanes, open-air motorcycle/car courier docks, a genset house, and a full occupational
safety layer — all built procedurally with Three.js and drawn-on-canvas textures.

**Live file:** [`index.html`](index.html) — open it in a browser (desktop or phone).
The original upload was named `Gudang Paket 3D.html`; it is committed here as
`index.html` so static hosts (GitHub Pages, Netlify, S3) serve it at the site root.

Language of the UI is Bahasa Indonesia. All UI text, zone copy, and signage is written
for an Indonesian logistics audience (Rupiah-free, `m/dtk`, local courier vocabulary).

---

## 1. Run it

No build step, no install, no server required:

```bash
# simplest
open index.html          # macOS   (or: xdg-open index.html on Linux)

# or serve it (recommended — avoids any file:// quirks)
python3 -m http.server 8000
# → http://localhost:8000/index.html
```

**Requires an internet connection on first load** for two external resources:

| Resource | URL | Why |
| --- | --- | --- |
| Three.js r128 | `cdnjs.cloudflare.com/…/three.js/r128/three.min.js` | the entire renderer |
| Google Fonts | `fonts.googleapis.com` (Barlow Condensed, IBM Plex Sans/Mono) | display + mono type |

Everything else — geometry, textures, decals, signage, the reference photograph — is
generated in the file itself. If the fonts fail, the canvas re-renders with fallback
faces; if Three.js fails, the page stays on a blank stage (see §6, finding F2).

**Hard requirement:** WebGL. A caught `WebGLRenderer` failure shows an Indonesian
"needs WebGL" message instead of a blank page.

---

## 2. What's in the scene

| Area | Contents |
| --- | --- |
| **Management office** (left end, 12 × 18 m, 2 floors) | Reception, glass meeting room, archive, toilets; three glass-partitioned manager rooms, admin room with four desks, coffee pantry, server cabinet; balconies facing the rack aisle; a live courier-dispatch board with running clock and rotating rows |
| **Storage hall** | Two rows of blue pallet racks, orange beams, 15 bays × 5 levels to 8.9 m; three rows of light picking shelves; two rows of sorting tables; cardboard backdrop taken from the reference photo |
| **Conveyor** | One main belt with a barcode scanner head, branching into seven dispatch lanes that descend as gravity roller beds to the dock edge; 130 parcels circulating as a single `InstancedMesh` |
| **Dispatch docks** (front/lower end) | Motorcycle courier parking with blue floor zone; van/car bays with orange zone and yellow bollards; asphalt yard, lane markings, directional arrows, guard post, fence and gates |
| **Safety layer** | Green evacuation routes with arrows to three assembly points, 6 × fire extinguisher + hydrant cabinets, ceiling sprinkler grid (4 red pipe runs + risers + valve panel), two emergency exits with lit KELUAR signs, yellow/black forklift lanes with two patrolling forklifts |
| **Genset house** (right end, outside the wall) | 5 × 2.7 × 3.1 m concrete shelter with yellow plaster, double louvre doors, downlights, garden and palms; inside, a teal V-GEN canopy genset modelled from a photo — engine, alternator, radiator, turbo, heat-wrapped exhaust with roof penetration, battery, junction box, cable run to the main panel |
| **Site** | Grass, palms, yard lamps, banners/signs, halaman and gate — each a togglable layer |

### Interactions

- **Orbit / zoom / pan** — drag, wheel or pinch, `Shift`+drag or two fingers to pan, arrow keys on the focused canvas.
- **Six camera presets** — `Denah` (plan), `Depan`, `Kiri`, `Kanan`, `Dalam` (interior), `3D` (isometric), with eased tweening and a clamped orbit.
- **18 focusable zones** grouped into 7 sections, each with a description panel and a "Dekati" fly-to.
- **13 HUD callout labels** projected from 3D anchors, auto-hidden when facing away or when zoomed in.
- **Transparency sliders** — roof, side walls, office, genset canopy, house roof, house walls, plus four presets (solid / glass / see-through / hidden).
- **Weather + time** — clear, overcast, rain, night. Drives key/hemisphere/fill lights, fog, exposure, stage gradient, wet asphalt (roughness + metalness), lamp and point-light intensity, moon, environment map strength, and rain.
- **Rain** — 5,000 GPU line segments per world, spawned *outside* the roof footprint (respects both dock layouts) so rain never falls indoors, even with the roof transparent.
- **A | B comparison** — splits the canvas with `setScissorTest`, building a **second complete world** with the alternate dock layout (dock-below vs dock-at-side) and sharing one camera, weather and settings.
- **Layer switches** — 10 model layers (steel frame, racks, shelves, sorting tables, conveyor, vehicles, people, lamps, signs, site) and 6 safety layers, all on by default.
- **Genset doors** — 7 doors (canopy engine/alternator/control/back-left/back-right + two shelter louvre doors), openable from the panel or by clicking them in 3D, with eased swing animation and clickable hit-testing.
- **Light/dark theme** following `prefers-color-scheme`, with an explicit `data-theme` override.

---

## 3. Architecture

The file is one HTML document with a scoped CSS block, static markup, and **five**
inline scripts. There are no modules, no bundler, and no globals beyond the four
builder functions each script publishes on `window`.

```
index.html  (3,134 lines / 219 KB)
├── <style>                  lines    5–141   design tokens, layout, panel, HUD (~7 KB)
├── static markup            lines  142–229   canvas, HUD, tabs, 6 control pages
├── <script> WH_PHOTO        lines  231–234   18 KB base64 JPEG (pallet-rack backdrop)
├── <script> buildGenset     lines  235–890   34 KB — genset + shelter-builder contract
├── <script> buildShelter    lines  891–1468  32 KB — concrete house, plaster/concrete/
│                                              ceramic textures, louvre doors, palms
├── <script> buildWarehouse  lines 1469–2603  80 KB — the whole hall, office, conveyor,
│                                              docks, yard, safety, vehicles, staff
└── <script> controller      lines 2604–3128  35 KB — renderer, camera, UI state, loop
```

### Builder contract

Each builder takes `T` (the Three.js namespace) plus options and returns an API object;
none of them reference the DOM:

```js
buildGenset(T)        → { root, layers, doors, text, state, setShell, setEdges,
                          setLayer, setRun, toggleDoor, update, pickables,
                          partOf, doorOf, redraw, fan }
buildShelter(T, opts) → { group, W, D, H, a, zb, zf, gateH, doors, callouts,
                          setWalls, setRoof, setLights, setGarden, setHuman,
                          toggleDoor, update, dispose, pickables }
buildWarehouse(T, o)  → { root, G, stats, lanes, layout, lampPts, litePts,
                          setRoof, setWalls, setOffice, setGroup, setWet, setNight,
                          setConveyor, isRunning, parcelCount, update, redraw, dispose }
```

`doors` is a keyed map (`engine`, `alt`, `ctrl`, `backL`, `backR`, `gateL`, `gateR`),
which is exactly what the controller's 7-row door list and the shared `getDoor()`
helper consume.

The controller owns all mutable UI state in a single object:

```js
var S = { roof, wall, off, can, shRoof, shWall, lights, run, convOn,
          speed, weather, rain, layers, cmp };
```

and every control writes to `S` then calls `eachW(fn)` to fan the change out to
whichever worlds exist (`A`, and `B` in compare mode). That one-liner is what makes
A|B comparison cheap to keep in sync.

### Rendering techniques worth noting

- **Canvas-generated textures** everywhere — plaster, concrete, ceramic, metal, leaves,
  corrugated roofing, pallet cardboard, lane markings, signage, dashboards, and an
  animated dispatch board. All seeded (`seed = seed * 16807 % 2147483647`) so the
  random speckle is deterministic across reloads.
- **Texture atlas avoidance by batching**: repeated primitives are collected into
  per-geometry/per-material buckets and emitted as `InstancedMesh` in `finalizeInst()`.
- **PMREM environment map** built on the fly from a painted sky sphere + four emissive
  panels, so metal reads correctly without an HDR file.
- **ACES Filmic tone mapping** with per-weather exposure, `sRGBEncoding` output.
- **PCF soft shadows** from one directional light (4096² desktop, 2048² mobile/compare),
  with `bias -0.0004` and `normalBias 0.05`, plus `castShadow=false` on transparent
  decals.
- **Cheap physics** — the conveyor, parcels, forklifts, staff, rain and live textures
  are all closed-form functions of `dt`/`clock`; no physics engine.
- **Fade, not hide** — transparency sliders drive material `opacity` and
  `transparent`/`depthWrite` flags via a small `fade(list, meshes, op)` helper.

---

## 4. Measured footprint

| Metric | Value |
| --- | --- |
| File size | 218,818 bytes (219 KB), **one** HTTP document |
| Lines | 3,134 |
| Inline JS | ~199 KB across 5 blocks |
| Inline CSS | ~7 KB |
| Inline image data | 18.2 KB base64 ≈ 13.4 KB JPEG |
| External assets | 2 (Three.js r128, Google Fonts) |
| `new T.Mesh` call sites | 133 (+ instanced batches) |
| Rain particles / world | 5,000 line segments |
| Parcels on belts | 130 (single `InstancedMesh`) |
| Point lights / world | up to 9 (4 yard + 5 ceiling) |
| Worlds alive in compare mode | 2 scenes, 2 shadow maps, ~18 point lights |
| JS syntax check | all four code blocks pass `node --check` |
| Markup | balanced (`<p>`, `<li>`, `<div>` verified) |

This is a *lot* of authored content for 219 KB with no build step — the trade-off is
that the file is monolithic (see §6).

---

## 5. Quality assessment

### Strengths

1. **Real information architecture.** This is not a demo scene. Zones, layers, safety
   systems, and the genset are modelled to a coherent schematic with consistent metre
   coordinates (x → right, y → up, z → viewer) documented in the source comments.
2. **Clean builder/controller separation.** Builders never touch the DOM; the controller
   never builds geometry. `S` + `eachW()` is a genuinely tidy state model.
3. **Deterministic procedural texturing.** Seeded RNG means the concrete blotches and
   cardboard look identical on every load — important for screenshots and QA.
4. **Weather is a real system, not a CSS filter.** Lights, fog, exposure, environment
   intensity, asphalt roughness/metalness, lamps, moon, rain spawn mask, and the stage
   gradient all move together — including the indoor rain cut-out in both dock layouts.
5. **Accessibility is above average for a 3D toy.** `aria-label` on the canvas, keyboard
   orbit, `aria-pressed` on view/mode buttons, ARIA tablist with arrow-key navigation and
   roving `tabindex`, visible focus rings, `prefers-color-scheme` with a manual override,
   and a graceful WebGL-unsupported message.
6. **Honest, well-commented source.** Indonesian section headers, dimension notes taken
   from the reference photo, and inline rationale for the tricky parts (door hinge pivots,
   roof silhouette formulae, world-space junction boxes).

### Weaknesses

1. **It is a 3,000-line single file with four global function bundles.** No modules, no
   tree-shaking, no lint/type coverage, and no tests. Changing the genset risks nothing,
   but changing the shared `fade()` or `mat()` conventions requires manual grepping.
2. **The render loop never idles.** A "dirty frame" counter (`kick()`/`dirty`, lines
   2799–2800) is written to but *never read* — the loop renders unconditionally every
   frame. The intent (render-on-demand) is there; the wiring is not.
3. **Compare mode leaks a whole living world.** Closing the comparison leaves `B` in
   `worlds[]`, so `eachW()` keeps animating the hidden scene — conveyor, parcels, 130
   instances, forklifts, rain, live canvas textures — every frame, forever. `dispose()`
   exists but is never called.
4. **`small` is sampled once** (`window.innerWidth < 860`, line 2683), so shadow-map
   resolution never reacts to a resize or device rotation.
5. **Duplicated definitions** in `buildWarehouse`: `setGroup`, `dispose`, and `update`
   are each defined twice (lines 2558–2565 and 2578–2585). The later definition wins;
   the earlier is dead code that can silently diverge on the next edit.
6. **Heavy defaults for low-end GPUs.** 4096² shadow map, `antialias: true`, `dpr` up to
   2, ACES tone mapping, 9–18 point lights on `MeshStandardMaterial`, and 5,000 CPU-updated
   rain segments can drop a mid-range Android phone to single-digit FPS in rain + compare.
7. **Hard CDN dependency with no pinning of integrity.** No `integrity`/`crossorigin`, no
   local copy, no `onerror` fallback: a blocked CDN yields a blank page with no message.
   Three.js **r128 (2021)** is three years of API drift behind current releases
   (`outputEncoding`/`sRGBEncoding` → `outputColorSpace`, legacy lights, etc.).
8. **No `prefers-reduced-motion` support** despite constant motion (rain, conveyor,
   forklifts, camera tweens, animated dashboards). No `aria-live` announcement when a
   layer or weather preset changes.

---

## 6. Prioritised findings

| # | Severity | Finding | Evidence | Suggested fix |
| --- | --- | --- | --- | --- |
| F1 | High (perf) | Render loop ignores dirty-state; always renders | `dirty`/`kick()` at 2799–2800, loop at 3108 | Wrap `render()` in `if (dirty > 0 \|\| animating)` and decrement; call `kick()` from camera/UI handlers |
| F2 | High (robustness) | Blocked/unavailable Three.js CDN → blank stage, no message | line 230 | Add `onerror` fallback to a local copy + show the existing `.nogl` notice |
| F3 | High (perf) | Hidden compare world keeps simulating | `worlds.push(B)` at 3041, `eachW` at 2762 | Remove `B` from `worlds` on close, or skip B in the loop when `!S.cmp`; `dispose()` on toggle |
| F4 | Medium (perf) | 4096² shadow map + `dpr` ≤ 2 + antialias as defaults | 2689, 3084 | Adaptive quality: measure frame time, step down shadow map → 2048 → 1024 and `dpr` → 1 |
| F5 | Medium (perf) | 9–18 point lights with `MeshStandardMaterial` | 2751–2754 | Keep 2–3 real lights, fake the rest with emissive cards; or bake to the env map |
| F6 | Medium (maintainability) | `setGroup`/`dispose`/`update` defined twice | 2558–2565 vs 2578–2585 | Delete the first block |
| F7 | Medium (a11y) | No reduced-motion path; no live regions for state changes | CSS/JS | `@media (prefers-reduced-motion)` → static camera, no rain, single frame; `aria-live="polite"` status line |
| F8 | Low | `small` sampled once at load | 2683 | Recompute in `resize()` |
| F9 | Low | Tabs lack `aria-controls` / panel `id` pairing | 142–229, 2918 | Add ids and wire `aria-labelledby` |
| F10 | Low | No SRI on the CDN script; Three.js r128 is EOL-adjacent | 230 | Pin a modern release locally and migrate the colour-space API |

---

## 7. Suggested roadmap

1. **Split into modules** — `three/` loaders aside, extract `buildGenset.js`,
   `buildShelter.js`, `buildWarehouse.js`, `controller.js` + a tiny bundler (or native
   ES modules with `<script type="module">`). Keep a `build:single` script that inlines
   everything back into `index.html` so the "one file to share by email" property survives.
2. **Ship a quality ladder** — low/medium/high tiers driven by a 2-second frame-time
   probe, defaulting mobile to low.
3. **Turn on render-on-demand properly** (F1) — this alone should cut idle GPU/battery
   use by an order of magnitude on a phone sitting on a desk.
4. **Add a real loading state** — the current build blocks the main thread for a second
   or two while it constructs ~20k+ triangles of scene; a skeleton + `requestIdleCallback`
   chunking would make first paint feel instant.
5. **Vendor Three.js** and pin it, then migrate colour-space APIs so the project isn't
   frozen on r128.
6. **Add a screenshot/deep-link hash** (`#zone=genset&weather=malam&tab=gen`) so a
   specific view can be shared with a client — cheap, high value for a sales/technical
   walkthrough tool.
7. **Optional:** an exported `stats.csv`/bill-of-materials from the `stats` object already
   collected in `buildWarehouse` (people, parcels, racks, lanes).

---

## 8. Notes on provenance

- Coordinates and proportions are metres, documented per module; the genset is
  "traced from the photo" (source comment) and the `WH_PHOTO.rack` JPEG is embedded as
  the pallet-rack backdrop texture rather than shipped as a separate asset.
- The page was clearly produced as a single-file export (inlined styles, inlined base64
  image, plain global function blocks). It is preserved byte-for-byte in `index.html`;
  no code was modified in this commit.
