package com.nuxtnative.prototype;

import android.app.Activity;
import android.content.Intent;
import android.content.ContentValues;
import android.net.Uri;
import android.provider.MediaStore;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.content.pm.PackageManager;
import android.content.SharedPreferences;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.os.Build;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** Native screen host for the generated route manifest. */
public final class NativeRouter {
    public interface AssetReader { String read(String name) throws Exception; }
    public interface ActionDispatcher { void dispatch(String action, View source); }
    public interface InvocationCallback { void complete(Throwable error); }

    private final FrameLayout host;
    private final NativeRenderer.ActionDispatcher actions;
    private final AssetReader assets;
    private final ScriptRuntime.FetchBridge fetch;
    private final NativeServer.AsyncRequester asyncFetch;
    private final NativeRemoteFetch remoteFetch;
    private final ScriptRuntime.DeviceBridge device;
    private final ScriptRuntime.StorageBridge storage;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Deque<NavigationOperation> pendingNavigations = new ArrayDeque<>();
    private final Map<String, String> routeAssets = new HashMap<>();
    private final Map<String, String> routeNames = new HashMap<>();
    private final Map<String, ArrayList<String>> routeMiddleware = new HashMap<>();
    private final Map<String, String> middlewareAssets = new HashMap<>();
    private final Map<String, String> pluginAssets = new HashMap<>();
    private final Map<String, String> pluginValues = new HashMap<>();
    private volatile String runtimeConfig = "{\"public\":{}}";
    private final NativeCapabilityBroker capabilityBroker;
    private final ScriptRuntime.PermissionBridge permissions;
    private final ScriptRuntime.FileSystemBridge fileSystem;
    private final ScriptRuntime.NotificationsBridge notifications;
    private final ScriptRuntime.MediaBridge media;
    private final ScriptRuntime.SensorsBridge sensors;
    private final ScriptRuntime.DialogBridge dialog;
    private final ArrayList<String> history = new ArrayList<>();
    private final Set<String> activeStateRefs = new HashSet<>();
    private final SharedPreferences navigationState;
    private ScriptRuntime scripts;
    private ScriptRuntime middlewareScripts;
    private ScriptRuntime pluginScripts;
    private boolean pluginMounted;
    private NativeRenderer renderer;
    private volatile String currentPath = "/";
    private volatile String lastRequestedPath = "/";
    /** Monotonically increasing token for the currently requested navigation. */
    private long navigationToken;
    private int index = -1;
    private int nextAsyncRequest = 1;
    private final Map<Integer, ScriptRuntime> asyncRuntimes = new HashMap<>();
    private int nextPermissionRequest = 10000;
    private final Map<Integer, ScriptRuntime> permissionRuntimes = new HashMap<>();
    private final Map<Integer, ScriptRuntime> dialogRuntimes = new ConcurrentHashMap<>();
    private int nextMediaRequest = 20000;
    private final Map<Integer, ScriptRuntime> mediaRuntimes = new HashMap<>();
    private final Map<Integer, Uri> captureUris = new HashMap<>();
    private int nextSensorId = 30000;
    private final Map<Integer, SensorSubscription> sensorSubscriptions = new HashMap<>();

    public NativeRouter(FrameLayout host, NativeRenderer.ActionDispatcher actions, AssetReader assets, ScriptRuntime.FetchBridge fetch, NativeServer.AsyncRequester asyncFetch) {
        this(host, actions, assets, fetch, asyncFetch, () -> "{}", new ScriptRuntime.StorageBridge() {
            @Override public String get(String key) { return null; }
            @Override public void set(String key, String value) { }
            @Override public void remove(String key) { }
        }, new NativeCapabilityBroker("core", "network"), null, null);
    }

    public NativeRouter(FrameLayout host, NativeRenderer.ActionDispatcher actions, AssetReader assets, ScriptRuntime.FetchBridge fetch, NativeServer.AsyncRequester asyncFetch, ScriptRuntime.DeviceBridge device, ScriptRuntime.StorageBridge storage) {
        this(host, actions, assets, fetch, asyncFetch, device, storage, new NativeCapabilityBroker("core", "network", "device", "storage"), null, null);
    }

    public NativeRouter(FrameLayout host, NativeRenderer.ActionDispatcher actions, AssetReader assets, ScriptRuntime.FetchBridge fetch, NativeServer.AsyncRequester asyncFetch, ScriptRuntime.DeviceBridge device, ScriptRuntime.StorageBridge storage, NativeCapabilityBroker capabilityBroker) {
        this(host, actions, assets, fetch, asyncFetch, device, storage, capabilityBroker, null, null);
    }

    public NativeRouter(FrameLayout host, NativeRenderer.ActionDispatcher actions, AssetReader assets, ScriptRuntime.FetchBridge fetch, NativeServer.AsyncRequester asyncFetch, ScriptRuntime.DeviceBridge device, ScriptRuntime.StorageBridge storage, NativeCapabilityBroker capabilityBroker, ScriptRuntime.PermissionBridge permissions) {
        this(host, actions, assets, fetch, asyncFetch, device, storage, capabilityBroker, permissions, null);
    }

    public NativeRouter(FrameLayout host, NativeRenderer.ActionDispatcher actions, AssetReader assets, ScriptRuntime.FetchBridge fetch, NativeServer.AsyncRequester asyncFetch, ScriptRuntime.DeviceBridge device, ScriptRuntime.StorageBridge storage, NativeCapabilityBroker capabilityBroker, ScriptRuntime.PermissionBridge permissions, ScriptRuntime.FileSystemBridge fileSystem) {
        this(host, actions, assets, fetch, asyncFetch, device, storage, capabilityBroker, permissions, fileSystem, new ScriptRuntime.NotificationsBridge() {
            @Override public boolean show(String title, String body, String channelId) { return false; }
        });
    }

    public NativeRouter(FrameLayout host, NativeRenderer.ActionDispatcher actions, AssetReader assets, ScriptRuntime.FetchBridge fetch, NativeServer.AsyncRequester asyncFetch, ScriptRuntime.DeviceBridge device, ScriptRuntime.StorageBridge storage, NativeCapabilityBroker capabilityBroker, ScriptRuntime.PermissionBridge permissions, ScriptRuntime.FileSystemBridge fileSystem, ScriptRuntime.NotificationsBridge notifications) {
        this(host, actions, assets, fetch, asyncFetch, device, storage, capabilityBroker, permissions, fileSystem, notifications, null);
    }

