import java.io.IOException;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;

/** Java 17+ 标准库客户端。JSON fixture 直接作为请求体，业务项目可用自己的 Jackson DTO。 */
public final class ReportClient {
    private final String base;
    private final Path fixtures;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    private final MachReportClient reports;
    private ReportClient(String base, Path fixtures) { this.base = base; this.fixtures = fixtures; this.reports = new MachReportClient(URI.create(base), client); }
    private HttpResponse<byte[]> post(String path, String fixture, Duration timeout) throws IOException, InterruptedException {
        return reports.send("sample", path.substring("/reports/sample/".length()), Files.readString(fixtures.resolve(fixture)), timeout, "java-contract-1");
    }
    private static void require(boolean value, String message) { if (!value) throw new IllegalStateException(message); }
    private static String text(HttpResponse<byte[]> response) { return new String(response.body(), StandardCharsets.UTF_8); }
    private void verify(Path output) throws Exception {
        String params = "{\"plant\":\"YTS0\",\"reportDate\":\"2026-10-15\"}";
        require(reports.prepare("sample", params, Duration.ofSeconds(10), "facade-prepare").statusCode() == 200, "facade prepare failed");
        require(reports.export("sample", "xlsx", params, Duration.ofSeconds(10), "facade-export").statusCode() == 200, "facade export failed");
        try { reports.export("sample", "exe", params, Duration.ofSeconds(10), "invalid"); throw new IllegalStateException("invalid export accepted"); }
        catch (IllegalArgumentException expected) { /* Reject unsupported operations locally. */ }
        HttpResponse<String> contract = client.send(HttpRequest.newBuilder(URI.create(base + "/openapi.json")).GET().build(), HttpResponse.BodyHandlers.ofString());
        require(contract.statusCode() == 200 && contract.body().contains("\"openapi\":\"3.1.0\"") && contract.body().contains("/reports/sample/export/xlsx") && contract.body().contains("x-report-typedSchema"), "HTTP contract missing");
        Files.writeString(output.resolve("openapi.json"), contract.body());
        HttpResponse<byte[]> prepared = post("/reports/sample/prepare", "request.json", Duration.ofSeconds(10));
        require(prepared.statusCode() == 200, "prepare: " + text(prepared));
        require(prepared.headers().firstValue("x-request-id").orElse("").equals("java-contract-1"), "correlation ID lost");
        require(text(prepared).contains("12345678901234567890.123456") && text(prepared).contains("0001"), "decimal or identifier precision lost");
        // 财务/超安全整数范围使用JSON十进制字符串，Java以BigDecimal消费，避免double舍入。
        require(new BigDecimal("12345678901234567890.123456").scale() == 6, "decimal scale");
        HttpResponse<byte[]> invalid = post("/reports/sample/prepare", "invalid.json", Duration.ofSeconds(5));
        require(invalid.statusCode() == 422 && text(invalid).contains("\"code\":\"params\"") && text(invalid).contains("reportDate"), "structured parameter error lost");
        HttpResponse<byte[]> timeout = post("/reports/sample/prepare", "timeout.json", Duration.ofSeconds(5));
        require(timeout.statusCode() == 504 && text(timeout).contains("\"code\":\"timeout\""), "server timeout mapping lost");
        for (String format : new String[]{"pdf", "xlsx"}) {
            HttpResponse<byte[]> file = post("/reports/sample/export/" + format, "request.json", Duration.ofSeconds(10));
            require(file.statusCode() == 200, "export: " + text(file));
            require(file.headers().firstValue("content-disposition").orElse("").contains("sample." + format), "download filename missing");
            require(file.headers().firstValue("x-report-revision").orElse("").equals("fixture-1"), "revision missing");
            boolean header = format.equals("pdf") ? new String(file.body(), 0, 4, StandardCharsets.US_ASCII).equals("%PDF") : file.body()[0] == 0x50 && file.body()[1] == 0x4b;
            require(header, "invalid " + format + " binary");
            Files.write(output.resolve("sample." + format), file.body());
        }
        try { post("/reports/sample/prepare", "cancel.json", Duration.ofMillis(40)); throw new IllegalStateException("client timeout did not fire"); }
        catch (HttpTimeoutException expected) { /* HTTP断开取消服务器任务；下方检查队列归零。 */ }
        Thread.sleep(400);
        HttpResponse<String> health = client.send(HttpRequest.newBuilder(URI.create(base + "/health")).GET().build(), HttpResponse.BodyHandlers.ofString());
        require(health.body().contains("\"active\":0") && health.body().contains("\"pending\":0"), "task slots not released: " + health.body());
        require(!health.body().contains("\"cancelled\":0"), "disconnect cancellation not observed: " + health.body());
        System.out.println("Java contract OK: prepare, exact decimals/IDs, 422, 504, client cancellation, PDF/XLSX downloads");
    }
    public static void main(String[] args) throws Exception {
        if (args.length != 3) throw new IllegalArgumentException("ReportClient <baseUrl> <fixturesDir> <outputDir>");
        Path output = Path.of(args[2]); Files.createDirectories(output);
        new ReportClient(args[0], Path.of(args[1])).verify(output);
    }
}
