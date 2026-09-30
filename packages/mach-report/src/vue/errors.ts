/**
 * 结构化错误（code 分类，宿主可按码决定 UX：重试 / 提示 / 降级）。
 * error 事件契约保持 `(message: string)` 不变，新增第二参数 detail（可选）。
 */
export type MachReportErrorCode =
  | "param" // 缺少模板 ID 等入参问题
  | "fetch" // 数据面（网络 / 网关 / 后端业务码）
  | "validate" // 渲染计划校验失败
  | "render" // 渲染期异常
  | "pdf" // PDF 导出
  | "print" // 打印
  | "config"; // 配置缺失

export class MachReportError extends Error {
  readonly code: MachReportErrorCode;
  readonly cause?: unknown;

  constructor(code: MachReportErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "MachReportError";
    this.code = code;
    this.cause = cause;
  }
}

/** error 事件第二参数的形状（向后兼容：仅监听 message 的旧用法不受影响） */
export interface MachReportErrorDetail {
  code: MachReportErrorCode;
  cause?: unknown;
}

export function toErrorDetail(error: unknown): MachReportErrorDetail {
  if (error instanceof MachReportError) {
    return { code: error.code, cause: error.cause };
  }
  return { code: "render", cause: error };
}