    public NativeRouter(FrameLayout host, NativeRenderer.ActionDispatcher actions, AssetReader assets, ScriptRuntime.FetchBridge fetch, NativeServer.AsyncRequester asyncFetch, ScriptRuntime.DeviceBridge device, ScriptRuntime.StorageBridge storage, NativeCapabilityBroker capabilityBroker, ScriptRuntime.PermissionBridge permissions, ScriptRuntime.FileSystemBridge fileSystem, ScriptRuntime.NotificationsBridge notifications, ScriptRuntime.MediaBridge media) {
        this(host, actions, assets, fetch, asyncFetch, device, storage, capabilityBroker, permissions, fileSystem, notifications, media, null);
    }

    public NativeRouter(FrameLayout host, NativeRenderer.ActionDispatcher actions, AssetReader assets, ScriptRuntime.FetchBridge fetch, NativeServer.AsyncRequester asyncFetch, ScriptRuntime.DeviceBridge device, ScriptRuntime.StorageBridge storage, NativeCapabilityBroker capabilityBroker, ScriptRuntime.PermissionBridge permissions, ScriptRuntime.FileSystemBridge fileSystem, ScriptRuntime.NotificationsBridge notifications, ScriptRuntime.MediaBridge media, ScriptRuntime.SensorsBridge sensors) {
        this(host, actions, assets, fetch, asyncFetch, device, storage, capabilityBroker, permissions, fileSystem, notifications, media, sensors, null);
    }

    public NativeRouter(FrameLayout host, NativeRenderer.ActionDispatcher actions, AssetReader assets, ScriptRuntime.FetchBridge fetch, NativeServer.AsyncRequester asyncFetch, ScriptRuntime.DeviceBridge device, ScriptRuntime.StorageBridge storage, NativeCapabilityBroker capabilityBroker, ScriptRuntime.PermissionBridge permissions, ScriptRuntime.FileSystemBridge fileSystem, ScriptRuntime.NotificationsBridge notifications, ScriptRuntime.MediaBridge media, ScriptRuntime.SensorsBridge sensors, ScriptRuntime.DialogBridge dialog) {
        this.host = host;
        this.navigationState = host.getContext().getSharedPreferences("nuxt_native_navigation", android.content.Context.MODE_PRIVATE);
        ScriptRuntime.setDefaultClipboardBridge(new ScriptRuntime.ClipboardBridge() {
            private ClipboardManager manager() { return (ClipboardManager) host.getContext().getSystemService(android.content.Context.CLIPBOARD_SERVICE); }
            @Override public String readText() {
                try {
                    ClipboardManager clipboard = manager();
                    if (clipboard == null || !clipboard.hasPrimaryClip()) return null;
                    ClipData data = clipboard.getPrimaryClip();
                    if (data == null || data.getItemCount() == 0) return null;
                    CharSequence value = data.getItemAt(0).coerceToText(host.getContext());
                    return value == null ? null : value.toString();
                } catch (Exception ignored) { return null; }
            }
            @Override public boolean writeText(String value) {
                try {
                    ClipboardManager clipboard = manager();
                    if (clipboard == null) return false;
                    clipboard.setPrimaryClip(ClipData.newPlainText("Nuxt Native", value == null ? "" : value));
                    return true;
                } catch (Exception ignored) { return false; }
            }
        });
        this.actions = actions;
        this.assets = assets;
        this.fetch = fetch;
        this.asyncFetch = asyncFetch;
        this.remoteFetch = new NativeRemoteFetch(host.getContext());
        this.device = device;
        this.storage = storage;
        this.capabilityBroker = capabilityBroker;
        this.permissions = permissions == null ? new ScriptRuntime.PermissionBridge() {
            @Override public boolean has(String permission) { return hasNativePermission(permission); }
            @Override public int request(String permission) { return requestNativePermission(permission); }
        } : permissions;
        this.fileSystem = fileSystem == null ? new ScriptRuntime.FileSystemBridge() {
            @Override public String readText(String path) { return null; }
            @Override public void writeText(String path, String value) { }
            @Override public boolean exists(String path) { return false; }
            @Override public void remove(String path) { }
            @Override public String list(String path) { return "[]"; }
        } : fileSystem;
        this.notifications = notifications == null ? new ScriptRuntime.NotificationsBridge() {
            @Override public boolean show(String title, String body, String channelId) { return false; }
        } : notifications;
        this.media = media == null ? new ScriptRuntime.MediaBridge() {
            @Override public int pick(String mimeType) { return pickNativeMedia(mimeType); }
            @Override public int capture() { return captureNativePhoto(); }
        } : media;
        this.sensors = sensors == null ? new ScriptRuntime.SensorsBridge() {
            @Override public int start(String type) { return startNativeSensor(type); }
            @Override public void stop(int sensorId) { stopNativeSensor(sensorId); }
        } : sensors;
        this.dialog = dialog == null ? (title, message, positive, negative) -> -1 : dialog;
    }

    public void loadManifest() throws Exception {
        try {
            JSONObject nativeConfig = new JSONObject(assets.read("native-config.json"));
            JSONArray configuredCapabilities = nativeConfig.optJSONArray("capabilities");
            if (configuredCapabilities != null) capabilityBroker.configure(configuredCapabilities);
            JSONObject configuredRuntime = nativeConfig.optJSONObject("runtimeConfig");
            if (configuredRuntime != null) runtimeConfig = configuredRuntime.toString();
            JSONObject configuredApp = nativeConfig.optJSONObject("appConfig");
            if (configuredApp != null) {
                JSONObject runtime = new JSONObject(runtimeConfig);
                runtime.put("appConfig", configuredApp);
                runtimeConfig = runtime.toString();
            }
        } catch (java.io.FileNotFoundException ignored) {
            // Older/generated projects without native-config.json retain host defaults.
        }
        JSONArray routes = new JSONObject(assets.read("routes.json")).getJSONArray("routes");
        for (int i = 0; i < routes.length(); i++) {
            JSONObject route = routes.getJSONObject(i);
            String path = route.getString("path");
            routeAssets.put(path, route.getString("asset"));
            String name = route.optString("name", "");
            if (!name.isEmpty()) routeNames.put(name, path);
            ArrayList<String> guards = new ArrayList<>();
            JSONArray middleware = route.optJSONArray("middleware");
            if (middleware != null) for (int j = 0; j < middleware.length(); j++) guards.add(middleware.getString(j));
            routeMiddleware.put(path, guards);
        }
        JSONArray middleware = new JSONObject(assets.read("middleware.json")).getJSONArray("middleware");
        for (int i = 0; i < middleware.length(); i++) {
            JSONObject entry = middleware.getJSONObject(i);
            middlewareAssets.put(entry.getString("name"), entry.getString("asset"));
        }
        JSONArray plugins = new JSONObject(assets.read("plugins.json")).getJSONArray("plugins");
        for (int i = 0; i < plugins.length(); i++) {
            JSONObject entry = plugins.getJSONObject(i);
            pluginAssets.put(entry.getString("name"), entry.getString("asset"));
        }
        final ScriptRuntime[] middlewareRuntime = new ScriptRuntime[1];
        middlewareScripts = new ScriptRuntime(
                fetch,
                (path, method, body, headers) -> startAsyncFetchFor(middlewareRuntime[0], path, method, body, headers),
                this::onStateChanged,
                routeBridge(),
                this::runtimeConfigSnapshot,
                ignored -> { },
                ignored -> { },
                () -> { },
                () -> { },
                (key, value) -> { },
                this::pluginSnapshot,
                this::capabilitiesSnapshot,
                device,
                storage,
                permissions,
                fileSystem,
                notifications,
                media,
                sensors
        );
        middlewareRuntime[0] = middlewareScripts;
        pluginScripts = new ScriptRuntime(
                fetch,
                (path, method, body, headers) -> 0,
                this::onStateChanged,
                routeBridge(),
                this::runtimeConfigSnapshot,
                ignored -> { },
                ignored -> { },
                () -> { },
                () -> { },
                this::providePlugin,
                this::pluginSnapshot,
                this::capabilitiesSnapshot,
                device,
                storage,
                permissions,
                fileSystem,
                notifications,
                media,
                sensors
        );
    }

