/**
 * The build-time values Vite inlines for us.
 *
 * Declared by hand rather than pulling in `vite/client`, because the tsconfig
 * sets `types: []` deliberately and this is the only ambient type the app
 * needs. `TAURI_ENV_PLATFORM` is exposed by the `envPrefix` in vite.config.ts.
 */
interface ImportMetaEnv {
  readonly TAURI_ENV_PLATFORM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
