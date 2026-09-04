/** Vite asset import: resolves to the emitted file's URL. */
declare module "*.wasm?url" {
  const url: string;
  export default url;
}
