package com.nuxtnative.prototype;

import app.cash.quickjs.QuickJs;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.util.HashMap;
import java.util.Iterator;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Executes the explicitly supported embedded server route subset in-process. */
public final class NativeServer implements AutoCloseable {
    public interface AssetReader { String read(String name) throws Exception; }
    public interface AsyncCallback { void complete(String body, String failure); }
    public interface AsyncRequester { void fetch(String path, String method, String body, String headers, AsyncCallback callback); }

    private final AssetReader assets;
    private final Map<String, String> routes = new HashMap<>();
    private final List<RouteEntry> routeEntries = new ArrayList<>();
    private final java.util.List<String> middlewareAssets = new java.util.ArrayList<>();
    private final java.util.List<String> serverPluginAssets = new java.util.ArrayList<>();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    public NativeServer(AssetReader assets) {
        this.assets = assets;
    }

    public void loadManifest() throws Exception {
        JSONArray values = new JSONObject(assets.read("server-routes.json")).getJSONArray("routes");
        for (int i = 0; i < values.length(); i++) {
            JSONObject route = values.getJSONObject(i);
            String method = route.getString("method");
            String path = route.getString("path");
            String asset = route.getString("asset");
            routes.put(key(method, path), asset);
            routeEntries.add(new RouteEntry(method, path, asset));
        }
        try {
            JSONArray middleware = new JSONObject(assets.read("server-middleware.json")).getJSONArray("middleware");
            for (int i = 0; i < middleware.length(); i++) middlewareAssets.add(middleware.getJSONObject(i).getString("asset"));
        } catch (java.io.FileNotFoundException ignored) {
            // Older asset bundles may not contain server middleware.
        }
        try {
            JSONArray plugins = new JSONObject(assets.read("server-plugins.json")).getJSONArray("plugins");
            for (int i = 0; i < plugins.length(); i++) serverPluginAssets.add(plugins.getJSONObject(i).getString("asset"));
        } catch (java.io.FileNotFoundException ignored) {
            // Older asset bundles may not contain server plugins.
        }
    }

    public synchronized String fetch(String path, String method, String body) {
        return fetch(path, method, body, "{}");
    }

    public synchronized String fetch(String path, String method, String body, String headers) {
        QuickJs runtime = QuickJs.create();
        try {
            String normalizedPath = path.split("[?#]", 2)[0];
            RouteMatch route = resolveRoute(method, normalizedPath);
            if (route == null) return errorResponse(404, "Not Found", "No embedded server route for " + method + " " + path, null, new JSONObject());
            Object parsedBody = parseJson(body);
            JSONObject event = new JSONObject()
                    .put("body", parsedBody)
                    .put("method", method.toUpperCase())
                    .put("path", normalizedPath)
                    .put("url", path)
                    .put("params", route.params)
                    .put("query", parseQuery(path))
                    .put("context", new JSONObject())
                    .put("headers", parseHeaders(headers));
            initializeServerPlugins(runtime);
            event = runServerHook(runtime, "request", event);
            JSONObject requestHookError = event.optJSONObject("__nuxtHookError");
            if (requestHookError != null) return errorResponse(requestHookError.optInt("statusCode", 500), requestHookError.optString("statusMessage", "Server plugin hook failed"), requestHookError.optString("message", "Server plugin hook failed"), requestHookError.opt("data"), new JSONObject());
            if (event.optBoolean("__nuxtAborted", false)) return errorResponse(403, "Forbidden", "Embedded server plugin aborted the request", null, new JSONObject());
            runtime.evaluate("var __nuxtEvent = " + event.toString() + ";");
            for (String middleware : middlewareAssets) {
                runtime.evaluate(assets.read(middleware), middleware);
                Object middlewareResult = runtime.evaluate("typeof __nuxtInvokeServerHandler === 'function' ? __nuxtInvokeServerHandler(__nuxtEvent) : undefined;");
                if (Boolean.FALSE.equals(middlewareResult)) return errorResponse(403, "Forbidden", "Embedded server middleware aborted the request", null, new JSONObject());
            }
            runtime.evaluate(assets.read(route.asset), route.asset);
            Object result = runtime.evaluate("JSON.stringify((function(){ try { var body = __nuxtInvokeServerHandler(__nuxtEvent); if (__nuxtEvent.responseBody !== undefined) body = __nuxtEvent.responseBody; return { __nuxtNativeResponse: true, body: body, status: __nuxtEvent.statusCode || 200, statusMessage: __nuxtEvent.statusMessage || '', headers: __nuxtEvent.responseHeaders || {} }; } catch (error) { var status = error && error.statusCode || 500; var statusMessage = error && error.statusMessage || error && error.message || 'Server error'; return { __nuxtNativeError: true, body: { statusCode: status, statusMessage: statusMessage, message: error && error.message || 'Server error', data: error && error.data === undefined ? null : error.data }, status: status, statusMessage: statusMessage, headers: __nuxtEvent.responseHeaders || {} }; } })());");
            if (result == null || "null".equals(String.valueOf(result))) return "null";
            JSONObject response = new JSONObject(String.valueOf(result));
            event.put("response", response);
            event = runServerHook(runtime, "beforeResponse", event);
            JSONObject responseHookError = event.optJSONObject("__nuxtHookError");
            if (responseHookError != null) return errorResponse(responseHookError.optInt("statusCode", 500), responseHookError.optString("statusMessage", "Server plugin hook failed"), responseHookError.optString("message", "Server plugin hook failed"), responseHookError.opt("data"), new JSONObject());
            Object updated = event.opt("response");
            if (updated instanceof JSONObject) response = (JSONObject) updated;
            event.put("response", response);
            runServerHook(runtime, "afterResponse", event);
            return response.toString();
        } catch (Exception error) {
            Log.e("NuxtNative", "Embedded server request failed", error);
            return errorResponse(500, "Embedded Server Error", "Embedded server request failed: " + method + " " + path, null, new JSONObject());
        } finally {
            runtime.close();
        }
    }