    public void start(String path) {
        boolean restored = restoreNavigationState();
        try {
            synchronized (pluginValues) { pluginValues.clear(); }
            pluginMounted = false;
            for (String asset : pluginAssets.values()) pluginScripts.runPlugin(assets.read(asset));
        } catch (Throwable error) {
            showError(error);
            return;
        }
        if (restored && index >= 0 && index < history.size()) {
            String restoredPath = history.get(index);
            lastRequestedPath = restoredPath;
            try {
                render(restoredPath);
                persistNavigationState();
                return;
            } catch (Throwable error) {
                history.clear();
                index = -1;
                showError(error);
                return;
            }
        }
        history.clear();
        index = -1;
        push(path);
    }

    public void push(String path) {
        navigate(path, "push", -1);
    }

    public boolean back() throws Exception {
        if (index <= 0) return false;
        String target = history.get(index - 1);
        navigate(target, "back", index - 1);
        return true;
    }

    public void replace(String path) throws Exception {
        navigate(path, "replace", index);
    }

    public boolean forward() throws Exception {
        if (index >= history.size() - 1) return false;
        String target = history.get(index + 1);
        navigate(target, "forward", index + 1);
        return true;
    }

    public void go(int delta) {
        int targetIndex = NativeHistory.targetIndex(history, index, delta);
        if (targetIndex < 0) return;
        String target = history.get(targetIndex);
        navigate(target, delta < 0 ? "back" : "forward", targetIndex);
    }

    private void navigate(String path, String mode, int historyIndex) {
        final long token = ++navigationToken;
        lastRequestedPath = path;
        if (renderer != null) renderer.updateState("__nuxtNavigationPending", "true");
        navigateWithPageGuard(path, mode, historyIndex, 0, token);
    }

    private boolean isCurrentNavigation(long token) {
        return token == navigationToken;
    }

    private void navigateWithPageGuard(String path, String mode, int historyIndex, int attempt, long token) {
        if (!isCurrentNavigation(token)) return;
        if (attempt >= 8) {
            showError(new IllegalStateException("Too many redirects while navigating to " + path));
            return;
        }
        final String target = path;
        final ScriptRuntime source = scripts;
        if (source == null) {
            finishNavigation(target, mode, historyIndex, attempt, token);
            return;
        }
        try {
            String targetPattern = matchingPattern(target.split("[?#]", 2)[0]);
            String currentPattern = matchingPattern(currentPath.split("[?#]", 2)[0]);
            String kind = targetPattern != null && targetPattern.equals(currentPattern) ? "update" : "leave";
            String to = routeSnapshotFor(target);
            String from = routeSnapshot();
            String result = source.runRouteGuards(kind, to, from);
            if ("__nuxt_async__".equals(result)) {
                source.runRouteGuardsAsync(kind, to, from, (asyncResult, error) ->
                        mainHandler.post(() -> completePageGuard(source, target, mode, historyIndex, attempt, token, asyncResult, error)));
            } else {
                completePageGuard(source, target, mode, historyIndex, attempt, token, result, null);
            }
        } catch (Throwable error) {
            if (isCurrentNavigation(token)) showError(error);
        }
    }

    private void completePageGuard(ScriptRuntime source, String target, String mode, int historyIndex, int attempt,
                                   long token, String result, Throwable error) {
        if (!isCurrentNavigation(token)) return;
        if (source != scripts && scripts != null) return;
        if (error != null) { showError(error); return; }
        if ("__nuxt_abort__".equals(result)) { clearNavigationPending(); return; }
        if (result != null && result.startsWith("__nuxt_redirect__:")) {
            navigateWithPageGuard(result.substring("__nuxt_redirect__:".length()), mode, historyIndex, attempt + 1, token);
            return;
        }
        finishNavigation(target, mode, historyIndex, attempt, token);
    }

    private void finishNavigation(String path, String mode, int historyIndex, int attempt, long token) {
        if (!isCurrentNavigation(token)) return;
        try {
            runMiddlewareChain(path, mode, historyIndex, attempt, 0, token);
        } catch (Throwable error) {
            if (isCurrentNavigation(token)) showError(error);
        }
    }

    private void runMiddlewareChain(String path, String mode, int historyIndex, int attempt, int guardIndex, long token) {
        if (!isCurrentNavigation(token)) return;
        try {
            if (resolveAsset(path) == null) throw new IllegalArgumentException("Route not found: " + path);
            String pattern = matchingPattern(path.split("[?#]", 2)[0]);
            ArrayList<String> guards = pattern == null ? null : routeMiddleware.get(pattern);
            if (guards == null || guards.isEmpty() || middlewareScripts == null || guardIndex >= guards.size()) {
                commitNavigation(path, mode, historyIndex, token);
                return;
            }
            String name = guards.get(guardIndex);
            String asset = middlewareAssets.get(name);
            if (asset == null) throw new IllegalStateException("Missing route middleware asset: " + name);
            String to = routeSnapshotFor(path);
            String from = routeSnapshot();
            middlewareScripts.runMiddlewareAsync(assets.read(asset), to, from, (result, error) -> mainHandler.post(() -> {
                if (!isCurrentNavigation(token)) return;
                if (error != null) { showError(error); return; }
                if ("__nuxt_abort__".equals(result)) { clearNavigationPending(); return; }
                if (result != null && result.startsWith("__nuxt_redirect__:")) {
                    navigateWithPageGuard(result.substring("__nuxt_redirect__:".length()), mode, historyIndex, attempt + 1, token);
                    return;
                }
                runMiddlewareChain(path, mode, historyIndex, attempt, guardIndex + 1, token);
            }));
        } catch (Throwable error) {
            if (isCurrentNavigation(token)) showError(error);
        }
    }

