package com.nuxtnative.prototype;

import app.cash.quickjs.QuickJs;
import org.json.JSONArray;
import org.json.JSONObject;
import java.lang.reflect.Method;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Small JavaScript execution boundary for generated page scripts.
 *
 * The renderer remains native; this class only evaluates page logic and
 * exposes a serializable state snapshot back to the Android host.
 */
public final class ScriptRuntime implements AutoCloseable {
    public interface FetchBridge { String fetch(String path, String method, String body, String headers); }
    public interface AsyncFetchBridge { int fetch(String path, String method, String body, String headers); }
    public interface StateBridge { void changed(String name, String value); }
    public interface RouteBridge {
        String current();
        default String names() { return "{}"; }
    }
    public interface RuntimeConfigBridge { String current(); }
    public interface PluginProvideBridge { void provide(String key, String value); }
    public interface PluginSnapshotBridge { String current(); }
    public interface CapabilityBridge { String current(); }
    public interface DeviceBridge { String current(); }
    public interface StorageBridge { String get(String key); void set(String key, String value); void remove(String key); }
    public interface ClipboardBridge { String readText(); boolean writeText(String value); }
    public interface PermissionBridge { boolean has(String permission); int request(String permission); }
    public interface FileSystemBridge { String readText(String path); void writeText(String path, String value); boolean exists(String path); void remove(String path); String list(String path); }
    public interface NotificationsBridge { boolean show(String title, String body, String channelId); }
    public interface MediaBridge { int pick(String mimeType); int capture(); }
    public interface SensorsBridge { int start(String type); void stop(int sensorId); }
    public interface DialogBridge { int show(String title, String message, String positive, String negative); }
    public interface RouteGuardBridge { void complete(String result); }
    public interface HistoryBridge { void call(int delta); }
    public interface PathBridge { void call(String path); }
    public interface VoidBridge { void call(); }
    public interface InvocationCallback { void complete(Map<String, Object> state, Throwable error); }
    public interface RouteGuardCallback { void complete(String result, Throwable error); }
    public interface MiddlewareCallback { void complete(String result, Throwable error); }
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final QuickJs quickJs;
    private final Method nativePendingJobExecutor;
    private Set<String> actions = new HashSet<>();
    private volatile RouteGuardCallback routeGuardCallback;
    private volatile MiddlewareCallback middlewareCallback;
    private static volatile ClipboardBridge defaultClipboard = new ClipboardBridge() {
        @Override public String readText() { return null; }
        @Override public boolean writeText(String value) { return false; }
    };

    public static void setDefaultClipboardBridge(ClipboardBridge bridge) {
        defaultClipboard = bridge == null ? new ClipboardBridge() {
            @Override public String readText() { return null; }
            @Override public boolean writeText(String value) { return false; }
        } : bridge;
    }

    public ScriptRuntime(FetchBridge fetchBridge, AsyncFetchBridge asyncFetchBridge, StateBridge stateBridge, RouteBridge routeBridge, RuntimeConfigBridge runtimeConfigBridge, PathBridge navigateBridge, PathBridge replaceBridge, VoidBridge backBridge, VoidBridge forwardBridge, PluginProvideBridge pluginProvideBridge, PluginSnapshotBridge pluginSnapshotBridge, CapabilityBridge capabilityBridge) {
        this(fetchBridge, asyncFetchBridge, stateBridge, routeBridge, runtimeConfigBridge, navigateBridge, replaceBridge, backBridge, forwardBridge, pluginProvideBridge, pluginSnapshotBridge, capabilityBridge, () -> "{}", new StorageBridge() {
            @Override public String get(String key) { return null; }
            @Override public void set(String key, String value) { }
            @Override public void remove(String key) { }
        }, new PermissionBridge() {
            @Override public boolean has(String permission) { return false; }
            @Override public int request(String permission) { return -1; }
        }, new FileSystemBridge() {
            @Override public String readText(String path) { return null; }
            @Override public void writeText(String path, String value) { }
            @Override public boolean exists(String path) { return false; }
            @Override public void remove(String path) { }
            @Override public String list(String path) { return "[]"; }
        });
    }

