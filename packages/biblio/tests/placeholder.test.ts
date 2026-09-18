import { describe, expect, it } from "vite-plus/test";
import { placeholder } from "@thomasfosterau/biblio";
import { sourcesPlaceholder } from "@thomasfosterau/biblio/sources";

describe("placeholder", () => {
  it("both entry points resolve", () => {
    expect(placeholder).toBe("biblio");
    expect(sourcesPlaceholder).toBe("biblio/sources");
  });
});
