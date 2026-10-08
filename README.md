# Offline QR Capture - Cylindrical Bottle Live Scanner

This is the Offline QR Capture PWA with an automatic live dual-QR scanning pipeline designed for cylindrical oil-sample bottles.

## New scanning workflow

1. Tap **New Scan**.
2. The rear camera opens automatically and the QR scan loop starts immediately.
3. Every fresh camera frame is processed independently.
4. The scanner tries the original frame plus 9 cylindrical un-distortion presets.
5. Each preset re-samples the **original frame**; distortions are never stacked.
6. QR payloads may be pooled across different presets, but only inside the **same original camera frame**.
7. The scan succeeds only when one valid **Label A** and one valid **Label B** are found in that frame.
8. The original successful camera frame is retained as the evidence image. Dewarped images are temporary and are not saved as evidence.
9. The camera stops automatically, then the existing GPS, user/device stamping, local save and export workflow continues.

There is no manual Capture / Retry / OK loop.

## Cylindrical un-distortion presets

The scanner uses 10 candidates:

- flat/original
- t=0.7, c=0
- t=0.7, c=-0.3
- t=0.7, c=+0.3
- t=1.0, c=0
- t=1.0, c=-0.3
- t=1.0, c=+0.3
- t=1.3, c=0
- t=1.3, c=-0.3
- t=1.3, c=+0.3

Successful presets are promoted and tried first on later frames.

## Camera controls

- Rear camera is the default.
- **Switch Camera** supports front/rear switching where the browser/device allows it.
- **Torch** is shown only when supported by the active camera.
- **Cancel** stops the live scan and returns to the dashboard.

## Performance design

The dewarp + QR loop runs in a Web Worker where BarcodeDetector is available there, keeping the preview responsive. A browser fallback remains available. The worker uses a roughly 1080-pixel long-edge frame for scanning while the original successful frame is preserved at higher quality for storage.

## Validation

The app does not accept arbitrary two QR codes. It requires:

- exactly one valid Label A schema, and
- exactly one valid Label B schema,

both present in the same original camera frame.

## Existing offline features retained

- local administrator and users
- device UUID/code/name
- encrypted user provisioning package
- admin recovery
- GPS capture
- IndexedDB metadata
- OPFS image storage with IndexedDB fallback
- image SHA-256
- incremental export
- USB transfer workflow
- offline PWA/service worker

## Deployment

Host all files at the HTTPS site root (GitHub Pages is suitable). `index.html`, `service-worker.js`, `assets/`, and `icons/` must all be at the same deployment root.


## Release 0.2 - record review improvements

- **Left/LH engine records** use a light blue record card with an `LH` badge.
- **Right/RH engine records** use a light green record card with an `RH` badge.
- Records with missing/unknown engine side use a neutral amber treatment with a `?` badge.
- Record cards also show Tail, Engine and Bottle identifiers near the top for faster visual checking.
- Prior records are grouped under human-readable capture-date headings such as `05 October 2026`.
- Existing **Newest first / Oldest first** sorting remains active; date grouping is applied after sorting.
- Pagination keeps a date group intact, so a day's records are not deliberately split at the normal 25-record boundary.
- Existing search, From/To filters, Admin user filter, List view and Gallery view remain available.

The blue/green styling is a visual review aid only. Consecutive same-side records are **not automatically declared incorrect**, because legitimate workflows may sometimes contain repeated engine sides.


## Release 0.1 - reliability fixes

- Exact successful camera frame is retained and saved; no fresh frame is captured after QR success.
- Scanner worker continues until one valid Label A and one valid Label B are found in the same original frame.
- Label schemas use stricter validation rules.
- Scan session IDs ignore stale worker results after cancel/restart/camera switch.
- Encrypted Device Snapshot recovery preserves users, password verifiers, device settings, recovery verifier state, and the persistent record sequence counter.
- Record-sequence changes mark the Device Snapshot as stale so the admin knows to refresh the recovery file.
- Export ZIPs are capped at 100 records and approximately 120 MB of source images.
- Export does not claim delivery confirmation. Each generated export writes `last_export_batch_id` (epoch milliseconds) and `last_exported_at`; records remain re-exportable.
- Export image filenames include the UUID as well as the readable record ID to prevent collisions after recovery/reinstallation.
- Human-facing dates, dashboard Today counts, capture dates, snapshot dates and export names use the same `Asia/Kolkata` application timezone.
- Service-worker updates no longer force immediate activation in the middle of a field task.
