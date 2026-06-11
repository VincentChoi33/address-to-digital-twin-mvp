import { describe, expect, it } from "vitest";
import sadangManifest from "../../samples/sadang_317_6/source_manifest.json";
import sadangTwin from "../../samples/sadang_317_6/twin.json";
import type { SourceManifest, TwinProject } from "../../types/twin";
import { confidenceKo, coordinateText, geocodingStatusKo, layerRows, rainLabelText } from "../ui";

const twin = sadangTwin as unknown as TwinProject;
const manifest = sadangManifest as unknown as SourceManifest;

describe("ui helpers", () => {
  it("translates confidence levels to Korean", () => {
    expect(confidenceKo("high")).toBe("높음");
    expect(confidenceKo("medium")).toBe("중간");
    expect(confidenceKo("low")).toBe("낮음");
    expect(confidenceKo("unknown")).toBe("낮음");
  });

  it("describes geocoding providers", () => {
    expect(geocodingStatusKo("vworld")).toContain("VWorld");
    expect(geocodingStatusKo("nominatim")).toContain("Nominatim");
    expect(geocodingStatusKo("fallback")).toContain("미연결");
  });

  it("formats the center coordinate", () => {
    const text = coordinateText(twin);
    expect(text).toContain(twin.center.lat.toFixed(5));
    expect(text).toContain(twin.center.lon.toFixed(5));
  });

  it("labels rain intensity bands", () => {
    expect(rainLabelText(0)).toContain("맑음");
    expect(rainLabelText(40)).toContain("약한 강우");
    expect(rainLabelText(80)).toContain("집중호우");
    expect(rainLabelText(140)).toContain("극한 폭우");
  });

  it("renders one row per manifest layer", () => {
    const html = layerRows(manifest);
    const rowCount = (html.match(/class="layer-row"/g) ?? []).length;
    expect(rowCount).toBe(manifest.layers.length);
    for (const layer of manifest.layers) {
      expect(html).toContain(layer.name);
    }
  });
});
