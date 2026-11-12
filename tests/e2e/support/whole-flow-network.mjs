// Explicit test-process preload, never imported by the app. Real app requests stay on localhost.
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";

const local = host => ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
if (process.env.WHOLE_FLOW_TEST_NETWORK !== "1") throw Error("Whole-flow network fixture must be explicitly enabled");
for (const key of ["DATABASE_URL", "DIRECT_URL", "NEXT_PUBLIC_SUPABASE_URL"]) {
  const url = new URL(process.env[key]);
  if (!local(url.hostname) || url.search || url.hash || (key !== "NEXT_PUBLIC_SUPABASE_URL" && url.pathname !== "/lane_d_191")) throw Error("Whole-flow services must be disposable localhost fixtures");
}
if (process.env.SUPABASE_SECRET_KEY !== "sb_secret_photo_test_only_not_a_real_key") throw Error("Whole-flow Storage requires only its local stand-in key");
for (const key of ["STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET", "RESEND_API_KEY"]) {
  if (process.env[key]) throw Error(`Whole-flow fixture requires ${key} unset`);
}
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname === "api.mapbox.com" && url.pathname === "/search/geocode/v6/forward" && url.searchParams.get("access_token") === "pk.wholeflowlocal") {
    return Response.json({ features: [{ properties: { mapbox_id: "whole-flow-local-address", feature_type: "address", name: "191 Whole Flow Street", full_address: "191 Whole Flow Street, Windsor, Invercargill 9810", coordinates: { latitude: -46.3961, longitude: 168.3561 }, context: { locality: { name: "Windsor" }, place: { name: "Invercargill" }, postcode: { name: "9810" } } } }] });
  }
  if (!local(url.hostname)) throw Error(`Whole-flow fixture refused external fetch to ${url.hostname}`);
  return nativeFetch(input, init);
};
// Cover SDKs using Node's HTTP client too, before Next imports them.
for (const transport of [http, https]) for (const method of ["request", "get"]) {
  const native = transport[method];
  transport[method] = (...args) => {
    const first = args[0];
    const host = typeof first === "string" || first instanceof URL ? new URL(first).hostname : first.hostname ?? first.host ?? "localhost";
    if (!local(host)) throw Error(`Whole-flow fixture refused external HTTP to ${host}`);
    return native.apply(transport, args);
  };
}
syncBuiltinESMExports();