    public void fetchAsync(String path, String method, String body, AsyncCallback callback) {
        fetchAsync(path, method, body, "{}", callback);
    }

    public void fetchAsync(String path, String method, String body, String headers, AsyncCallback callback) {
        executor.execute(() -> {
            try {
                callback.complete(fetch(path, method, body, headers), "");
            } catch (Throwable error) {
                callback.complete(null, String.valueOf(error.getMessage() == null ? error : error.getMessage()));
            }
        });
    }

    private static String key(String method, String path) { return method.toUpperCase() + " " + path; }

    private static Object parseJson(String value) throws Exception {
        if (value == null || value.equals("null")) return JSONObject.NULL;
        return new JSONTokener(value).nextValue();
    }

    private static JSONObject parseHeaders(String value) throws Exception {
        Object parsed = parseJson(value);
        if (!(parsed instanceof JSONObject)) return new JSONObject();
        JSONObject normalized = new JSONObject();
        Iterator<String> keys = ((JSONObject) parsed).keys();
        while (keys.hasNext()) {
            String key = keys.next();
            normalized.put(key.toLowerCase(Locale.ROOT), ((JSONObject) parsed).get(key));
        }
        return normalized;
    }

    private static String errorResponse(int status, String statusMessage, String message, Object data, JSONObject headers) {
        try {
            JSONObject body = new JSONObject()
                    .put("statusCode", status)
                    .put("statusMessage", statusMessage)
                    .put("message", message)
                    .put("data", data == null ? JSONObject.NULL : data);
            return new JSONObject()
                    .put("__nuxtNativeError", true)
                    .put("body", body)
                    .put("status", status)
                    .put("statusMessage", statusMessage)
                    .put("headers", headers == null ? new JSONObject() : headers)
                    .toString();
        } catch (Exception error) {
            return "{\"__nuxtNativeError\":true,\"body\":{\"status\":500,\"message\":\"Embedded server error\"},\"status\":500,\"headers\":{}}";
        }
    }

    private RouteMatch resolveRoute(String method, String path) {
        String exact = routes.get(key(method, path));
        if (exact != null) return new RouteMatch(exact, new JSONObject(), Integer.MAX_VALUE);
        RouteMatch best = null;
        for (RouteEntry entry : routeEntries) {
            if (!entry.method.equalsIgnoreCase(method)) continue;
            RouteMatch candidate = match(entry, path);
            if (candidate != null && (best == null || candidate.score > best.score)) best = candidate;
        }
        return best;
    }