    public ScriptRuntime(FetchBridge fetchBridge, AsyncFetchBridge asyncFetchBridge, StateBridge stateBridge, RouteBridge routeBridge, RuntimeConfigBridge runtimeConfigBridge, PathBridge navigateBridge, PathBridge replaceBridge, VoidBridge backBridge, VoidBridge forwardBridge, PluginProvideBridge pluginProvideBridge, PluginSnapshotBridge pluginSnapshotBridge, CapabilityBridge capabilityBridge, DeviceBridge deviceBridge, StorageBridge storageBridge) {
        this(fetchBridge, asyncFetchBridge, stateBridge, routeBridge, runtimeConfigBridge, navigateBridge, replaceBridge, backBridge, forwardBridge, pluginProvideBridge, pluginSnapshotBridge, capabilityBridge, deviceBridge, storageBridge, new PermissionBridge() {
            @Override public boolean has(String permission) { return false; }
            @Override public int request(String permission) { return -1; }
        }, new FileSystemBridge() {
            @Override public String readText(String path) { return null; }
            @Override public void writeText(String path, String value) { }
            @Override public boolean exists(String path) { return false; }
            @Override public void remove(String path) { }
            @Override public String list(String path) { return "[]"; }
        });
    }

    public ScriptRuntime(FetchBridge fetchBridge, AsyncFetchBridge asyncFetchBridge, StateBridge stateBridge, RouteBridge routeBridge, RuntimeConfigBridge runtimeConfigBridge, PathBridge navigateBridge, PathBridge replaceBridge, VoidBridge backBridge, VoidBridge forwardBridge, PluginProvideBridge pluginProvideBridge, PluginSnapshotBridge pluginSnapshotBridge, CapabilityBridge capabilityBridge, DeviceBridge deviceBridge, StorageBridge storageBridge, PermissionBridge permissionBridge) {
        this(fetchBridge, asyncFetchBridge, stateBridge, routeBridge, runtimeConfigBridge, navigateBridge, replaceBridge, backBridge, forwardBridge, pluginProvideBridge, pluginSnapshotBridge, capabilityBridge, deviceBridge, storageBridge, permissionBridge, new FileSystemBridge() {
            @Override public String readText(String path) { return null; }
            @Override public void writeText(String path, String value) { }
            @Override public boolean exists(String path) { return false; }
            @Override public void remove(String path) { }
            @Override public String list(String path) { return "[]"; }
        });
    }

    public ScriptRuntime(FetchBridge fetchBridge, AsyncFetchBridge asyncFetchBridge, StateBridge stateBridge, RouteBridge routeBridge, RuntimeConfigBridge runtimeConfigBridge, PathBridge navigateBridge, PathBridge replaceBridge, VoidBridge backBridge, VoidBridge forwardBridge, PluginProvideBridge pluginProvideBridge, PluginSnapshotBridge pluginSnapshotBridge, CapabilityBridge capabilityBridge, DeviceBridge deviceBridge, StorageBridge storageBridge, PermissionBridge permissionBridge, FileSystemBridge fileSystemBridge) {
        this(fetchBridge, asyncFetchBridge, stateBridge, routeBridge, runtimeConfigBridge, navigateBridge, replaceBridge, backBridge, forwardBridge, pluginProvideBridge, pluginSnapshotBridge, capabilityBridge, deviceBridge, storageBridge, permissionBridge, fileSystemBridge, new NotificationsBridge() {
            @Override public boolean show(String title, String body, String channelId) { return false; }
        });
    }

