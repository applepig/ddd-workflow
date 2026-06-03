import { describe, expect, it } from "vitest"

import { limitColumns, usedPercent } from "../../../../src/ddd-workflow/scripts/opencode/opencode-codex-usage-format.js"

describe("opencode codex usage format", () => {
  it("treats elapsed reset time as unknown usage", () => {
    const now = 1_000_000

    expect(usedPercent({ used_percent: 87, reset_at: 999 }, now)).toBe(undefined)
  })

  it("uses placeholders when no usage data exists", () => {
    const now = 1_000_000

    expect(limitColumns("5hr", undefined, now)).toEqual({
      label: " 5hr",
      percent: " --%",
      percent_value: undefined,
      reset: "--:--",
    })
  })

  it("uses placeholders when reset time has elapsed", () => {
    const now = 1_000_000

    expect(limitColumns("5hr", { used_percent: 87, reset_at: 999 }, now)).toEqual({
      label: " 5hr",
      percent: " --%",
      percent_value: undefined,
      reset: "--:--",
    })
  })

  it("keeps usage before reset time", () => {
    const now = 1_000_000

    expect(usedPercent({ used_percent: 87, reset_at: 1001 }, now)).toBe(87)
  })

  it("pads columns for two-line aligned rendering", () => {
    const now = 1_000_000

    expect(limitColumns("5hr", { used_percent: 7, reset_at: 1360 }, now)).toEqual({
      label: " 5hr",
      percent: "  7%",
      percent_value: 7,
      reset: "   6m",
    })
    expect(limitColumns("week", { used_percent: 94, reset_at: 3700 }, now)).toEqual({
      label: "week",
      percent: " 94%",
      percent_value: 94,
      reset: "  45m",
    })
  })
})
