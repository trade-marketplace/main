import { expect, it } from "vitest";
import nextConfig from "../../next.config";

it("keeps private server-action message arguments out of Next's invocation logger", () => {
  expect(nextConfig.logging).toMatchObject({ serverFunctions: false });
});