    private void commitNavigation(String target, String mode, int historyIndex, long token) {
        if (!isCurrentNavigation(token)) return;
        try {
            render(target);
            if (!pluginMounted && pluginScripts != null) {
                pluginScripts.runPluginHook("app:mounted", "{}");
                pluginMounted = true;
            }
            if ("push".equals(mode)) {
                history.subList(index + 1, history.size()).clear();
                history.add(target);
                index += 1;
            } else if ("replace".equals(mode)) {
                if (index < 0) history.add(target);
                else history.set(index, target);
                if (index < 0) index = 0;
            } else {
                index = historyIndex;
            }
            persistNavigationState();
            clearNavigationPending();
        } catch (Throwable error) {
            showError(error);
        }
    }

    private void clearNavigationPending() {
        if (renderer != null) renderer.updateState("__nuxtNavigationPending", "false");
    }

    public Map<String, Object> invoke(String action) {
        if (scripts == null) throw new IllegalStateException("The current route has no script runtime: " + action);
        return scripts.invoke(action);
    }

    public void invokeAsync(String action, InvocationCallback callback) {
        if (scripts == null) throw new IllegalStateException("The current route has no script runtime: " + action);
        scripts.invokeAsync(action, (state, error) -> mainHandler.post(() -> {
            applyRuntimeSnapshot(scripts);
            drainPendingNavigations();
            callback.complete(error);
        }));
    }

    public void invokeAsync(String action, String argumentJson, InvocationCallback callback) {
        if (scripts == null) throw new IllegalStateException("The current route has no script runtime: " + action);
        scripts.invokeAsync(action, argumentJson, (state, error) -> mainHandler.post(() -> {
            applyRuntimeSnapshot(scripts);
            drainPendingNavigations();
            callback.complete(error);
        }));
    }

    public void updateState(String name, String value) {
        if (scripts == null) throw new IllegalStateException("The current route has no script runtime: " + name);
        scripts.updateState(name, value);
    }

    public boolean handleError(Throwable error) {
        if (scripts == null) return false;
        try { return scripts.handleError(error); }
        catch (RuntimeException ignored) { return false; }
    }

    public void showError(Throwable error) {
        if (scripts != null) {
            clearRuntimeRequests(scripts);
            try { scripts.unmounted(); } catch (RuntimeException ignored) { }
            scripts.close();
        }
        scripts = null;
        renderer = null;
        try {
            NativeRenderer errorRenderer = new NativeRenderer(host.getContext(), actions, this::updateState, host);
            JSONObject errorState = new JSONObject()
                    .put("statusCode", error instanceof NativeRouteError ? ((NativeRouteError) error).statusCode() : 500)
                    .put("statusMessage", "Native runtime error")
                    .put("message", error == null || error.getMessage() == null ? "Unknown native runtime error" : error.getMessage());
            errorRenderer.seedState("error", errorState);
            View customError = errorRenderer.render(new JSONObject(assets.read("error.ir.json")));
            LinearLayout screen = new LinearLayout(host.getContext());
            screen.setOrientation(LinearLayout.VERTICAL);
            screen.addView(customError, new LinearLayout.LayoutParams(-1, 0, 1));
            Button retry = new Button(host.getContext());
            retry.setText("Try again");
            retry.setOnClickListener(source -> push(lastRequestedPath));
            screen.addView(retry, new LinearLayout.LayoutParams(-1, -2));
            renderer = errorRenderer;
            host.removeAllViews();
            host.addView(screen, new FrameLayout.LayoutParams(-1, -1));
            errorRenderer.attachPortals();
            try {
                final ScriptRuntime[] owner = new ScriptRuntime[1];
                scripts = new ScriptRuntime(
                        fetch,
                        this::startAsyncFetch,
                        this::onStateChanged,
                        routeBridge(),
                        this::runtimeConfigSnapshot,
                        next -> requestNavigation(() -> push(next)),
                        next -> requestNavigation(() -> replace(next)),
                        () -> requestNavigation(() -> back()),
                        () -> requestNavigation(() -> forward()),
                        (key, value) -> { },
                        this::pluginSnapshot,
                        this::capabilitiesSnapshot,
                        device,
                        storage,
                        permissions,
                        fileSystem,
                        notifications,
                        media,
                        sensors,
                        result -> { },
                        delta -> requestNavigation(() -> go(delta)),
                        (title, message, positive, negative) -> {
                            int requestId = dialog.show(title, message, positive, negative);
                            if (requestId >= 0 && owner[0] != null) dialogRuntimes.put(requestId, owner[0]);
                            return requestId;
                        }
                );
                owner[0] = scripts;
                String errorScript = "error.script.js";
                scripts.load(assets.read(errorScript), errorScript, readActions("error.script.json"));
                scripts.seedState("error", errorState.toString());
                errorRenderer.updateSnapshot(scripts.stateSnapshot());
                scripts.mounted();
            } catch (Exception errorScriptFailure) {
                if (scripts != null) scripts.close();
                scripts = null;
            }
            return;
        } catch (Exception ignored) {
            // Fall through to the framework-owned native error screen when the custom asset is invalid.
        }
        LinearLayout screen = new LinearLayout(host.getContext());
        screen.setOrientation(LinearLayout.VERTICAL);
        screen.setPadding(48, 48, 48, 48);
        TextView title = new TextView(host.getContext());
        title.setText("Something went wrong");
        title.setTextColor(Color.rgb(185, 28, 28));
        title.setTextSize(24);
        title.setTypeface(null, 1);
        TextView message = new TextView(host.getContext());
        String detail = error == null ? "Unknown native runtime error" : error.getMessage();
        message.setText(detail == null || detail.isEmpty() ? String.valueOf(error) : detail);
        message.setTextSize(16);
        Button retry = new Button(host.getContext());
        retry.setText("Try again");
        retry.setOnClickListener(source -> {
            push(lastRequestedPath);
        });
        screen.addView(title, new LinearLayout.LayoutParams(-1, -2));
        screen.addView(message, new LinearLayout.LayoutParams(-1, -2));
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(-1, -2);
        retryParams.topMargin = 24;
        screen.addView(retry, retryParams);
        host.removeAllViews();
        host.addView(screen, new FrameLayout.LayoutParams(-1, -1));
    }

