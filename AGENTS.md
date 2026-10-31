<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules
- The game is vanilla three.js under `src/zuma/`, booted from `src/routes/index.tsx` (ssr: false) via dynamic import of `main-rally.ts`; keep it framework-free so it stays portable to the Capacitor/Android build.
- Pure rule modules (`campaign`, `environment`, `pace-notes`, `customization`, `characters`) import no three.js; tests live in `src/zuma/game/rally-rules.test.ts`.
- Car GLB models are Lovable asset pointers in `src/assets/*.glb.asset.json`; never commit the binaries.
- Root tsconfig relaxes noUncheckedIndexedAccess / exactOptionalPropertyTypes / noPropertyAccessFromIndexSignature because the imported game code was written without them.
- Dev hooks: `window.__game` exposes `{ game, ui, input, save }`; `#game[data-scene-ready]` marks first render.
