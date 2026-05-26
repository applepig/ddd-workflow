import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const SOURCE = readFileSync(new URL("./statusline.sh", import.meta.url), "utf8")

describe("statusline raw input logging", () => {
  it("enables raw statusline input capture by default", () => {
    expect(SOURCE).toContain(': "${STATUSLINE_INPUT_LOG:=/tmp/claude/statusline-input.jsonl}"')
    expect(SOURCE).toContain('logStatuslineInput "$json"')
  })

  it("allows disabling raw input capture with STATUSLINE_INPUT_LOG=0", () => {
    expect(SOURCE).toContain('"${STATUSLINE_INPUT_LOG:-}" == "0"')
  })

  it("writes raw input payload with jq argjson", () => {
    expect(SOURCE).toContain('jq -c --arg ts "$(date -Is 2>/dev/null || date)" --argjson payload "$input"')
    expect(SOURCE).toContain("'{ts: $ts, payload: $payload}' >> \"$STATUSLINE_INPUT_LOG\"")
  })
})
