// Bundle the server (and the shared TypeScript package) into one ESM file for production.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // Native / CommonJS packages stay external and load from node_modules.
  external: ['@node-rs/argon2', 'pg', 'ws'],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
