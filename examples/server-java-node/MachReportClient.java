import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Objects;

/** Dependency-free Java 17 facade. The host owns JSON DTOs, authentication, retries and transactions. */
public final class MachReportClient {
    private final URI base;
    private final HttpClient client;
    public MachReportClient(URI base) {
        this(base, HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build());
    }
    public MachReportClient(URI base, HttpClient client) {
        if (!Objects.equals(base.getScheme(), "http") && !Objects.equals(base.getScheme(), "https") || base.getHost() == null || base.getRawQuery() != null || base.getRawFragment() != null || base.getUserInfo() != null) throw new IllegalArgumentException("Expected HTTP base URI without credentials, query or fragment");
        this.base = URI.create(base.toString().replaceAll("/+$", "") + "/");
        this.client = Objects.requireNonNull(client);
    }
    /** paramsJson is the JSON object serialized by the host's DTO library; numeric wire parameters are strings. */
    public HttpResponse<byte[]> prepare(String reportId, String paramsJson, Duration timeout, String requestId) throws IOException, InterruptedException {
        return send(reportId, "prepare", "{\"params\":" + paramsJson + "}", timeout, requestId);
    }
    public HttpResponse<byte[]> export(String reportId, String format, String paramsJson, Duration timeout, String requestId) throws IOException, InterruptedException {
        if (!format.equals("pdf") && !format.equals("xlsx")) throw new IllegalArgumentException("Expected pdf or xlsx");
        return send(reportId, "export/" + format, "{\"params\":" + paramsJson + "}", timeout, requestId);
    }
    /** Retains HTTP status/error JSON/correlation header; callers decide error presentation and persistence. */
    public HttpResponse<byte[]> send(String reportId, String operation, String requestJson, Duration timeout, String requestId) throws IOException, InterruptedException {
        if (reportId == null || reportId.isBlank() || reportId.length() > 256 || reportId.equals(".") || reportId.equals("..")) throw new IllegalArgumentException("Invalid report ID");
        if (!operation.equals("prepare") && !operation.equals("export/pdf") && !operation.equals("export/xlsx")) throw new IllegalArgumentException("Invalid report operation");
        if (requestId == null || !requestId.matches("[A-Za-z0-9._-]{1,80}")) throw new IllegalArgumentException("Invalid request ID");
        String id = URLEncoder.encode(reportId, StandardCharsets.UTF_8).replace("+", "%20");
        HttpRequest request = HttpRequest.newBuilder(base.resolve("reports/" + id + "/" + operation)).timeout(timeout)
            .header("Content-Type", "application/json").header("X-Request-Id", requestId)
            .POST(HttpRequest.BodyPublishers.ofString(requestJson, StandardCharsets.UTF_8)).build();
        // No implicit retry: a timed-out or disconnected request may have reached the server.
        return client.send(request, HttpResponse.BodyHandlers.ofByteArray());
    }
}
