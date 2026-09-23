/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Serve in-memory sample data instead of calling the API. Dev only. */
  readonly VITE_DEMO_MODE?: string;
  /** Absolute API URL when deployed to a different host. Defaults to "/api". */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