    public ScriptRuntime(FetchBridge fetchBridge, AsyncFetchBridge asyncFetchBridge, StateBridge stateBridge, RouteBridge routeBridge, RuntimeConfigBridge runtimeConfigBridge, PathBridge navigateBridge, PathBridge replaceBridge, VoidBridge backBridge, VoidBridge forwardBridge, PluginProvideBridge pluginProvideBridge, PluginSnapshotBridge pluginSnapshotBridge, CapabilityBridge capabilityBridge, DeviceBridge deviceBridge, StorageBridge storageBridge, PermissionBridge permissionBridge, FileSystemBridge fileSystemBridge, NotificationsBridge notificationsBridge) {
        this(fetchBridge, asyncFetchBridge, stateBridge, routeBridge, runtimeConfigBridge, navigateBridge, replaceBridge, backBridge, forwardBridge, pluginProvideBridge, pluginSnapshotBridge, capabilityBridge, deviceBridge, storageBridge, permissionBridge, fileSystemBridge, notificationsBridge, new MediaBridge() {
            @Override public int pick(String mimeType) { return -1; }
            @Override public int capture() { return -1; }
        });
    }

    public ScriptRuntime(FetchBridge fetchBridge, AsyncFetchBridge asyncFetchBridge, StateBridge stateBridge, RouteBridge routeBridge, RuntimeConfigBridge runtimeConfigBridge, PathBridge navigateBridge, PathBridge replaceBridge, VoidBridge backBridge, VoidBridge forwardBridge, PluginProvideBridge pluginProvideBridge, PluginSnapshotBridge pluginSnapshotBridge, CapabilityBridge capabilityBridge, DeviceBridge deviceBridge, StorageBridge storageBridge, PermissionBridge permissionBridge, FileSystemBridge fileSystemBridge, NotificationsBridge notificationsBridge, MediaBridge mediaBridge) {
        this(fetchBridge, asyncFetchBridge, stateBridge, routeBridge, runtimeConfigBridge, navigateBridge, replaceBridge, backBridge, forwardBridge, pluginProvideBridge, pluginSnapshotBridge, capabilityBridge, deviceBridge, storageBridge, permissionBridge, fileSystemBridge, notificationsBridge, mediaBridge, new SensorsBridge() {
            @Override public int start(String type) { return -1; }
            @Override public void stop(int sensorId) { }
        });
    }

    public ScriptRuntime(FetchBridge fetchBridge, AsyncFetchBridge asyncFetchBridge, StateBridge stateBridge, RouteBridge routeBridge, RuntimeConfigBridge runtimeConfigBridge, PathBridge navigateBridge, PathBridge replaceBridge, VoidBridge backBridge, VoidBridge forwardBridge, PluginProvideBridge pluginProvideBridge, PluginSnapshotBridge pluginSnapshotBridge, CapabilityBridge capabilityBridge, DeviceBridge deviceBridge, StorageBridge storageBridge, PermissionBridge permissionBridge, FileSystemBridge fileSystemBridge, NotificationsBridge notificationsBridge, MediaBridge mediaBridge, SensorsBridge sensorsBridge) {
        this(fetchBridge, asyncFetchBridge, stateBridge, routeBridge, runtimeConfigBridge, navigateBridge, replaceBridge, backBridge, forwardBridge, pluginProvideBridge, pluginSnapshotBridge, capabilityBridge, deviceBridge, storageBridge, permissionBridge, fileSystemBridge, notificationsBridge, mediaBridge, sensorsBridge, null, null);
    }

    public ScriptRuntime(FetchBridge fetchBridge, AsyncFetchBridge asyncFetchBridge, StateBridge stateBridge, RouteBridge routeBridge, RuntimeConfigBridge runtimeConfigBridge, PathBridge navigateBridge, PathBridge replaceBridge, VoidBridge backBridge, VoidBridge forwardBridge, PluginProvideBridge pluginProvideBridge, PluginSnapshotBridge pluginSnapshotBridge, CapabilityBridge capabilityBridge, DeviceBridge deviceBridge, StorageBridge storageBridge, PermissionBridge permissionBridge, FileSystemBridge fileSystemBridge, NotificationsBridge notificationsBridge, MediaBridge mediaBridge, SensorsBridge sensorsBridge, RouteGuardBridge routeGuardBridge) {
        this(fetchBridge, asyncFetchBridge, stateBridge, routeBridge, runtimeConfigBridge, navigateBridge, replaceBridge, backBridge, forwardBridge, pluginProvideBridge, pluginSnapshotBridge, capabilityBridge, deviceBridge, storageBridge, permissionBridge, fileSystemBridge, notificationsBridge, mediaBridge, sensorsBridge, routeGuardBridge, null);
    }

