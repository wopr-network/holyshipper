import { describe, expect, it } from "vitest";
import { parseSignal } from "./parse-signal.js";

describe("parseSignal", () => {
  it("returns unknown for empty string", () => {
    expect(parseSignal("")).toEqual({ signal: "unknown", artifacts: {} });
  });

  it("returns unknown for unrecognised output", () => {
    expect(parseSignal("I did some stuff and it worked fine")).toEqual({ signal: "unknown", artifacts: {} });
  });

  it("parses spec_ready", () => {
    const { signal, artifacts } = parseSignal("Spec ready: WOP-1234");
    expect(signal).toBe("spec_ready");
    expect(artifacts).toEqual({ issueKey: "WOP-1234" });
  });

  it("parses pr_created with number", () => {
    const { signal, artifacts } = parseSignal("PR created: https://github.com/wopr-network/radar/pull/99");
    expect(signal).toBe("pr_created");
    expect(artifacts).toMatchObject({ prNumber: 99, prUrl: "https://github.com/wopr-network/radar/pull/99" });
  });

  it("parses clean", () => {
    const { signal, artifacts } = parseSignal("CLEAN: https://github.com/wopr-network/radar/pull/12");
    expect(signal).toBe("clean");
    expect(artifacts).toMatchObject({ url: "https://github.com/wopr-network/radar/pull/12" });
  });

  it("parses issues", () => {
    const { signal, artifacts } = parseSignal(
      "ISSUES: https://github.com/wopr-network/radar/pull/12 — missing types; unused import",
    );
    expect(signal).toBe("issues");
    expect(artifacts).toMatchObject({
      url: "https://github.com/wopr-network/radar/pull/12",
      reviewFindings: ["missing types", "unused import"],
    });
  });

  it("parses fixes_pushed", () => {
    const { signal, artifacts } = parseSignal("Fixes pushed: https://github.com/wopr-network/radar/pull/12");
    expect(signal).toBe("fixes_pushed");
    expect(artifacts).toMatchObject({ url: "https://github.com/wopr-network/radar/pull/12" });
  });

  it("parses merged", () => {
    const { signal, artifacts } = parseSignal("Merged: https://github.com/wopr-network/radar/pull/12");
    expect(signal).toBe("merged");
    expect(artifacts).toMatchObject({ url: "https://github.com/wopr-network/radar/pull/12" });
  });

  it("parses start", () => {
    expect(parseSignal("start")).toEqual({ signal: "start", artifacts: {} });
  });

  it("parses design_needed", () => {
    expect(parseSignal("design_needed")).toEqual({ signal: "design_needed", artifacts: {} });
  });

  it("parses design_ready", () => {
    expect(parseSignal("design_ready")).toEqual({ signal: "design_ready", artifacts: {} });
  });

  it("parses cant_resolve", () => {
    expect(parseSignal("cant_resolve")).toEqual({ signal: "cant_resolve", artifacts: {} });
  });

  it("picks signal from last matching line in multi-line output", () => {
    const output = [
      "I reviewed the code carefully.",
      "PR created: https://github.com/wopr-network/radar/pull/10",
      "Some trailing commentary.",
      "PR created: https://github.com/wopr-network/radar/pull/20",
    ].join("\n");
    const { signal, artifacts } = parseSignal(output);
    expect(signal).toBe("pr_created");
    expect(artifacts).toMatchObject({ prNumber: 20 });
  });

  it("ignores signal buried in the middle when later line matches too", () => {
    const output = ["spec_ready", "PR created: https://github.com/wopr-network/radar/pull/5"].join("\n");
    const { signal } = parseSignal(output);
    expect(signal).toBe("pr_created");
  });

  it("handles windows line endings", () => {
    expect(parseSignal("start\r")).toEqual({ signal: "start", artifacts: {} });
  });
});
