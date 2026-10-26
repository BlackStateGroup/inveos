# 05 — Visual and interaction design

INVEOS belongs to Black State Group but should feel like a professional evidence instrument, not a military fantasy dashboard. The visual reference is restrained noir: deep charcoal, gunmetal dividers, ivory typography, rare amber for a selected/actionable state and restrained teal for verified receipts. Colour must never be the sole indicator.

## Tokens (proposal, to audit for contrast)

- Canvas `#0B0D0F`; surface `#12161A`; raised `#1A2025`; border `#303942`.
- Text primary `#ECEDE9`; muted `#A5B0B8`; amber accent `#CBA45A`; verified `#76C4B0`; danger `#D97570`.
- Data tables with fixed numeric alignment and dense but comfortable rows; 4/8/12/16/24 spacing rhythm.
- Sans type with strong numerals; monospaced only for case IDs, digests, UTC event time and paths.
- Icons are descriptive, quiet and consistent; photography never substitutes for usable controls.

## Four visual modes

1. **Case/brief:** clean, readable dossier and task context.
2. **Intelligence:** graph canvas, side evidence inspector, explicit certainty and edge-source linkage.
3. **Evidence:** file list, thumbnails and immutable file metadata with selected detail viewer.
4. **Report:** publication-quality typography and paginated preview, visible review blockers.

## High-value micro-interactions

- Selecting a graph edge opens its evidence source in the right inspector without losing graph position.
- Selecting a report citation opens its exact page or timecode in split view.
- Upload progress separately shows bytes received, server digest verified and item linked to case.
- `Approve` requires clear actor attribution and shows published scope; no ambiguous green tick.
- Mobile voice dictation has distinct `Original audio`, `Machine transcript` and `Reviewed note` tabs.

## Screen prototype acceptance

Create responsive desktop case board, evidence viewer, graph + inspector, AI review desk, report builder, client release screen and native-like mobile capture/queue. Test dense and empty states; error, unsynced, unsupported, restricted and approved conditions. Real type scale, contrast checks and keyboard focus are required before UI sign-off.
