# Cloudflare model registry

TetraFlux performs training in browser Web Workers. Cloudflare Pages stores and serves the resulting JSON models; it does not run the candidate simulations.

## Architecture

```text
Browser CPU
  ├─ Flat CEM / All-Spin CEM
  ├─ localStorage + IndexedDB checkpoint
  └─ POST completed model
          ↓
Cloudflare Pages Function
          ↓
Workers KV binding: MODELS
```

Static pages and bundled Workers are delivered by Cloudflare Pages. The following lightweight Function routes provide the model registry:

- `GET /api/models/?family=flat|allspin`
- `GET /api/models/:modelId`
- `GET /api/models/latest/:family`
- `POST /api/models/`

Reads are public. Uploads require `Authorization: Bearer <MODEL_WRITE_TOKEN>`.

## One-time Cloudflare setup

1. Open the Cloudflare dashboard and create a Workers KV namespace for TetraFlux models.
2. Open the TetraFlux Pages project.
3. Under **Settings → Bindings**, add a **KV namespace binding**.
4. Set the variable name to exactly:

   ```text
   MODELS
   ```

5. Bind it to the namespace created in step 1.
6. Under **Settings → Environment variables / Secrets**, create an encrypted secret named:

   ```text
   MODEL_WRITE_TOKEN
   ```

7. Give it a long random value. Do not commit this value to the repository.
8. Apply the binding and secret to Production and Preview as appropriate, then redeploy.

The browser UI asks for the same token only when uploading. It is sent over HTTPS and retained in `sessionStorage`, not embedded in the JavaScript bundle or saved permanently.

Without `MODELS` or `MODEL_WRITE_TOKEN`, the static game/training pages still deploy. Model registry operations show a configuration error instead.

## Model names

Cloud models use readable immutable IDs:

```text
flat-g0008-20260721T143012Z-a1b2
allspin-g0003-20260721T151500Z-c3d4
```

The ID contains:

- model family,
- best generation,
- UTC creation timestamp,
- short collision-avoidance suffix.

Each stored item is a `tetraflux_model_envelope_v1` envelope. The envelope keeps the readable model ID and lineage metadata separate from the inner runtime profile format.

All-Spin envelopes may include `parentModelId`, pointing to the uploaded Flat model used as their frozen board evaluator. The full Flat profile is also embedded in the All-Spin payload so the derived model remains self-contained.

## Browser behavior

- `/training/` trains and uploads Flat models.
- `/training/allspin/` trains All-Spin models derived from the active Learned Heuristic.
- `/` and `/benchmark/` use locally cached profiles.
- When no local profile exists, the page attempts to load the latest Cloudflare model for each family and caches it locally.
- Local training never silently overwrites a cloud model. Upload creates a new immutable ID and updates the family `latest` pointer.

## Cost boundary

The expensive work remains in the user's browser:

- game simulation,
- candidate evaluation,
- Worker Pool execution,
- CEM generation updates.

Cloudflare receives only short list/get/upload requests for JSON. Moving the training loop into Pages Functions or Workers would consume Worker CPU time and would be subject to Worker CPU limits and billing. This implementation deliberately avoids that design.
