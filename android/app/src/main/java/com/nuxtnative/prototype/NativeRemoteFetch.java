package com.nuxtnative.prototype;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Optional HTTP server boundary for projects that deploy their API remotely. */
public final class NativeRemoteFetch implements AutoCloseable {
    public interface Callback { void complete(String response, String failure); }

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Context context;

    public NativeRemoteFetch(Context context) {
        this.context = context.getApplicationContext();
    }

    public void fetch(String baseUrl, String path, String method, String body, String headers, Callback callback) {
        executor.execute(() -> {
            try {
                callback.complete(request(baseUrl, path, method, body, headers), "");
            } catch (Throwable error) {
                callback.complete(null, error.getMessage() == null ? String.valueOf(error) : error.getMessage());
            }
        });
    }

    private String request(String baseUrl, String path, String method, String body, String headers) throws Exception {
        String target = resolveUrl(baseUrl, path);
        HttpURLConnection connection = (HttpURLConnection) new URL(target).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setRequestMethod(method == null || method.isEmpty() ? "GET" : method.toUpperCase(Locale.ROOT));
        connection.setDoInput(true);

        JSONObject requestHeaders = parseObject(headers);
        boolean hasContentType = false;
        Iterator<String> keys = requestHeaders.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if ("content-type".equalsIgnoreCase(key)) hasContentType = true;
            connection.setRequestProperty(key, requestHeaders.optString(key, ""));
        }
        if (body != null && !body.isEmpty() && !"null".equals(body)) {
            connection.setDoOutput(true);
            if (!hasContentType) connection.setRequestProperty("Content-Type", "application/json");
            connection.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8));
        }

        int status = connection.getResponseCode();
        String statusMessage = connection.getResponseMessage();
        InputStream source = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        String rawBody = source == null ? "" : read(source);
        Object parsedBody = parseBody(rawBody);
        JSONObject responseHeaders = new JSONObject();
        for (Map.Entry<String, java.util.List<String>> entry : connection.getHeaderFields().entrySet()) {
            if (entry.getKey() == null || entry.getValue() == null || entry.getValue().isEmpty()) continue;
            String key = entry.getKey().toLowerCase(Locale.ROOT);
            StringBuilder value = new StringBuilder();
            for (String part : entry.getValue()) {
                if (part == null || part.isEmpty()) continue;
                if (value.length() > 0) value.append(", ");
                value.append(part);
            }
            if (value.length() > 0) responseHeaders.put(key, value.toString());
        }
        connection.disconnect();
        return new JSONObject()
                .put("__nuxtNativeResponse", true)
                .put("body", parsedBody)
                .put("status", status)
                .put("statusMessage", statusMessage == null ? "" : statusMessage)
                .put("headers", responseHeaders)
                .toString();
    }

    private static String resolveUrl(String baseUrl, String path) {
        String base = String.valueOf(baseUrl).trim();
        String requested = path == null || path.isEmpty() ? "/" : path;
        if (requested.startsWith("http://") || requested.startsWith("https://")) return requested;
        while (base.endsWith("/")) base = base.substring(0, base.length() - 1);
        if (!requested.startsWith("/")) requested = "/" + requested;
        return base + requested;
    }

    private static JSONObject parseObject(String value) throws Exception {
        if (value == null || value.isEmpty() || "null".equals(value)) return new JSONObject();
        Object parsed = new JSONTokener(value).nextValue();
        return parsed instanceof JSONObject ? (JSONObject) parsed : new JSONObject();
    }

    private static Object parseBody(String value) {
        if (value == null || value.isEmpty()) return JSONObject.NULL;
        try { return new JSONTokener(value).nextValue(); }
        catch (Exception ignored) { return value; }
    }

    private static String read(InputStream source) throws Exception {
        try (InputStream input = new BufferedInputStream(source); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    @Override public void close() { executor.shutdownNow(); }
}
