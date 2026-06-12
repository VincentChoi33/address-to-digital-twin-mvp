# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-06-11
- Primary product surfaces:
  - Browser MVP: address console, data-confidence panel, 3D flood simulator, scenario controls, generated artifact downloads.
  - Static sample export: `preview.html`, `qa_report.html`, `twin.json`, `source_manifest.json`.
  - Deployment helper: `deploy/server.py` for optional Juso/VWorld/WFS/Ollama-backed runs.
- Evidence reviewed:
  - `README.md`: product promise, data-source policy, flood-solver scope, non-authoritative disclaimer.
  - `src/app/main.ts`: runtime state, project loading, scenario handling, stats loop, artifact generation.
  - `src/app/ui.ts`: existing shell markup and helper functions.
  - `public/styles.css`: existing dark dashboard layout and responsive behavior.
  - `src/scene/viewer.ts`, `src/scene/terrain.ts`, `src/scene/buildings.ts`: Three.js scene, DEM/satellite loading, building rendering boundaries.
  - `src/water/solver.ts`, `src/water/bake.ts`, `src/water/surface.ts`: simulation model, drain/backflow model, water rendering constraints.
  - `src/core/previewTwin.ts`, `src/core/generateMassing.ts`, `src/core/manifest.ts`, `src/core/qa.ts`: address-to-artifact pipeline and confidence manifest.
  - `src/types/twin.ts`: project, manifest, geocoding, layer and geometry types.
  - `src/app/__tests__/agent.test.ts`, `src/app/__tests__/ui-helpers.test.ts`, `src/core/__tests__/manifest.test.ts`: existing expected behavior.
  - `docs/images/app-screenshot.png`, `docs/images/twin-preview-sadang.png`, `docs/images/twin-qa-report-sadang.png`: existing visual evidence.
- Observed facts vs inferences:
  - Fact: The app already has deterministic offline preview generation and optional server-side official-data upgrades.
  - Fact: The water solver is a demo-accelerated shallow-water visual simulation, not a regulatory hydraulic model.
  - Fact: Current UI surfaces many technical controls but does not make data authority and decision readiness the primary hierarchy.
  - Inference: The product is strongest as a “preview-grade risk triage cockpit,” not as a survey/BIM replacement.

## Brand
- Personality:
  - Calm, technical, disaster-response oriented, honest about uncertainty.
  - Premium GIS operations room rather than toy/game UI.
- Trust signals:
  - Always show whether each layer is official, OSM, procedural, or fallback.
  - Keep the “not survey/legal grade” warning visible.
  - Separate model availability from data authority.
  - Report generated artifacts and QA/confidence outputs as first-class deliverables.
- Avoid:
  - Overclaiming “real” when the current run is fallback/procedural.
  - Hiding low confidence behind glossy visuals.
  - Treating LLM availability as a data-quality signal.
  - Dense controls without explaining the user decision they support.

## Product goals
- Goals:
  - Convert a Korean address into an immediately explorable preview twin.
  - Let a user simulate rain scenarios and understand likely visual flood behavior.
  - Make confidence, limitations, and required official-data upgrades obvious.
  - Preserve downloadable artifacts for review and handoff.
- Non-goals:
  - Legal/cadastral/survey-grade output.
  - Full SWMM/hydraulic engineering validation.
  - BIM/LOD2 authoring.
  - Automated emergency decision-making.
- Success signals:
  - A first-time user can answer: “What address did I analyze?”, “Which data is trusted?”, “What scenario is running?”, “What risk state is shown?”, and “What should I verify next?” within 30 seconds.
  - Low-confidence preview states are impossible to miss.
  - Existing tests, typecheck, build, and local browser smoke still pass.

## Personas and jobs
- Primary personas:
  - Urban/flood-resilience planner doing early screening.
  - GIS/data engineer validating address and layer readiness.
  - Product/demo stakeholder evaluating digital-twin feasibility.