    public ScriptRuntime(FetchBridge fetchBridge, AsyncFetchBridge asyncFetchBridge, StateBridge stateBridge, RouteBridge routeBridge, RuntimeConfigBridge runtimeConfigBridge, PathBridge navigateBridge, PathBridge replaceBridge, VoidBridge backBridge, VoidBridge forwardBridge, PluginProvideBridge pluginProvideBridge, PluginSnapshotBridge pluginSnapshotBridge, CapabilityBridge capabilityBridge, DeviceBridge deviceBridge, StorageBridge storageBridge, PermissionBridge permissionBridge, FileSystemBridge fileSystemBridge, NotificationsBridge notificationsBridge, MediaBridge mediaBridge, SensorsBridge sensorsBridge, RouteGuardBridge routeGuardBridge, HistoryBridge historyBridge) {
        this(fetchBridge, asyncFetchBridge, stateBridge, routeBridge, runtimeConfigBridge, navigateBridge, replaceBridge, backBridge, forwardBridge, pluginProvideBridge, pluginSnapshotBridge, capabilityBridge, deviceBridge, storageBridge, permissionBridge, fileSystemBridge, notificationsBridge, mediaBridge, sensorsBridge, routeGuardBridge, historyBridge, null);
    }

    public ScriptRuntime(FetchBridge fetchBridge, AsyncFetchBridge asyncFetchBridge, StateBridge stateBridge, RouteBridge routeBridge, RuntimeConfigBridge runtimeConfigBridge, PathBridge navigateBridge, PathBridge replaceBridge, VoidBridge backBridge, VoidBridge forwardBridge, PluginProvideBridge pluginProvideBridge, PluginSnapshotBridge pluginSnapshotBridge, CapabilityBridge capabilityBridge, DeviceBridge deviceBridge, StorageBridge storageBridge, PermissionBridge permissionBridge, FileSystemBridge fileSystemBridge, NotificationsBridge notificationsBridge, MediaBridge mediaBridge, SensorsBridge sensorsBridge, RouteGuardBridge routeGuardBridge, HistoryBridge historyBridge, DialogBridge dialogBridge) {
        quickJs = call(() -> {
            QuickJs runtime = QuickJs.create();
            runtime.set("__nuxtFetch", FetchBridge.class, fetchBridge);
            runtime.set("__nuxtFetchAsync", AsyncFetchBridge.class, asyncFetchBridge);
            runtime.set("__nuxtStateChanged", StateBridge.class, stateBridge);
            runtime.set("__nuxtRoute", RouteBridge.class, routeBridge);
            runtime.set("__nuxtRouteNames", RouteBridge.class, routeBridge);
            runtime.set("__nuxtRuntimeConfig", RuntimeConfigBridge.class, runtimeConfigBridge);
            runtime.set("__nuxtPluginProvide", PluginProvideBridge.class, pluginProvideBridge);
            runtime.set("__nuxtPlugins", PluginSnapshotBridge.class, pluginSnapshotBridge);
            runtime.set("__nuxtCapabilities", CapabilityBridge.class, capabilityBridge);
            runtime.set("__nuxtNativeDevice", DeviceBridge.class, deviceBridge);
            runtime.set("__nuxtNativeStorage", StorageBridge.class, storageBridge);
            runtime.set("__nuxtNativeClipboard", ClipboardBridge.class, defaultClipboard);
            runtime.set("__nuxtNativePermissions", PermissionBridge.class, permissionBridge);
            runtime.set("__nuxtNativeFileSystem", FileSystemBridge.class, fileSystemBridge);
            runtime.set("__nuxtNativeNotifications", NotificationsBridge.class, notificationsBridge);
            runtime.set("__nuxtNativeMedia", MediaBridge.class, mediaBridge);
            runtime.set("__nuxtNativeSensors", SensorsBridge.class, sensorsBridge);
            runtime.set("__nuxtNativeDialog", DialogBridge.class, dialogBridge == null ? (title, message, positive, negative) -> -1 : dialogBridge);
            RouteGuardBridge guardBridge = routeGuardBridge == null ? result -> {
                RouteGuardCallback callback = routeGuardCallback;
                routeGuardCallback = null;
                if (callback != null) callback.complete(result, null);
            } : routeGuardBridge;
            runtime.set("__nuxtRouteGuardComplete", RouteGuardBridge.class, guardBridge);
            runtime.set("__nuxtMiddlewareComplete", RouteGuardBridge.class, result -> {
                MiddlewareCallback callback = middlewareCallback;
                middlewareCallback = null;
                if (callback != null) callback.complete(result, null);
            });
            runtime.set("__nuxtNavigate", PathBridge.class, navigateBridge);
            runtime.set("__nuxtReplace", PathBridge.class, replaceBridge);
            runtime.set("__nuxtBack", VoidBridge.class, backBridge);
            runtime.set("__nuxtForward", VoidBridge.class, forwardBridge);
            runtime.set("__nuxtGo", HistoryBridge.class, historyBridge == null ? delta -> { } : historyBridge);
            return runtime;
        });
        nativePendingJobExecutor = findNativePendingJobExecutor();
    }