    private RouteMatch match(RouteEntry entry, String path) {
        String[] expected = entry.path.split("/", -1);
        String[] actual = path.split("/", -1);
        JSONObject params = new JSONObject();
        int score = 0;
        boolean optionalMissing = false;
        int i = 0;
        try {
            for (; i < expected.length; i++) {
                String segment = expected[i];
                if (segment.isEmpty()) {
                    if (i < actual.length && actual[i].isEmpty()) continue;
                    return null;
                }
                if (segment.startsWith("*")) {
                    StringBuilder rest = new StringBuilder();
                    for (int j = i; j < actual.length; j++) {
                        if (rest.length() > 0) rest.append('/');
                        rest.append(actual[j]);
                    }
                    params.put(segment.substring(1), java.net.URLDecoder.decode(rest.toString(), "UTF-8"));
                    return new RouteMatch(entry.asset, params, score + 1);
                }
                if (segment.startsWith(":")) {
                    boolean optional = segment.endsWith("?");
                    String name = segment.substring(1, optional ? segment.length() - 1 : segment.length());
                    if (i >= actual.length || actual[i].isEmpty()) {
                        if (optional) { optionalMissing = true; continue; }
                        return null;
                    }
                    params.put(name, java.net.URLDecoder.decode(actual[i], "UTF-8"));
                    score += optional ? 10 : 20;
                    continue;
                }
                if (i >= actual.length || !segment.equals(actual[i])) return null;
                score += 40;
            }
            return (i == actual.length || (optionalMissing && i == expected.length && actual.length == expected.length - 1))
                    ? new RouteMatch(entry.asset, params, score) : null;
        } catch (Exception error) {
            return null;
        }
    }

    private static JSONObject parseQuery(String path) throws Exception {
        JSONObject query = new JSONObject();
        int marker = path.indexOf('?');
        if (marker < 0 || marker + 1 >= path.length()) return query;
        String raw = path.substring(marker + 1).split("#", 2)[0];
        for (String pair : raw.split("&")) {
            if (pair.isEmpty()) continue;
            String[] values = pair.split("=", 2);
            String key = java.net.URLDecoder.decode(values[0], "UTF-8");
            String value = java.net.URLDecoder.decode(values.length > 1 ? values[1] : "", "UTF-8");
            if (!query.has(key)) query.put(key, value);
            else {
                Object previous = query.get(key);
                JSONArray repeated = previous instanceof JSONArray ? (JSONArray) previous : new JSONArray().put(previous);
                repeated.put(value);
                query.put(key, repeated);
            }
        }
        return query;
    }

    private static final class RouteEntry {
        final String method;
        final String path;
        final String asset;
        RouteEntry(String method, String path, String asset) { this.method = method; this.path = path; this.asset = asset; }
    }

    private static final class RouteMatch {
        final String asset;
        final JSONObject params;
        final int score;
        RouteMatch(String asset, JSONObject params, int score) { this.asset = asset; this.params = params; this.score = score; }
    }

    private static String quote(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r") + "\"";
    }

    @Override
    public void close() {
        executor.shutdownNow();
    }

    private void initializeServerPlugins(QuickJs runtime) throws Exception {
        if (serverPluginAssets.isEmpty()) return;
        boolean createdApp = false;
        for (String asset : serverPluginAssets) {
            runtime.evaluate(assets.read(asset), asset);
            if (!createdApp) {
                runtime.evaluate("var __nuxtNitroApp = __nuxtCreateNitroApp();");
                createdApp = true;
            }
            // Plugins are setup functions, not request handlers. Calling the
            // generic handler bridge here made the plugin lifecycle share the
            // route invocation path and could recurse inside QuickJS when the
            // first request hook was later dispatched.
            runtime.evaluate("(function(){ var plugin = __nuxtServerHandler; if (!plugin) return; if (plugin.hooks) for (var hookName in plugin.hooks) if (Object.prototype.hasOwnProperty.call(plugin.hooks, hookName)) __nuxtRegisterServerHook(hookName, plugin.hooks[hookName]); if (typeof plugin === 'function') plugin(__nuxtNitroApp); else if (typeof plugin.setup === 'function') plugin.setup(__nuxtNitroApp); })();");
        }
    }

    private JSONObject runServerHook(QuickJs runtime, String name, JSONObject event) throws Exception {
        String payload = event.toString();
        runtime.evaluate("__nuxtHookPayload = " + payload + ";");
        runtime.evaluate("__nuxtRunServerHook(" + JSONObject.quote(name) + ", __nuxtHookPayload);");
        Object result = runtime.evaluate("JSON.stringify(__nuxtHookPayload);");
        if (result == null) return event;
        Object parsed = new JSONTokener(String.valueOf(result)).nextValue();
        return parsed instanceof JSONObject ? (JSONObject) parsed : event;
    }
}
