import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Home from "@/app/page";

describe("placeholder home page", () => {
  it("renders the product name as the page heading", () => {
    expect(renderToString(<Home />)).toContain("<h1>Trade Marketplace</h1>");
  });
});