    public void load(String source, String filename) {
        load(source, filename, new HashSet<>());
    }

    public void load(String source, String filename, Set<String> actions) {
        call(() -> {
            this.actions = new HashSet<>(actions);
            quickJs.evaluate(source, filename);
            drainJobs();
            return null;
        });
    }

    public void runPlugin(String source) {
        call(() -> {
            quickJs.evaluate(source, "plugin.js");
            quickJs.evaluate("if (typeof __nuxtRunPlugin === 'function') __nuxtRunPlugin();");
            drainJobs();
            return null;
        });
    }

    public void runPluginHook(String name, String payload) {
        call(() -> {
            quickJs.evaluate("if (typeof __nuxtRunPluginHook === 'function') __nuxtRunPluginHook(" + quote(name == null ? "" : name) + "," + (payload == null ? "null" : quote(payload)) + ");");
            drainJobs();
            return null;
        });
    }

    public void disposePlugin() {
        call(() -> {
            quickJs.evaluate("if (typeof __nuxtDisposePlugin === 'function') __nuxtDisposePlugin();");
            drainJobs();
            return null;
        });
    }

    public void mounted() {
        call(() -> {
            quickJs.evaluate("if (typeof __nuxtRunMounted === 'function') __nuxtRunMounted();");
            drainJobs();
            return null;
        });
    }

    public String stateSnapshot() {
        return call(() -> {
            drainJobs();
            Object state = quickJs.evaluate("typeof __nuxtSnapshot === 'function' ? __nuxtSnapshot() : '{}';");
            return state == null ? "{}" : String.valueOf(state);
        });
    }

    public void seedState(String name, String serializedValue) {
        if (name == null || !name.matches("[A-Za-z_$][A-Za-z0-9_$]*")) throw new IllegalArgumentException("Invalid seeded state name: " + name);
        call(() -> {
            String payload = serializedValue == null || serializedValue.isEmpty() ? "null" : serializedValue;
            quickJs.evaluate("if (typeof __nuxtSetState === 'function') __nuxtSetState(" + quote(name) + "," + payload + ");");
            drainJobs();
            return null;
        });
    }

    public void restoreState(String snapshot, java.util.Set<String> stateRefs) {
        if (snapshot == null || snapshot.isEmpty() || stateRefs == null || stateRefs.isEmpty()) return;
        call(() -> {
            JSONObject state = new JSONObject(snapshot);
            for (String name : stateRefs) {
                if (!state.has(name)) continue;
                Object value = state.opt(name);
                String serialized = jsonLiteral(value);
                quickJs.evaluate("if (typeof __nuxtSetState === 'function') __nuxtSetState(" + quote(name) + "," + serialized + ");");
            }
            drainJobs();
            return null;
        });
    }

