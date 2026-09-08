/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Short commit the running bundle was built from; "local" outside CI. */
declare const __BUILD_REF__: string;
/** UTC build timestamp, to the minute. */
declare const __BUILD_TIME__: string;
