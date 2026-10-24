import ExcelJS from "exceljs";
import { serveReportEncodingWorker } from "../worker/encoding";

// Observe the actual third-party writeBuffer Promise without replacing compression.
const descriptor = Object.getOwnPropertyDescriptor(ExcelJS.Workbook.prototype, "xlsx")!;
Object.defineProperty(ExcelJS.Workbook.prototype, "xlsx", { ...descriptor, get() {
  const xlsx = descriptor.get!.call(this);
  if (!xlsx.__observed) {
    xlsx.__observed = true;
    const original = xlsx.writeBuffer.bind(xlsx);
    xlsx.writeBuffer = (...args: unknown[]) => {
      const pending = original(...args);
      postMessage({ qa: "zip-started" });
      void pending.then(() => postMessage({ qa: "zip-completed" }));
      return pending;
    };
  }
  return xlsx;
} });
serveReportEncodingWorker();
