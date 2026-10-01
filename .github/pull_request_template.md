## Summary

Describe what changed and why. If this closes an issue, add `Closes #N` so it auto-closes on merge to `main`.

## Verification

Run the gates in [AGENTS.md#verification](https://github.com/thomasfosterau/reference-manager/blob/main/AGENTS.md#verification) in order and list each command with its final pass/fail. If a gate couldn't run, say which and why.

## Changeset

Every change to a published package's behaviour carries a changeset under `.changeset/`. Changes to doc comments that reach the emitted `.d.ts` (TSDoc) take a `patch` changeset; other docs-only changes (READMEs, guidance), CI and tooling need none. Write "none" with the reason otherwise.

## Notes

Anything reviewers should pay special attention to: exported signatures, declaration-emit shape (the identifier brands), the `BiblioRecord` wire shape (website persists it — any change is a major), peer ranges, behaviour ported from an application that must stay byte-compatible.
