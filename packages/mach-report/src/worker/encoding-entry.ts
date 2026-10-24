/** Bundler Worker entry. Import with the bundler's Worker asset mechanism, never as a UI module. */
import { serveReportEncodingWorker } from "./encoding";
serveReportEncodingWorker();
