# Task: <what's broken>

<What the user sees. Then the evidence you gathered (sampled values, the chance setup, how
often it happens over N chances) rather than a guess. State the suspected cause and where it
lives.>

## Build
1. <The fix.>
2. <Any follow-on the fix implies, e.g. defenders must respect the same rule as the keeper.>

## Verify
Extend `tools/<test>.mjs` so this can't regress: <the assertion that would have caught it>.
Keep all existing checks passing.

## Files
`<file>`, `<file>`, `tools/<test>.mjs`.

## Done when
`npm run check` passes; frame time stays flat. Keep the report short.
