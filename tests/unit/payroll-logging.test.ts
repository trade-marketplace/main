import { expect, it } from "vitest";
import nextConfig from "../../next.config";

it("disables framework invocation logging so private action arguments never reach the terminal", () => {
  expect(nextConfig.logging).toMatchObject({ serverFunctions: false });
});
