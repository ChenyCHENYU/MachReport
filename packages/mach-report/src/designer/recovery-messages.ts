export const TEMPLATE_RECOVERY_MESSAGES = {
  available: "发现未保存草稿", restore: "恢复草稿", discard: "放弃草稿", stale: "草稿基线已变化，恢复后须核对最新版本再保存。",
  localOnly: "仅保存模板、JSON 与工具配置，不保存业务数据或 Excel 文件。", autosaved: "草稿已暂存", saving: "暂存中", storageError: "草稿暂存失败", conflict: "模板版本已变化", conflictHint: "本地修改已保留。核对差异后选择处理方式，不会自动合并或覆盖。",
  baseline: "共同基线", local: "本地修改", remote: "远端修改", changes: "处差异", path: "位置", before: "原值", after: "新值", empty: "没有差异", loadLatest: "读取最新版本", adopt: "采用最新版本", rebase: "保留本地内容，以最新版本为基线", confirm: "确认更新基线", confirmHint: "此操作保留完整本地内容，不合并远端改动；下次保存将以最新修订号校验。", keepCopy: "保留独立副本", copied: "副本已保留", revision: "修订", unknown: "未发布", close: "收起差异", review: "核对版本冲突", toolsNeedSource: "Excel 映射配置已恢复，请重新选择原文件后核对。",
} as const;
export type TemplateRecoveryMessages = { [K in keyof typeof TEMPLATE_RECOVERY_MESSAGES]: string };
