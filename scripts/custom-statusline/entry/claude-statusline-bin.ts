// Claude statusline 的真實 process 殼（spec 36 M2）：stdin 全量讀入 →
// renderStatusline（真 env、真時鐘、真 fetch、真 git）→ process.stdout。
// build 以本檔為 bundler entrypoint，產出帶 `#!/usr/bin/env node` shebang 的
// 可執行檔（AC7 的 build／deploy 接線在後續階段）；邏輯全部在
// claude-statusline-entry.ts，本檔不含可測行為。
import { renderStatusline } from "./claude-statusline-entry.ts"

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString("utf8")
}

const stdin_input = await readStdin()
try {
  process.stdout.write(await renderStatusline(stdin_input))
} catch {
  // top-level boundary（spec 36 Issue #1、使用者裁決「error 跳 silent fail、繼續用 last state」）：
  // render 內部非預期錯誤不該讓 statusline 整條空白並以非零退出。輸出空字串、正常退出（exit 0），
  // Claude Code harness 會保留上一次的 statusline 畫面。錯誤不輸出到 stdout。
  process.stdout.write("")
}
