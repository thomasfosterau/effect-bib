## Summary

Describe what changed and why. If this closes an issue, add `Closes #N` so it auto-closes on merge to `main`.

## Verification

Run the gates in [AGENTS.md#verification](https://github.com/thomasfosterau/reference-manager/blob/main/AGENTS.md#verification) in order and list each command with its final pass/fail. If a gate couldn't run, say which and why.

## Changeset

A changeset under `.changeset/` for every change to a published package's behaviour (doc-comment changes included: they ship in the `.d.ts`), or "none" with the reason.

## Notes

Anything reviewers should pay special attention to: exported signatures, declaration-emit shape (the identifier brands), the `BiblioRecord` wire shape (website persists it — any change is a major), peer ranges, behaviour ported from an application that must stay byte-compatible.
