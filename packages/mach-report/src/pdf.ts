/**
 * PDF 直出子路径入口（@agile-team/mach-report/pdf）：
 * 矢量 PDF 生成 + 字体缓存。pdf-lib 为常规依赖，
 * 仅当导入本子路径或触发懒加载导出时才进入产物图。
 */
export * from "./pdf/index";
