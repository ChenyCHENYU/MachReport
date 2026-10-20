/** Refuse macOS browser launches from the desktop seatbelt sandbox before starting servers. */
export function assertBrowserLaunchAllowed(platform = process.platform, environment = process.env) {
  if (platform === "darwin" && environment.CODEX_SANDBOX === "seatbelt") {
    throw new Error("macOS seatbelt 禁止直接启动浏览器。请通过执行工具对本条浏览器测试命令使用 sandbox_permissions=require_escalated，或使用已授权的浏览器工具。");
  }
}
