## Summary

Describe what changed and why. If this closes an issue, add `Closes #N` so it auto-closes on merge to `main`.

## Validation

Tick what you ran. Pre-commit covers format + lint; there is no pre-push hook.

- [ ] `vp fmt --check` / `vp lint`
- [ ] `vp run check` (the package's type gate, including the type-level tests, plus the dist-consumer declaration check)
- [ ] `vp run -r test:unit`
- [ ] `vp run -r build`
- [ ] `vp run -r docgen` (compiles and executes every JSDoc `@example`)
- [ ] `fallow audit --base origin/main`
- [ ] A changeset under `.changeset/` for every published-package change

## Notes

Anything reviewers should pay special attention to: exported signatures, declaration-emit shape (the identifier brands), the `BiblioRecord` wire shape (website persists it — any change is a major), peer ranges, behaviour ported from an application that must stay byte-compatible.