    public void close() {
        if (scripts != null) {
            clearRuntimeRequests(scripts);
            scripts.unmounted();
            scripts.close();
        }
        if (middlewareScripts != null) {
            clearRuntimeRequests(middlewareScripts);
            middlewareScripts.close();
        }
        if (pluginScripts != null) {
            clearRuntimeRequests(pluginScripts);
            try { pluginScripts.disposePlugin(); } catch (RuntimeException ignored) { }
            pluginScripts.close();
        }
        remoteFetch.close();
        scripts = null;
        middlewareScripts = null;
        pluginScripts = null;
        pluginMounted = false;
    }

    private boolean restoreNavigationState() {
        try {
            String serialized = navigationState.getString("history", null);
            int savedIndex = navigationState.getInt("index", -1);
            if (serialized == null || savedIndex < 0) return false;
            JSONArray savedHistory = new JSONArray(serialized);
            history.clear();
            for (int i = 0; i < savedHistory.length(); i++) {
                String path = savedHistory.optString(i, "");
                if (path.isEmpty() || resolveAsset(path) == null) {
                    history.clear();
                    index = -1;
                    return false;
                }
                history.add(path);
            }
            if (savedIndex >= history.size()) {
                history.clear();
                index = -1;
                return false;
            }
            index = savedIndex;
            return true;
        } catch (Exception error) {
            history.clear();
            index = -1;
            return false;
        }
    }

    private void persistNavigationState() {
        try {
            navigationState.edit()
                    .putString("history", new JSONArray(history).toString())
                    .putInt("index", index)
                    .apply();
        } catch (Exception ignored) { }
    }

    private void render(String path) throws Exception {
        String asset = resolveAsset(path);
        if (asset == null) throw new IllegalArgumentException("Route not found: " + path);
        currentPath = path;
        if (scripts != null) {
            clearRuntimeRequests(scripts);
            scripts.unmounted();
            scripts.close();
        }
        scripts = null;
        activeStateRefs.clear();
        renderer = new NativeRenderer(host.getContext(), actions, this::updateState, host);
        renderer.seedState("__nuxtNavigationPending", true);
        renderer.seedState("__nuxtRoutePath", path.split("[?#]", 2)[0]);
        View screen = renderer.render(new JSONObject(assets.read(asset)));
        host.removeAllViews();
        host.addView(screen, new FrameLayout.LayoutParams(-1, -1));
        renderer.attachPortals();
        String scriptAsset = asset.replace(".ir.json", ".script.js");
        try {
            activeStateRefs.addAll(readStateRefs(scriptAsset.replace(".js", ".json")));
            final ScriptRuntime[] owner = new ScriptRuntime[1];
            scripts = new ScriptRuntime(
                    fetch,
                    this::startAsyncFetch,
                    this::onStateChanged,
                    routeBridge(),
                    this::runtimeConfigSnapshot,
                    next -> requestNavigation(() -> push(next)),
                    next -> requestNavigation(() -> replace(next)),
                    () -> requestNavigation(() -> back()),
                    () -> requestNavigation(() -> forward()),
                    (key, value) -> { },
                    this::pluginSnapshot,
                    this::capabilitiesSnapshot,
                    device,
                    storage,
                    permissions,
                    fileSystem,
                    notifications,
                    media,
                    sensors,
                    result -> { },
                    delta -> requestNavigation(() -> go(delta)),
                    (title, message, positive, negative) -> {
                        int requestId = dialog.show(title, message, positive, negative);
                        if (requestId >= 0 && owner[0] != null) dialogRuntimes.put(requestId, owner[0]);
                        return requestId;
                    }
            );
            owner[0] = scripts;
            scripts.load(assets.read(scriptAsset), scriptAsset, readActions(scriptAsset.replace(".js", ".json")));
            restoreRuntimeState(path, scripts);
            renderer.updateSnapshot(scripts.stateSnapshot());
            scripts.mounted();
        } catch (java.io.FileNotFoundException missingScript) {
            if (scripts != null) scripts.close();
            scripts = null;
            activeStateRefs.clear();
        }
        renderer.updateState("__nuxtNavigationPending", "false");
    }

    private String resolveAsset(String path) {
        String normalized = path.split("[?#]", 2)[0].replaceAll("/+$", "");
        if (normalized.isEmpty()) normalized = "/";
        String exact = routeAssets.get(normalized);
        if (exact != null) return exact;
        String best = null;
        int bestScore = Integer.MIN_VALUE;
        for (Map.Entry<String, String> entry : routeAssets.entrySet()) {
            int score = matchScore(entry.getKey(), normalized);
            if (score > bestScore) {
                bestScore = score;
                best = entry.getValue();
            }
        }
        return bestScore == Integer.MIN_VALUE ? null : best;
    }

    private String guardPath(String path) throws Exception {
        String target = path;
        for (int attempt = 0; attempt < 8; attempt++) {
            if (resolveAsset(target) == null) throw new IllegalArgumentException("Route not found: " + target);
            String pattern = matchingPattern(target.split("[?#]", 2)[0]);
            ArrayList<String> guards = pattern == null ? null : routeMiddleware.get(pattern);
            if (guards == null || guards.isEmpty() || middlewareScripts == null) return target;
            String from = routeSnapshot();
            String to = routeSnapshotFor(target);
            String redirect = null;
            for (String name : guards) {
                String asset = middlewareAssets.get(name);
                if (asset == null) throw new IllegalStateException("Missing route middleware asset: " + name);
                String result = middlewareScripts.runMiddleware(assets.read(asset), to, from);
                if ("__nuxt_abort__".equals(result)) return null;
                if (result.startsWith("__nuxt_redirect__:")) {
                    redirect = result.substring("__nuxt_redirect__:".length());
                    break;
                }
            }
            if (redirect == null) return target;
            if (redirect.equals(target)) return null;
            target = redirect;
        }
        throw new IllegalStateException("Too many middleware redirects while navigating to " + path);
    }