    public void unmounted() {
        call(() -> {
            quickJs.evaluate("if (typeof __nuxtRunUnmounted === 'function') __nuxtRunUnmounted();");
            drainJobs();
            return null;
        });
    }

    public String runMiddleware(String source, String to, String from) {
        return call(() -> {
            quickJs.evaluate(source, "middleware.js");
            Object result = quickJs.evaluate("__nuxtRunMiddleware(" + quote(to) + "," + quote(from) + ");");
            drainJobs();
            return result == null ? "" : String.valueOf(result);
        });
    }

    public void runMiddlewareAsync(String source, String to, String from, MiddlewareCallback callback) {
        middlewareCallback = callback;
        executor.execute(() -> {
            try {
                quickJs.evaluate(source, "middleware.js");
                quickJs.evaluate("__nuxtRunMiddlewareAsync(" + quote(to) + "," + quote(from) + ");");
                drainJobs();
            } catch (Throwable error) {
                middlewareCallback = null;
                callback.complete("__nuxt_abort__", error);
            }
        });
    }

    public String runRouteGuards(String kind, String to, String from) {
        return call(() -> {
            Object result = quickJs.evaluate("typeof __nuxtRunRouteGuards === 'function' ? __nuxtRunRouteGuards(" + quote(kind) + "," + quote(to) + "," + quote(from) + ") : '';" );
            drainJobs();
            return result == null ? "" : String.valueOf(result);
        });
    }

    public void runRouteGuardsAsync(String kind, String to, String from, RouteGuardCallback callback) {
        routeGuardCallback = callback;
        executor.execute(() -> {
            try {
                quickJs.evaluate("if (typeof __nuxtRunRouteGuardsAsync === 'function') __nuxtRunRouteGuardsAsync(" + quote(kind) + "," + quote(to) + "," + quote(from) + "); else __nuxtRouteGuardComplete.complete('');");
                drainJobs();
            } catch (Throwable error) {
                routeGuardCallback = null;
                callback.complete("__nuxt_abort__", error);
            }
        });
    }

    public void resolveAsync(int requestId, String body, String failure) {
        call(() -> {
            quickJs.evaluate("if (typeof __nuxtResolveAsync === 'function') __nuxtResolveAsync(" + requestId + "," + quote(body == null ? "null" : body) + "," + quote(failure == null ? "" : failure) + ");");
            return null;
        });
    }

    public void resolvePermission(int requestId, boolean granted) {
        call(() -> {
            quickJs.evaluate("if (typeof __nuxtResolvePermission === 'function') __nuxtResolvePermission(" + requestId + "," + granted + ");");
            return null;
        });
    }

    public void resolveMedia(int requestId, String uri) {
        call(() -> {
            quickJs.evaluate("if (typeof __nuxtResolveMedia === 'function') __nuxtResolveMedia(" + requestId + "," + quote(uri == null ? "" : uri) + ");");
            return null;
        });
    }

    public void resolveDialog(int requestId, boolean result) {
        call(() -> {
            quickJs.evaluate("if (typeof __nuxtResolveDialog === 'function') __nuxtResolveDialog(" + requestId + "," + result + ");");
            drainJobs();
            return null;
        });
    }

    public void appState(String state) {
        call(() -> {
            quickJs.evaluate("if (typeof __nuxtRunAppState === 'function') __nuxtRunAppState(" + quote(state == null ? "active" : state) + ");");
            drainJobs();
            return null;
        });
    }

    public void resolveSensor(int sensorId, String sample) {
        call(() -> {
            quickJs.evaluate("if (typeof __nuxtResolveSensor === 'function') __nuxtResolveSensor(" + sensorId + "," + quote(sample == null ? "{}" : sample) + ");");
            drainJobs();
            return null;
        });
    }

    public Map<String, Object> invoke(String action) {
        return call(() -> invokeInternal(action, null));
    }

    public void invokeAsync(String action, InvocationCallback callback) {
        executor.execute(() -> {
            try {
                callback.complete(invokeInternal(action, null), null);
            } catch (Throwable error) {
                callback.complete(null, error);
            }
        });
    }