- User jobs:
  - Enter an address and generate a preview twin without API keys.
  - Inspect data confidence before trusting visual output.
  - Stress-test scenarios such as heavy rain, cloudburst, and drainage upgrades.
  - Download JSON/manifest/QA evidence for follow-up.
- Key contexts of use:
  - Desktop browser during demo/review.
  - Offline/keyless local development.
  - Optional deployed environment with server-side official data connectors.

## Information architecture
- Primary navigation:
  - No multi-page navigation in MVP; a single cockpit organized by workflow.
- Core routes/screens:
  - `/`: live address-to-flood cockpit.
  - Static generated `preview.html`: lightweight project review.
  - `qa_report.html`: confidence and limitations report.
- Content hierarchy:
  1. Command bar: product identity, global live metrics, data/model connection status.
  2. Mission panel: address input, workflow trace, address interpretation, scenario controls, view controls.
  3. Stage: 3D terrain/building/water visualization and always-visible warning/legend.
  4. Intelligence panel: risk assessment, layer confidence, outputs, hydrograph, logs, attribution.

## Design principles
- Principle 1: Confidence before spectacle.
  - Every visual claim must have a nearby confidence/source cue.
- Principle 2: Scenario as a decision state, not a button pile.
  - Rain/drainage controls must explain the currently simulated condition.
- Principle 3: Continuous disclosure.
  - Start with address, readiness, and risk; keep raw technical details available below.
- Principle 4: Graceful degradation.
  - If WebGL/server/model fails, keep address analysis and artifacts usable.
- Tradeoffs:
  - More explanatory copy reduces dashboard density but increases trust.
  - The UI should not add a heavy component framework; repo-native HTML/CSS remains faster and safer for the MVP.

## Visual language
- Color:
  - Dark operations-room base: ink/navy backgrounds.
  - Teal/cyan for actionable preview and target building.
  - Amber for preview/uncertain confidence.
  - Red for backflow/critical flood states.
  - Green for verified/healthy states.
- Typography:
  - System Korean-capable sans stack; strong numeric tabular treatment for live metrics.
  - Compact labels with clear section titles; avoid decorative fonts.
- Spacing/layout rhythm:
  - Desktop cockpit: command bar top, mission left, 3D center, intelligence right.
  - 10–14px internal rhythm, cards with clear borders and subtle translucent fills.
- Shape/radius/elevation:
  - 14–18px cards, 999px pills, low-glow active states.
  - Avoid heavy skeuomorphic shadows; use borders and contrast.
- Motion:
  - Keep simulation motion in the canvas; UI transitions should be short and non-essential.
  - Respect reduced motion for alerts/animation where possible.
- Imagery/iconography:
  - 3D canvas is the primary image.
  - Use small symbolic icons sparingly for rain, warning, outputs, and sound.

## Components
- Existing components to reuse:
  - `createUi` plain DOM shell.
  - `layerRows`, confidence/rain/geocoding helper functions.
  - `CityViewer`, `WaterSolver`, `WaterSurface`, `SoundSynth`.
  - Existing generated artifact blob links.
- New/changed components:
  - Readiness pill summarizing manifest confidence distribution.
  - Workflow/mission steps explaining address → data → geometry → simulation → QA.
  - Risk card driven by live solver stats, network load, and backflow.
  - Scenario narrative tied to active rainfall/drainage state.
  - Clear output card for `twin.json`, `source_manifest.json`, and `qa_report.html`.
- Variants and states:
  - Confidence: high / medium / low.
  - Readiness: ready / mixed / preview.
  - Risk: standby / watch / warning / critical.
  - Connection: connected / fallback / pending.
  - WebGL fallback: full-screen canvas replacement with explanation.
- Token/component ownership:
  - CSS variables in `public/styles.css` own color, border, panel, typography tokens.
  - `src/app/ui.ts` owns dashboard markup and copy.
  - `src/app/main.ts` owns runtime state binding and solver-driven UI updates.

