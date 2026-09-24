/// <reference types="vite/client" />

/**
 * Extends Vite's own ImportMetaEnv (DEV, PROD, MODE, SSR, ...) rather than
 * redeclaring it. An earlier version of this file declared ImportMetaEnv
 * and ImportMeta from scratch, which shadowed Vite's fields instead of
 * merging with them — `import.meta.env.DEV` type-checked locally only
 * because the full toolchain happened to fill the gap some other way, and
 * failed outright in a clean, production-only install:
 *
 *     error TS2339: Property 'DEV' does not exist on type 'ImportMetaEnv'
 *
 * Declaration merging (same interface name, no redeclaration of ImportMeta
 * itself) is what actually adds fields without hiding Vite's own.
 */
interface ImportMetaEnv {
  /** Serve in-memory sample data instead of calling the API. Dev only. */
  readonly VITE_DEMO_MODE?: string;
  /** Absolute API URL when deployed to a different host. Defaults to "/api". */
  readonly VITE_API_URL?: string;
}
