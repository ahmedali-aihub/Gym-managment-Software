/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Serve in-memory sample data instead of calling the API. Dev only. */
  readonly VITE_DEMO_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