## Accessibility
- Target standard:
  - Aim for WCAG 2.1 AA for text contrast and keyboard-accessible controls.
- Keyboard/focus behavior:
  - Address textarea + run button must be keyboard usable.
  - Scenario/view/sound buttons remain native buttons.
  - Cmd/Ctrl+Enter remains supported for generation.
- Contrast/readability:
  - Avoid low-opacity text below readable contrast.
  - Warnings use amber/red with dark backgrounds and text labels, not color alone.
- Screen-reader semantics:
  - Use labels for address input and aria-live on agent transcript/status regions.
  - Keep generated links as real anchors.
- Reduced motion and sensory considerations:
  - UI alert blink should be disabled under `prefers-reduced-motion`.
  - Sound toggle is explicit and visible.

## Responsive behavior
- Supported breakpoints/devices:
  - Primary: desktop/laptop >= 1200px.
  - Secondary: tablet/narrow desktop down to ~760px.
  - Mobile: functional stacked layout, not optimized for heavy 3D use.
- Layout adaptations:
  - Desktop: three-column cockpit with fixed command bar.
  - <= 1180px: stack stage above panels; scene height around 56vh.
  - <= 720px: single-column, compact metrics, controls wrap.
- Touch/hover differences:
  - Buttons have visible active state without relying on hover.
  - Canvas click inspection remains optional; key information also appears in panels.

## Interaction states
- Loading:
  - Source status shows “공간 데이터 확인 중”; warning banner says scene/data is loading.
  - Agent steps show deterministic local/server path.
- Empty:
  - Default Sadang prompt loads automatically.
  - Point inspector prompts the user to click the scene.
- Error:
  - WebGL fallback explains limitation and keeps artifacts/address analysis usable.
  - Server/LLM failure falls back to local deterministic agent.
- Success:
  - Project load logs address/building/road counts and exposes artifact links.
  - Readiness and risk cards update with concrete labels.
- Disabled:
  - Native buttons remain active where safe; no fake disabled states unless function unavailable.
- Offline/slow network, if applicable:
  - Offline deterministic preview remains the baseline.
  - Live basemap/DEM failures must degrade without blocking analysis.

## Content voice
- Tone:
  - Direct, Korean-first, technical but plain-language.
  - Explain “preview-grade” repeatedly and consistently.
- Terminology:
  - “프리뷰”, “공식 geometry”, “레이어 신뢰도”, “관거 부하”, “맨홀 역류”, “침수 면적”.
  - Avoid “완전한 실측” unless the manifest confirms official source.
- Microcopy rules:
  - Each warning should say both the problem and the next action.
  - Prefer “확인 필요” over vague “오류”.
  - Keep all generated artifact labels stable and filename-based.

## Implementation constraints
- Framework/styling system:
  - Vite + TypeScript + Three.js; no new UI framework.
  - CSS remains in `public/styles.css`.
- Design-token constraints:
  - Use CSS variables; avoid hard-coded one-off colors where possible.
- Performance constraints:
  - Do not add expensive DOM updates inside the animation frame.
  - Solver stats UI remains on the existing 500ms interval.
  - No extra heavy dependencies.
- Compatibility constraints:
  - Keep strict TypeScript passing.
  - Preserve tests for deterministic agent/core generation.
  - Keep WebGL fallback behavior.
- Test/screenshot expectations:
  - `npm run lint`, `npm test`, and `npm run build` must pass.
  - After significant frontend changes, open the local app in the in-app Browser and capture/inspect the cockpit smoke state.

## Open questions
- [ ] Should the default visual mode privilege satellite realism or schematic confidence layers? / owner: product / impact: future view toggles.
- [ ] What official-data threshold should mark a project “decision-ready”? / owner: GIS domain expert / impact: readiness scoring.
- [ ] Should sound default to on in demos? / owner: product / impact: sensory/accessibility defaults.
- [ ] Which regulatory/engineering disclaimer wording is required for external demos? / owner: legal/domain expert / impact: QA report and banner copy.
