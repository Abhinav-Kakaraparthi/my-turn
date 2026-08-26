# Contributing

My Turn favors small, explicit components over framework-heavy abstractions.

## Engineering rules

- Build only what the current user flow requires.
- Prefer browser, language, and existing dependency capabilities before adding code.
- Keep source files under 500 lines; split them before they become difficult to review.
- Keep functions focused on one responsibility.
- Separate camera processing, recognition, agent orchestration, persistence, and speech.
- Validate all data crossing browser, API, model, and storage boundaries.
- Never commit credentials, private recordings, restricted datasets, or trained weights.
- Raw camera video stays on the device unless the user explicitly enables diagnostic capture.
- Gemini may compose language from recognized evidence, but it may not invent signs or intent.
- Speech requires deterministic confidence checks or explicit user confirmation.
- Unknown or ambiguous gestures must be rejected instead of forced into a known class.
- Every nontrivial behavior must have one focused automated test.
- Fix root causes in shared logic rather than adding duplicated guards.
- Prefer readable code over clever code.
- Remove unused code, dependencies, flags, and abstractions immediately.

## Definition of done

A change is complete only when:

1. Its behavior is understandable from the code.
2. Relevant tests pass.
3. Formatting, linting, and type checks pass.
4. Error and empty states are handled.
5. Accessibility and privacy behavior are preserved.
6. Documentation changes when an external contract changes.

## Commit style

Use concise conventional commits:

- `feat:` user-facing capability
- `fix:` defect correction
- `test:` test-only change
- `docs:` documentation
- `refactor:` behavior-preserving restructuring
- `chore:` tooling or project maintenance
