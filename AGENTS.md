# Repository Guidelines

## Current Development Status
### Implemented Features (v0.0.0)
- **Chrome Translator API Integration**: Full integration with Chrome's built-in Translation API (requires Chrome ≥138)
- **Smart DOM Text Segmentation**: Intelligent algorithm for segmenting and translating web page content
- **Dual Display Modes**: Support for both overlay and replace translation modes
- **Text Styling Options**: Fuzzy and dashline text styling for translations
- **Storage Management**: Persistent settings using browser extension storage
- **React 19 Popup UI**: Modern popup interface with real-time settings management
- **Alt/Option+Click Translation**: Selective text translation with modifier key
- **Auto-translation Toggle**: Enable/disable automatic page translation

### Project Structure & Module Organization
- `entrypoints/`: WXT entrypoints — `background.ts`, `content.ts`, and `popup/` (React UI: `main.tsx`, `App.tsx`, styles).
- `lib/`: Core modules:
  - `dom-translator.ts`: DOM manipulation and translation orchestration
  - `text-segmenter.ts`: Intelligent text chunking for optimal translation
  - `storage.ts`: Settings persistence and synchronization
- `assets/`, `public/`: Static assets and icons; build output in `.output/`.
- Config: `wxt.config.ts`, `tsconfig.json`, `bun.lock`.

## Build, Test, and Development Commands
- `bun install`: Install dependencies (Bun is the package manager).
- `bun run dev`: Start WXT dev server (Chrome MV3) with hot reload.
- `bun run build`: Production build to `.output/chrome-mv3/`.
- `bun run zip`: Package the built extension as a distributable zip.
- `bun run compile`: Type-check TypeScript (no emit).

## Coding Style & Naming Conventions
- TypeScript + React 19; prefer functional components and hooks.
- Indentation: 2 spaces; avoid `any`; enable strict typing per `tsconfig.json`.
- Files: React components `PascalCase.tsx`; utilities `camelCase.ts` under `lib/`.
- Entry files must default-export WXT wrappers: `defineBackground`, `defineContentScript`.
- Styling: Tailwind CSS v4 (via `@tailwindcss/vite`); keep component styles co-located in `popup/`.

## Testing Guidelines
- No test runner is configured yet. Keep units small and pure to ease adding Vitest later (`*.test.ts` / `*.test.tsx`).
- Run `bun run compile` before PRs and validate the extension manually in Chrome.

## Commit & Pull Request Guidelines
- Commits: follow Conventional Commits (e.g., `feat: ...`, `fix: ...`).
- PRs: include a clear description, linked issues, screenshots of the popup (when UI changes), reproduction steps, and risk notes.
- CI not configured; ensure `bun run build` passes locally and attach zips if relevant.

## Security & Configuration Tips
- Chrome Translator API requires Chrome ≥ 138 desktop; code guards against absence via feature checks.
- Don't place secrets in repo; extension runs client-side. Review content script selectors before expanding scope.

## Recent Development Progress
### Latest Updates (as of commit a509e06)
- **Improved Text Node Collection**: Enhanced algorithm for collecting and processing DOM text nodes
- **Better Translation Placement**: Fixed issues with translation element positioning
- **Intelligent DOM Segmentation**: Implemented smart text chunking that respects sentence boundaries
- **Chrome API Rewrite**: Complete rewrite using Chrome's native Translator API for better performance
- **Tooltip Translation**: Added support for tooltip-based translation display

### Known Requirements & Limitations
- **Chrome Version**: Requires Chrome ≥138 (desktop only)
- **API Flag**: Users must enable "Experimental Translation API" in chrome://flags
- **Language Support**: Currently relies on Chrome's built-in language detection and translation capabilities
- **Manifest V3**: Extension uses Chrome Manifest V3 with service workers
