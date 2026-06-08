/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend API base URL. Empty = relative (Vite dev proxy / same-origin prod). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
