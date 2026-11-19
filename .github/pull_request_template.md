## Summary

What changed and why; `Closes #N` for an issue it resolves.

## Verification

Run the gates in [docs/CONTRIBUTING.md](https://github.com/thomasfosterau/effect-bib/blob/trunk/docs/CONTRIBUTING.md#before-pushing) in order and list each command with its final pass/fail. If a gate couldn't run, say which and why.

## Changeset

The changeset added, or "none" with the reason ([rules](https://github.com/thomasfosterau/effect-bib/blob/trunk/docs/CONTRIBUTING.md#changesets)).

## Notes

Anything reviewers should check closely: exported signatures, the identifier brands in the emitted declarations, the `BiblioRecord` wire shape (any change is a major), peer ranges.
