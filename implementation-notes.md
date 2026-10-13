# Implementation notes

## Deviations

- The branch generator emits only a Codex compatibility manifest, but current source has a portable root manifest. Emit a canonical root manifest with OpenAI hooks and portable MCP configuration; update tests and install notes accordingly.
- Keep the existing `maister-local` marketplace and add a Codex entry there. This avoids changing the installed Copilot selector.
- The existing Copilot generated tree already differs from a fresh `make build`. Keep it byte-for-byte unchanged in this Codex change; CI will run Copilot build/validation without a diff gate. Reconcile Copilot drift separately.
- Source `CLAUDE.md` contains Claude-only hook and documentation claims. Generate a concise Codex `AGENTS.md` from a platform template; retain source instruction coverage through the generated skills and roles.

## Discovered edge cases

- The fork's source baseline predates the current portable manifest and many workflow changes. Generated Codex instructions must be rebuilt from current `plugins/maister/`.
- A fresh Copilot rebuild changes 24 tracked files in the baseline; those changes are outside this Codex implementation.
- Simple `CLAUDE.md` replacement produced an invalid `.claude/AGENTS.md` path in standards discovery; map that path to `AGENTS.md` explicitly.
- Native child dispatch loads generated role Markdown directly. Embed the adapter in each role Markdown so children receive it even without optional TOML configuration.

## Questions for review

## Handoff summary

- Deviations: 4, all reversible.
- Most likely to revisit: the pre-existing Copilot generated-tree drift.
- Edge cases: old fork baseline, invalid project-instruction path, native role adapter loading.
- Verification: 32 offline tests, Codex discovery of 23 skills, Copilot validation.
- Read first: `platforms/codex/build.py` and `docs/codex-parity.md`.
