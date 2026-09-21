# WorldTour

**WorldTour** is a reproducible benchmark for AI-guided heuristic routing over the capitals of the world.

The core experiment is deliberately simple:

> Given the current capital and a shared set of candidate capitals with distance information, can a small structured decision engine repeatedly choose the next destination well enough to produce a short complete world-capital tour?

The project is primarily a **JEV / System One benchmark**, with classical heuristics and frontier-model baselines for comparison.

## What it solves

WorldTour builds a closed route that:

- starts at a selected home/start city (Bengaluru by default)
- visits all **195 supplied country-capital nodes exactly once**
- returns to the start
- minimizes total great-circle distance
- reports both raw and post-processed route quality

This is a **heuristic TSP experiment**. It does not claim that any method finds the globally optimal 195-city tour.

## Benchmark methods

### Classical

- **Random**
- **Nearest Neighbor**
- **Nearest Neighbor + 2-opt**

### JEV

- **JEV**
- **JEV + 2-opt**
- **JEV Distance**
- **JEV Distance + 2-opt**
- **JEV Matrix**
- **JEV Matrix + 2-opt**

JEV is used as a narrow decision primitive: at each step it chooses exactly one supplied candidate.

### Hierarchical JEV

- **JEV Clustered**
- **JEV Clustered + 2-opt**

The clustered experiment is intentionally different:

1. Capitals are grouped into geographic regions.
2. JEV chooses the next region.
3. A deterministic local heuristic orders capitals inside that region.
4. Optional 2-opt improves the resulting full route.

This reduces the number of JEV decisions substantially, so clustered results represent a **hierarchical speed/quality trade-off**, not an apples-to-apples replacement for 195 capital-level decisions.

### Model baselines

- **AI Engine** — configurable OpenRouter model
- **AI Engine + 2-opt**
- **GitHub Copilot**
- **GitHub Copilot + 2-opt**
- **Claude CLI** — one model decision per route step
- **Claude CLI + 2-opt**
- **Claude Full Problem** — gives the complete 195-capital problem to Claude in a single call

## Fairness model

For sequential decision methods, each step exposes the same basic structure:

```text
current capital
remaining capital count
8 candidate capitals
current → candidate distance
```

Every decision engine must return exactly one candidate from the supplied set.

The benchmark records:

- final route distance
- raw route distance before 2-opt
- 2-opt improvement
- number of decisions / JEV calls
- per-decision latency
- total runtime
- one-step oracle agreement where applicable
- average one-step regret where applicable
- provider communication traces for supported AI methods

The candidate generator is shared across JEV and model baselines.

## Oracle and regret

The benchmark includes a **one-step lookahead oracle**. It is not a global TSP solver.

For each candidate:

```text
cost =
  distance(current, candidate)
  + nearest distance(candidate, any other remaining capital)
```

The oracle selects the candidate with the lowest cost.

**Oracle agreement** measures how often a decision matches this one-step oracle.

**Regret** is the selected candidate's one-step cost minus the oracle candidate's cost.

For hierarchical JEV, capital-level oracle metrics are intentionally omitted because the JEV decision is made at the region level.

## Representative benchmark run

One recorded run produced:

| Method | Calls / decisions | Raw km | Final km | Time |
|---|---:|---:|---:|---:|
| JEV | 195 | 180,318 | 180,318 | 74.37 s |
| JEV + 2-opt | 195 | 180,318 | 150,910 | 72.36 s |
| JEV Clustered | 24 regions | 189,510 | 189,510 | 8.85 s |
| JEV Clustered + 2-opt | 24 regions | 189,510 | 153,982 | 8.48 s |

These are representative benchmark results, not universal rankings. Results depend on the selected start, provider/model configuration, candidate seed, dataset, and runtime environment.

The clustered experiment demonstrates the intended hierarchical trade-off: far fewer JEV calls and substantially lower runtime, with route quality recovered by deterministic 2-opt.

## Route optimization

WorldTour separates **decision quality** from **route post-processing**.

For methods with `+ 2-opt`:

1. the decision engine produces a complete raw route
2. deterministic 2-opt searches for improving route reversals
3. the optimized route and raw route are both retained

