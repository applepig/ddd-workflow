import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const SOURCE = readFileSync(new URL("../../../../src/ddd-workflow/scripts/claude/statusline.sh", import.meta.url), "utf8")

describe("statusline raw input logging", () => {
  it("disables raw statusline input capture by default", () => {
    expect(SOURCE).not.toContain(': "${STATUSLINE_INPUT_LOG:=/tmp/claude/statusline-input.jsonl}"')
    expect(SOURCE).toContain('logStatuslineInput "$json"')
  })

  it("keeps raw input capture opt-in through STATUSLINE_INPUT_LOG", () => {
    expect(SOURCE).toContain('"${STATUSLINE_INPUT_LOG:-}" == "0"')
  })

  it("writes raw input payload with jq argjson", () => {
    expect(SOURCE).toContain('jq -nc --arg ts "$(date -Is 2>/dev/null || date)" --argjson payload "$input"')
    expect(SOURCE).toContain("'{ts: $ts, payload: $payload}' >> \"$STATUSLINE_INPUT_LOG\"")
  })
})
