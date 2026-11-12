export interface ReportDocumentMessages {
  documentBuilding: string;
  documentComplete: string;
  documentFailed: string;
  documentRefresh: string;
  documentLoading: string;
  documentCancel: string;
  documentFullExport: string;
}
export const DEFAULT_DOCUMENT_MESSAGES: ReportDocumentMessages = {
  documentBuilding: "生成中 · 已就绪 {pages} 页",
  documentComplete: "共 {pages} 页 · 按页加载",
  documentFailed: "生成已停止 · 可查看已就绪页面",
  documentRefresh: "刷新文档",
  documentLoading: "正在读取页面…",
  documentCancel: "取消",
  documentFullExport: "导出完整文档"
};