    private int matchScore(String pattern, String path) {
        String[] expected = pattern.split("/", -1);
        String[] actual = path.split("/", -1);
        int score = 0;
        int i = 0;
        for (; i < expected.length; i++) {
            String segment = expected[i];
            if (segment.isEmpty()) {
                if (i < actual.length && actual[i].isEmpty()) continue;
                return Integer.MIN_VALUE;
            }
            if (segment.startsWith("*")) return score + 1;
            if (i >= actual.length || actual[i].isEmpty()) {
                if (segment.endsWith("?")) continue;
                return Integer.MIN_VALUE;
            }
            if (segment.startsWith(":")) {
                score += segment.endsWith("?") ? 10 : 20;
                continue;
            }
            if (!segment.equals(actual[i])) return Integer.MIN_VALUE;
            score += 40;
        }
        return i == actual.length ? score : Integer.MIN_VALUE;
    }

    private Set<String> readActions(String manifestAsset) throws Exception {
        Set<String> actions = new HashSet<>();
        try {
            JSONArray values = new JSONObject(assets.read(manifestAsset)).optJSONArray("actions");
            if (values != null) for (int i = 0; i < values.length(); i++) actions.add(values.getString(i));
        } catch (java.io.FileNotFoundException ignored) {
            // A script may exist without metadata during development builds.
        }
        return actions;
    }

    private Set<String> readStateRefs(String manifestAsset) throws Exception {
        Set<String> stateRefs = new HashSet<>();
        try {
            JSONArray values = new JSONObject(assets.read(manifestAsset)).optJSONArray("stateRefs");
            if (values != null) for (int i = 0; i < values.length(); i++) stateRefs.add(values.getString(i));
        } catch (java.io.FileNotFoundException ignored) {
            // A script may exist without metadata during development builds.
        }
        return stateRefs;
    }

    private void onStateChanged(String name, String value) {
        mainHandler.post(() -> {
            if ("__nuxtHead".equals(name)) {
                applyHead(value);
                return;
            }
            if ("__nuxtShowError".equals(name)) {
                try {
                    JSONObject payload = new JSONObject(value == null ? "{}" : value);
                    int status = payload.optInt("statusCode", 500);
                    String message = payload.optString("statusMessage", payload.optString("message", "Native runtime error"));
                    showError(new NativeRouteError(status, message));
                } catch (Exception error) {
                    showError(error);
                }
                return;
            }
            if ("__nuxtClearError".equals(name)) {
                push(lastRequestedPath);
                return;
            }
            if (renderer != null) renderer.updateState(name, value);
            if (activeStateRefs.contains(name)) persistRuntimeState();
        });
    }

    private static final class NativeRouteError extends RuntimeException {
        private final int statusCode;
        NativeRouteError(int statusCode, String message) {
            super(message);
            this.statusCode = statusCode;
        }
        int statusCode() { return statusCode; }
    }

    private void restoreRuntimeState(String path, ScriptRuntime runtime) {
        try {
            String snapshot = navigationState.getString(stateKey(path), null);
            if (snapshot != null) runtime.restoreState(snapshot, activeStateRefs);
        } catch (Exception ignored) {
            // Corrupt route state must not prevent the route from starting.
        }
    }

    private void persistRuntimeState() {
        if (scripts == null || activeStateRefs.isEmpty()) return;
        try {
            navigationState.edit().putString(stateKey(currentPath), scripts.stateSnapshot()).apply();
        } catch (Exception ignored) {
            // Persistence is best effort; the active route remains authoritative.
        }
    }

    private String stateKey(String path) {
        return "state:" + (path == null ? "/" : path);
    }

    private void applyHead(String value) {
        if (!(host.getContext() instanceof Activity)) return;
        try {
            JSONObject head = new JSONObject(value == null ? "{}" : value);
            if (head.has("title") && !head.isNull("title")) ((Activity) host.getContext()).setTitle(head.optString("title"));
        } catch (Exception ignored) {
            // Invalid metadata must not affect route rendering.
        }
    }

    private int startAsyncFetch(String path, String method, String body, String headers) {
        return startAsyncFetchFor(scripts, path, method, body, headers);
    }

    private int startAsyncFetchFor(ScriptRuntime target, String path, String method, String body, String headers) {
        if (target == null) return -1;
        final int requestId;
        synchronized (asyncRuntimes) {
            requestId = nextAsyncRequest++;
            asyncRuntimes.put(requestId, target);
        }
        NativeRemoteFetch.Callback completion = (response, failure) -> {
            // Always cross back through the host queue. The JS bridge registers
            // its Promise resolver immediately after fetch() returns; delivering
            // a very fast embedded response on the server thread could otherwise
            // beat that registration and lose the continuation.
            mainHandler.post(() -> {
                ScriptRuntime runtime;
                synchronized (asyncRuntimes) {
                    runtime = asyncRuntimes.remove(requestId);
                }
                if (runtime == null) return;
                try {
                    runtime.resolveAsync(requestId, response, failure);
                    applyRuntimeSnapshot(runtime);
                } catch (RuntimeException ignored) {
                    // The route may have been replaced before the request completed.
                }
            });
        };
        String apiBase = remoteApiBase();
        if (apiBase == null || apiBase.isEmpty()) asyncFetch.fetch(path, method, body, headers, completion::complete);
        else remoteFetch.fetch(apiBase, path, method, body, headers, completion);
        return requestId;
    }

    private String remoteApiBase() {
        try {
            JSONObject config = new JSONObject(runtimeConfig);
            JSONObject publicConfig = config.optJSONObject("public");
            return publicConfig == null ? "" : publicConfig.optString("apiBase", "").trim();
        } catch (Exception ignored) {
            return "";
        }
    }

    /**
     * Apply a complete JavaScript snapshot after an action or async bridge
     * response. Individual ref setters still stream updates, but this closes
     * the timing gap around Promise continuations and keeps native bindings
     * aligned with the authoritative route state.
     */
    private void applyRuntimeSnapshot(ScriptRuntime runtime) {
        if (runtime == null) return;
        final String snapshot;
        try {
            snapshot = runtime.stateSnapshot();
        } catch (RuntimeException ignored) {
            return;
        }
        mainHandler.post(() -> {
            if (runtime != scripts || renderer == null) return;
            renderer.updateSnapshot(snapshot);
            if (!activeStateRefs.isEmpty()) persistRuntimeState();
        });
    }

    private void providePlugin(String key, String value) {
        synchronized (pluginValues) {
            pluginValues.put(key, value == null ? "null" : value);
        }
    }