    public void invokeAsync(String action, String argumentJson, InvocationCallback callback) {
        executor.execute(() -> {
            try {
                callback.complete(invokeInternal(action, argumentJson), null);
            } catch (Throwable error) {
                callback.complete(null, error);
            }
        });
    }

    private Map<String, Object> invokeInternal(String action, String argumentJson) {
        if (!action.matches("[A-Za-z_$][A-Za-z0-9_$]*")) throw new IllegalArgumentException("Invalid script action: " + action);
        if (!actions.isEmpty() && !actions.contains(action)) throw new IllegalArgumentException("Action is not declared by the page script: " + action);
        Object result = quickJs.evaluate(action + "(" + (argumentJson == null ? "" : argumentJson) + ");");
        drainJobs();
        Object state = quickJs.evaluate("typeof __nuxtSnapshot === 'function' ? __nuxtSnapshot() : '{}';");
        Map<String, Object> snapshot = new HashMap<>();
        if (state instanceof String) {
            String json = (String) state;
            if (json.contains("\"saving\":true")) snapshot.put("saving", true);
            if (json.contains("\"saving\":false")) snapshot.put("saving", false);
        }
        if (result instanceof String) snapshot.put("result", result);
        return snapshot;
    }

    public void updateState(String name, String value) {
        if (!name.matches("[A-Za-z_$][A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*|\\[[0-9]+\\])*") ) throw new IllegalArgumentException("Invalid state binding: " + name);
        call(() -> {
            boolean numeric = value != null && value.startsWith("__nuxt_native_number__:");
            String payload = numeric ? value.substring("__nuxt_native_number__:".length()) : quote(value);
            quickJs.evaluate("if (typeof __nuxtSetModel === 'function') __nuxtSetModel(" + quote(name) + "," + payload + "); else if (typeof __nuxtSetState === 'function') __nuxtSetState(" + quote(name) + "," + payload + "); else " + name + ".value = " + payload + ";");
            drainJobs();
            return null;
        });
    }

    public boolean handleError(Throwable error) {
        return call(() -> {
            String message = error == null || error.getMessage() == null ? "Native runtime error" : error.getMessage();
            Object result = quickJs.evaluate("typeof __nuxtCaptureError === 'function' ? __nuxtCaptureError(" + quote(message) + ") : false;");
            drainJobs();
            return Boolean.TRUE.equals(result) || "true".equals(String.valueOf(result));
        });
    }

    private void drainJobs() {
        if (nativePendingJobExecutor != null) {
            try {
                if (nativePendingJobExecutor.getParameterCount() == 0) nativePendingJobExecutor.invoke(quickJs);
                else nativePendingJobExecutor.invoke(quickJs, 1000);
            } catch (Exception ignored) {
                // The compatibility queue below remains authoritative when a
                // future binding exposes an incompatible or failing probe.
            }
        }
        quickJs.evaluate("if (typeof __nuxtFlushJobs === 'function') __nuxtFlushJobs();");
    }

    private static Method findNativePendingJobExecutor() {
        for (Method method : QuickJs.class.getMethods()) {
            if (!method.getName().equals("executePendingJobs")) continue;
            if (method.getParameterCount() == 0 || method.getParameterCount() == 1) {
                method.setAccessible(true);
                return method;
            }
        }
        return null;
    }

    private <T> T call(Callable<T> task) {
        try {
            return executor.submit(task).get();
        } catch (Exception error) {
            Throwable cause = error.getCause();
            if (cause instanceof RuntimeException) throw (RuntimeException) cause;
            throw new RuntimeException("JavaScript runtime task failed", cause == null ? error : cause);
        }
    }

    private static String quote(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    private static String jsonLiteral(Object value) {
        if (value == null || value == JSONObject.NULL) return "null";
        String wrapped = new JSONArray().put(value).toString();
        return wrapped.substring(1, wrapped.length() - 1);
    }

    @Override
    public void close() {
        try {
            call(() -> {
                quickJs.close();
                return null;
            });
        } finally {
            executor.shutdownNow();
        }
    }
}
