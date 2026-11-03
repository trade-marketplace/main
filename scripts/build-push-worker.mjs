import { build } from "esbuild";
await build({ entryPoints: ["src/service-worker/firebase-messaging.ts"], outfile: "public/firebase-messaging-worker.js", bundle: true, minify: true, format: "iife", platform: "browser", target: "es2020", sourcemap: false });
