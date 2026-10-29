# AGENTS.md

## Workflow & Git
- **Commit Trigger**: When the user replies `"OK"` or `"ok"`, immediately `git commit` current changes to the local repository **without pushing to GitHub** (unless explicitly asked to `push`). Do not auto-commit before receiving confirmation.
- **Commit Format**: Use Conventional Commits (e.g., `feat(ui): ...`, `fix(discord): ...`, `refactor(settings): ...`).
- **Keep Docs in Sync**: Reference `docs/REQUIREMENTS.md` for architecture and feature specifications, and keep both `README.md` and `docs/REQUIREMENTS.md` up to date whenever adding or modifying user-facing features, shortcuts, or settings.

## Commands
- `npm run build:ui` — Rebuilds the React + Mantine UI bundle. **Must be run after modifying UI components or any core modules they import.**
- `npm start` — Builds the UI bundle and launches the Electron app.
- `npm test` / `npx playwright test` — Builds the UI bundle and runs Playwright Electron end-to-end tests.

## Conventions
- **Third-Party Libraries First**: When implementing features, proactively search for and use well-maintained third-party libraries or existing UI framework components instead of building custom solutions or repetitive boilerplate.
- **Bilingual i18n**: All user-facing strings must support both Chinese (`zh`) and English (`en`) localization.
- **Theme Compatibility**: All UI styles must support both dark and light themes.
- **Settings Persistence**: Any new user setting must be persisted and included in profile export/import as well as the restore-defaults flow.