This prevents the post-processor from being mistaken for the AI decision engine.

## Capital dataset

The benchmark uses a pinned GeoJSON capital dataset:

```text
https://raw.githubusercontent.com/Stefie/geojson-world/46cbac88be743326b247baee180928683d0afe9f/capitals.geojson
```

The application expects 195 country-capital entries and applies explicit conventions/overrides for several countries where capital representation is ambiguous or differs from the source dataset.

The home/start city is represented separately from India's New Delhi node, so Bengaluru does not collide with the India capital entry.

## Architecture

```text
                 ┌──────────────────────┐
                 │   Capital dataset    │
                 │      195 nodes       │
                 └──────────┬───────────┘
                            │
                    distance / candidates
                            │
             ┌──────────────┴──────────────┐
             │                             │
       Sequential engines            Global experiment
             │                             │
       ┌─────┼─────────────┐         Claude Full Problem
       │     │             │
      JEV   Copilot     AI Engine
       │     │             │
       └─────┼─────────────┘
             │
        complete route
             │
           2-opt
             │
        benchmark metrics
```

### JEV request flow

The intended V1 JEV flow is deliberately narrow:

```text
195 × 195 distance information
          ↓
     current capital
          ↓
   shared candidates
          ↓
          JEV
          ↓
     next capital
          ↓
     remove visited
          ↓
        repeat
          ↓
   complete 195-city route
```

The server keeps provider credentials out of the browser. Provider requests and responses can be surfaced in the UI communication trace for inspection.

## Running locally

Requirements:

- Node.js
- npm
- JEV provider configuration for live JEV runs (optional; deterministic demo mode is available without it)
- optional OpenRouter API key
- optional GitHub Copilot token/entitlement
- optional Claude CLI installation

Install:

```bash
npm install
```

Create `.env.local` from `.env.example` and configure the providers you want.

Start development:

```bash
npm run dev
```

Then open `http://localhost:3000`.

Production build:

```bash
npm run build
npm run start
```

## Environment variables

### JEV

```env
JEV_API_URL=
JEV_API_KEY=
JEV_MODEL=
```

If JEV credentials are absent, the app uses a deterministic local demo policy so the UI and benchmark flow remain usable.

### OpenRouter

```env
OPENROUTER_API_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### GitHub Copilot

```env
COPILOT_GITHUB_TOKEN=
COPILOT_MODEL=gpt-5.4
COPILOT_MODELS=gpt-5.4
```

`GH_TOKEN` / `GITHUB_TOKEN` are also accepted as server-side fallbacks.

### Claude CLI

Claude methods use the server's installed `claude` executable. No API key is required by this integration when the CLI is already authenticated.

Supported model labels:

```text
haiku
sonnet
opus
```

## Benchmarking guidance

For a clean comparison:

1. Keep the same start city.
2. Keep the same capital dataset.
3. Keep the same candidate-generation seed.
4. Compare methods receiving the same candidate sets.
5. Compare raw routes before looking at 2-opt.
6. Treat 2-opt as deterministic post-processing.
7. Report runtime and number of model/JEV calls separately.
8. Do not interpret one-step oracle agreement as proof of global route quality.
9. Do not interpret a heuristic route as a globally optimal TSP solution.

Useful headline metrics are:

> **How much route quality do we get per decision?**

For hierarchical JEV:

> **How much route quality do we get per JEV call?**

## UI

The application provides:

- interactive world route map
- text-only route view
- algorithm selection
- provider/model selection
- live decision trace
- expandable provider communication logs
- benchmark scorecards
- raw vs optimized route distance
- route timing
- oracle/regret telemetry where applicable

The communication panel makes the benchmark auditable: the request sent to a provider and the returned response can be inspected instead of treating the model as a black box.

## Project status

The JEV benchmark, clustered JEV experiment, provider integrations, Claude full-problem experiment, communication tracing, and benchmark scorecard are implemented on `main`.

The remaining validation gate is a clean local production build plus browser verification of the merged `main` branch. No benchmark result in this README should be treated as a formal optimum certificate.

## Repository

https://github.com/krushideep/Worldtour