    private String pluginSnapshot() {
        StringBuilder result = new StringBuilder("{");
        synchronized (pluginValues) {
            boolean first = true;
            for (Map.Entry<String, String> entry : pluginValues.entrySet()) {
                if (!first) result.append(',');
                first = false;
                result.append(JSONObject.quote(entry.getKey())).append(':').append(entry.getValue());
            }
        }
        return result.append('}').toString();
    }

    private String capabilitiesSnapshot() {
        return capabilityBroker.snapshot();
    }

    private boolean hasNativePermission(String permission) {
        if (permission == null || permission.trim().isEmpty()) return false;
        if (Build.VERSION.SDK_INT < 23) return true;
        return host.getContext().checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private int requestNativePermission(String permission) {
        if (!capabilityBroker.has("permissions") || permission == null || permission.trim().isEmpty()) return -1;
        if (hasNativePermission(permission)) return 0;
        if (!(host.getContext() instanceof Activity)) return -1;
        int requestId = nextPermissionRequest++;
        ScriptRuntime target = scripts != null ? scripts : (pluginScripts != null ? pluginScripts : middlewareScripts);
        if (target == null) return -1;
        permissionRuntimes.put(requestId, target);
        try {
            ((Activity) host.getContext()).requestPermissions(new String[] { permission }, requestId);
        } catch (RuntimeException error) {
            permissionRuntimes.remove(requestId);
            return -1;
        }
        return requestId;
    }

    public void resolvePermission(int requestId, boolean granted) {
        ScriptRuntime target = permissionRuntimes.remove(requestId);
        if (target != null) target.resolvePermission(requestId, granted);
    }

    public void resolveDialog(int requestId, boolean result) {
        ScriptRuntime target = dialogRuntimes.remove(requestId);
        if (target != null) target.resolveDialog(requestId, result);
    }

    private void clearRuntimeRequests(ScriptRuntime runtime) {
        if (runtime == null) return;
        synchronized (asyncRuntimes) {
            asyncRuntimes.entrySet().removeIf(entry -> entry.getValue() == runtime);
        }
        permissionRuntimes.entrySet().removeIf(entry -> entry.getValue() == runtime);
        dialogRuntimes.entrySet().removeIf(entry -> entry.getValue() == runtime);
        ArrayList<Integer> mediaRequests = new ArrayList<>();
        for (Map.Entry<Integer, ScriptRuntime> entry : mediaRuntimes.entrySet()) {
            if (entry.getValue() == runtime) mediaRequests.add(entry.getKey());
        }
        for (Integer requestId : mediaRequests) {
            mediaRuntimes.remove(requestId);
            Uri capture = captureUris.remove(requestId);
            if (capture != null) {
                try { host.getContext().getContentResolver().delete(capture, null, null); }
                catch (RuntimeException ignored) { }
            }
        }
        ArrayList<Integer> sensors = new ArrayList<>();
        for (Map.Entry<Integer, SensorSubscription> entry : sensorSubscriptions.entrySet()) {
            if (entry.getValue().runtime == runtime) sensors.add(entry.getKey());
        }
        for (Integer sensorId : sensors) stopNativeSensor(sensorId);
    }

    private int pickNativeMedia(String mimeType) {
        if (!capabilityBroker.has("media") || !(host.getContext() instanceof Activity)) return -1;
        int requestId = nextMediaRequest++;
        ScriptRuntime target = scripts != null ? scripts : (pluginScripts != null ? pluginScripts : middlewareScripts);
        if (target == null) return -1;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType == null || mimeType.trim().isEmpty() ? "*/*" : mimeType.trim());
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        mediaRuntimes.put(requestId, target);
        try {
            ((Activity) host.getContext()).startActivityForResult(intent, requestId);
        } catch (RuntimeException error) {
            mediaRuntimes.remove(requestId);
            return -1;
        }
        return requestId;
    }

