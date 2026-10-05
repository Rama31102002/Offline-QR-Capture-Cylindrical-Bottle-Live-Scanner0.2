# Release 0.2

## Added
- Date-grouped prior-record view with headings such as `05 October 2026`.
- Left/LH engine records use a light blue card and `LH` badge.
- Right/RH engine records use a light green card and `RH` badge.
- Unknown engine side uses a neutral warning treatment and `?` badge.
- Record cards surface Tail, Engine and Bottle identifiers for faster visual checking.
- Date groups stay intact across the normal Load More boundary where possible.
- Service-worker cache cleanup is scoped to this scanner cache prefix so unrelated caches on the same web origin are not deleted.

## Retained
- Newest/Oldest sorting, search, date range filters, Admin user filter, List/Gallery modes and all existing scanner/storage/export/recovery behaviour remain unchanged.

## Note
- Engine-side colour is a visual review aid. Consecutive same-side records are not automatically marked as errors.

# Release 0.6.1

## Changed
- Label parsing now follows the real QR specification sheets and is structural, not content-strict:
  - Trailing `;` is optional on Label A and Label B (raw scanned text is stored unchanged; a normalized form is stored alongside).
  - Engine side is normalized (L/LEFT -> LH, R/RIGHT -> RH); the as-scanned value is kept in `engine_side_raw`. Unrecognized values are saved with a warning instead of blocking the scan.
  - Unusual Crate/X/Y/Future values are saved with a warning instead of being rejected.
  - Still required: Label A = 7 segments, numeric UUID (5+ digits), 2-digit Rack and Shelf; Label B = 4 segments, numeric UUID (5+ digits).
- Duplicate-capture check compares normalized labels, so the same label with/without `;` counts as the same.
- Record detail shows any label warnings.

# Offline QR Capture - Release 0.6

## Fixed

1. Exact-frame evidence: the stored photograph is now the same original frame that produced the accepted Label A + Label B decode.
2. Reinstall recovery: encrypted Device Snapshot restores local users/password verifiers, device identity/settings, recovery verifier state, and the persistent record sequence counter.
3. Export memory safety: each ZIP is limited to 100 records and approximately 120 MB of source images.
4. Export tracking: records are no longer permanently marked "exported". Each generated ZIP writes a latest export batch ID (epoch milliseconds) and timestamp, and records remain re-exportable.
5. Time consistency: capture dates, dashboard Today counts, filenames and user-facing timestamps use Asia/Kolkata consistently.

## Additional hardening

- Worker only stops after one valid Label A and one valid Label B are found in the same original frame.
- Stricter Label A / Label B schema validation.
- Scan session IDs prevent stale worker results after cancel/restart/camera switching.
- Re-export controls for current user and admin/all users.
- Export image filenames include record UUID to avoid collisions.
- Persistent sequence counter increments transactionally and marks recovery snapshot stale.
- Failed database saves clean up OPFS image files.
- Service worker no longer forces immediate activation during an active field session.