    private int captureNativePhoto() {
        if (!capabilityBroker.has("media") || !(host.getContext() instanceof Activity)) return -1;
        if (!hasNativePermission("android.permission.CAMERA")) return -1;
        if (Build.VERSION.SDK_INT < 29) return -1;
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, "nuxt-native-" + System.currentTimeMillis() + ".jpg");
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
        values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/NuxtNative");
        values.put(MediaStore.Images.Media.IS_PENDING, 1);
        Uri output = host.getContext().getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        if (output == null) return -1;
        int requestId = nextMediaRequest++;
        ScriptRuntime target = scripts != null ? scripts : (pluginScripts != null ? pluginScripts : middlewareScripts);
        if (target == null) {
            host.getContext().getContentResolver().delete(output, null, null);
            return -1;
        }
        Intent intent = new Intent("android.media.action.IMAGE_CAPTURE");
        intent.putExtra(MediaStore.EXTRA_OUTPUT, output);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        mediaRuntimes.put(requestId, target);
        captureUris.put(requestId, output);
        try {
            ((Activity) host.getContext()).startActivityForResult(intent, requestId);
        } catch (RuntimeException error) {
            mediaRuntimes.remove(requestId);
            captureUris.remove(requestId);
            host.getContext().getContentResolver().delete(output, null, null);
            return -1;
        }
        return requestId;
    }

    public void resolveMedia(int requestId, boolean success, String uri) {
        ScriptRuntime target = mediaRuntimes.remove(requestId);
        Uri capture = captureUris.remove(requestId);
        if (capture != null) {
            if (success) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.IS_PENDING, 0);
                host.getContext().getContentResolver().update(capture, values, null, null);
                if (target != null) target.resolveMedia(requestId, capture.toString());
            } else {
                host.getContext().getContentResolver().delete(capture, null, null);
                if (target != null) target.resolveMedia(requestId, null);
            }
            return;
        }
        if (target != null) target.resolveMedia(requestId, success ? uri : null);
    }

    private int startNativeSensor(String type) {
        if (!capabilityBroker.has("sensors")) return -1;
        SensorManager manager = (SensorManager) host.getContext().getSystemService(android.content.Context.SENSOR_SERVICE);
        if (manager == null) return -1;
        int sensorType = resolveSensorType(type);
        Sensor sensor = manager.getDefaultSensor(sensorType);
        if (sensor == null) return -1;
        ScriptRuntime target = scripts != null ? scripts : (pluginScripts != null ? pluginScripts : middlewareScripts);
        if (target == null) return -1;
        int sensorId = nextSensorId++;
        SensorEventListener listener = new SensorEventListener() {
            @Override public void onSensorChanged(SensorEvent event) {
                try {
                    JSONObject sample = new JSONObject();
                    sample.put("type", type == null ? "accelerometer" : type);
                    sample.put("timestamp", event.timestamp);
                    JSONArray values = new JSONArray();
                    for (float value : event.values) values.put(value);
                    sample.put("values", values);
                    if (event.values.length > 0) sample.put("x", event.values[0]);
                    if (event.values.length > 1) sample.put("y", event.values[1]);
                    if (event.values.length > 2) sample.put("z", event.values[2]);
                    target.resolveSensor(sensorId, sample.toString());
                } catch (Exception ignored) { }
            }

            @Override public void onAccuracyChanged(Sensor changed, int accuracy) { }
        };
        if (!manager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_GAME)) return -1;
        sensorSubscriptions.put(sensorId, new SensorSubscription(manager, listener, target));
        return sensorId;
    }

    private int resolveSensorType(String type) {
        if ("gyroscope".equalsIgnoreCase(type)) return Sensor.TYPE_GYROSCOPE;
        if ("magnetometer".equalsIgnoreCase(type)) return Sensor.TYPE_MAGNETIC_FIELD;
        if ("rotation".equalsIgnoreCase(type) || "rotation-vector".equalsIgnoreCase(type)) return Sensor.TYPE_ROTATION_VECTOR;
        return Sensor.TYPE_ACCELEROMETER;
    }

    private void stopNativeSensor(int sensorId) {
        SensorSubscription subscription = sensorSubscriptions.remove(sensorId);
        if (subscription != null) subscription.manager.unregisterListener(subscription.listener);
    }

    private static final class SensorSubscription {
        final SensorManager manager;
        final SensorEventListener listener;
        final ScriptRuntime runtime;

        SensorSubscription(SensorManager manager, SensorEventListener listener, ScriptRuntime runtime) {
            this.manager = manager;
            this.listener = listener;
            this.runtime = runtime;
        }
    }

    public void setAppState(String state) {
        if ("background".equals(state)) {
            for (Integer sensorId : new ArrayList<>(sensorSubscriptions.keySet())) stopNativeSensor(sensorId);
        }
        if (scripts != null) scripts.appState(state);
        if (pluginScripts != null) pluginScripts.appState(state);
        if (middlewareScripts != null) middlewareScripts.appState(state);
    }

    private String routeSnapshot() {
        return routeSnapshotFor(currentPath);
    }

    private ScriptRuntime.RouteBridge routeBridge() {
        return new ScriptRuntime.RouteBridge() {
            @Override public String current() { return routeSnapshot(); }
            @Override public String names() { return routeNamesSnapshot(); }
        };
    }

    private String routeSnapshotFor(String path) {
        try {
            int queryIndex = path.indexOf('?');
            int hashIndex = path.indexOf('#');
            String normalized = path.split("[?#]", 2)[0].replaceAll("/+$", "");
            if (normalized.isEmpty()) normalized = "/";
            String pattern = matchingPattern(normalized);
            JSONObject params = new JSONObject();
            if (pattern != null) addRouteParams(pattern, normalized, params);
            JSONObject query = new JSONObject();
            if (queryIndex >= 0 && (hashIndex < 0 || queryIndex < hashIndex)) {
                int end = hashIndex >= 0 ? hashIndex : path.length();
                addQueryParameters(path.substring(queryIndex + 1, end), query);
            }
            String hash = hashIndex >= 0 ? path.substring(hashIndex) : "";
            String name = "";
            for (Map.Entry<String, String> entry : routeNames.entrySet()) {
                if (entry.getValue().equals(pattern)) { name = entry.getKey(); break; }
            }
            return new JSONObject().put("path", normalized).put("fullPath", path).put("query", query).put("hash", hash).put("params", params).put("name", name).toString();
        } catch (Exception error) {
            throw new RuntimeException("Unable to serialize current route", error);
        }
    }

    private void addQueryParameters(String source, JSONObject query) throws Exception {
        if (source == null || source.isEmpty()) return;
        for (String entry : source.split("&")) {
            if (entry.isEmpty()) continue;
            int separator = entry.indexOf('=');
            String key = decodeRoutePart(separator < 0 ? entry : entry.substring(0, separator));
            String value = decodeRoutePart(separator < 0 ? "" : entry.substring(separator + 1));
            if (key.isEmpty()) continue;
            if (!query.has(key)) {
                query.put(key, value);
            } else if (query.get(key) instanceof JSONArray) {
                query.getJSONArray(key).put(value);
            } else {
                query.put(key, new JSONArray().put(query.get(key)).put(value));
            }
        }
    }

    private String decodeRoutePart(String value) {
        return Uri.decode(value.replace('+', ' '));
    }

    private String runtimeConfigSnapshot() {
        return runtimeConfig;
    }

    private String routeNamesSnapshot() {
        try { return new JSONObject(routeNames).toString(); }
        catch (Exception error) { return "{}"; }
    }

    private String matchingPattern(String path) {
        String best = null;
        int bestScore = Integer.MIN_VALUE;
        for (String pattern : routeAssets.keySet()) {
            int score = matchScore(pattern, path);
            if (score > bestScore) {
                bestScore = score;
                best = pattern;
            }
        }
        return bestScore == Integer.MIN_VALUE ? null : best;
    }

    private void addRouteParams(String pattern, String path, JSONObject params) throws Exception {
        String[] expected = pattern.split("/", -1);
        String[] actual = path.split("/", -1);
        for (int i = 0; i < expected.length && i < actual.length; i++) {
            String segment = expected[i];
            if (segment.startsWith(":")) params.put(segment.replaceFirst("^:", "").replaceFirst("\\?$", ""), java.net.URLDecoder.decode(actual[i], "UTF-8"));
            else if (segment.startsWith("*")) {
                StringBuilder rest = new StringBuilder();
                for (int j = i; j < actual.length; j++) {
                    if (rest.length() > 0) rest.append('/');
                    rest.append(actual[j]);
                }
                params.put(segment.substring(1), java.net.URLDecoder.decode(rest.toString(), "UTF-8"));
                return;
            }
        }
    }

    private void requestNavigation(NavigationOperation operation) {
        synchronized (pendingNavigations) {
            pendingNavigations.add(operation);
        }
    }

    private void drainPendingNavigations() {
        while (true) {
            NavigationOperation operation;
            synchronized (pendingNavigations) {
                operation = pendingNavigations.poll();
            }
            if (operation == null) return;
            try {
                operation.run();
            } catch (Exception error) {
                throw new RuntimeException("Script navigation failed", error);
            }
        }
    }

    private interface NavigationOperation { void run() throws Exception; }
}
