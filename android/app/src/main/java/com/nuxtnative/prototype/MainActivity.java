package com.nuxtnative.prototype;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Button;
import android.app.AlertDialog;
import android.graphics.Color;
import android.content.SharedPreferences;
import android.os.Build;
import org.json.JSONObject;
import org.json.JSONArray;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
public final class MainActivity extends Activity {
    private NativeRouter router;
    private NativeServer server;
    private String devServerBase = "";
    private String devServerToken = "";
    private final ConcurrentHashMap<String, String> devAssetCache = new ConcurrentHashMap<>();
    private volatile boolean hmrRunning;
    private final Handler hmrHandler = new Handler(Looper.getMainLooper());
    private String hmrVersion = "";

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout host = new FrameLayout(this);
        setContentView(host);
        configureDevServer();
        configureDevServerFromIntent(getIntent());
        Runnable initialize = () -> {
        try {
            server = new NativeServer(this::readAsset);
            server.loadManifest();
            SharedPreferences preferences = getSharedPreferences("nuxt_native", MODE_PRIVATE);
            ScriptRuntime.DeviceBridge device = () -> {
                try {
                    JSONObject value = new JSONObject();
                    value.put("model", Build.MODEL);
                    value.put("manufacturer", Build.MANUFACTURER);
                    value.put("androidVersion", Build.VERSION.RELEASE);
                    value.put("sdkInt", Build.VERSION.SDK_INT);
                    value.put("packageName", getPackageName());
                    return value.toString();
                } catch (Exception error) {
                    return "{}";
                }
            };
            ScriptRuntime.StorageBridge storage = new ScriptRuntime.StorageBridge() {
                @Override public String get(String key) { return preferences.getString(key, null); }
                @Override public void set(String key, String value) { preferences.edit().putString(key, value).apply(); }
                @Override public void remove(String key) { preferences.edit().remove(key).apply(); }
            };
            ScriptRuntime.FileSystemBridge fileSystem = new ScriptRuntime.FileSystemBridge() {
                private File resolvePath(String path) throws Exception {
                    File base = getFilesDir().getCanonicalFile();
                    String relative = path == null ? "" : path.trim();
                    while (relative.startsWith("/")) relative = relative.substring(1);
                    File target = new File(base, relative).getCanonicalFile();
                    String basePath = base.getPath();
                    if (!target.getPath().equals(basePath) && !target.getPath().startsWith(basePath + File.separator)) {
                        throw new SecurityException("Native filesystem path escapes the app-private directory");
                    }
                    return target;
                }

                @Override public String readText(String path) {
                    try { return new String(Files.readAllBytes(resolvePath(path).toPath()), StandardCharsets.UTF_8); }
                    catch (NoSuchFileException missing) { return null; }
                    catch (Exception error) { throw new RuntimeException("Unable to read native file", error); }
                }

                @Override public void writeText(String path, String value) {
                    try {
                        File target = resolvePath(path);
                        File parent = target.getParentFile();
                        if (parent != null && !parent.exists() && !parent.mkdirs()) throw new java.io.IOException("Unable to create parent directory");
                        Files.write(target.toPath(), (value == null ? "" : value).getBytes(StandardCharsets.UTF_8));
                    } catch (Exception error) { throw new RuntimeException("Unable to write native file", error); }
                }

                @Override public boolean exists(String path) {
                    try { return resolvePath(path).exists(); }
                    catch (Exception error) { throw new RuntimeException("Unable to inspect native file", error); }
                }

                @Override public void remove(String path) {
                    try {
                        File target = resolvePath(path);
                        if (target.isDirectory()) throw new IllegalArgumentException("Native filesystem remove only accepts files");
                        Files.deleteIfExists(target.toPath());
                    } catch (Exception error) { throw new RuntimeException("Unable to remove native file", error); }
                }

                @Override public String list(String path) {
                    try {
                        File directory = resolvePath(path);
                        JSONArray result = new JSONArray();
                        File[] children = directory.listFiles();
                        if (children != null) for (File child : children) result.put(child.getName());
                        return result.toString();
                    } catch (Exception error) { throw new RuntimeException("Unable to list native files", error); }
                }
            };
            final int[] nextNotificationId = { 1 };
            ScriptRuntime.NotificationsBridge notifications = (title, body, channelId) -> {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return false;
                NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                if (manager == null) return false;
                String resolvedChannel = channelId == null || channelId.trim().isEmpty() ? "nuxt-native" : channelId.trim();
                if (Build.VERSION.SDK_INT >= 26) {
                    manager.createNotificationChannel(new NotificationChannel(resolvedChannel, resolvedChannel, NotificationManager.IMPORTANCE_DEFAULT));
                }
                Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                        ? new Notification.Builder(this, resolvedChannel)
                        : new Notification.Builder(this);
                builder.setSmallIcon(android.R.drawable.ic_dialog_info)
                        .setContentTitle(title == null ? "" : title)
                        .setContentText(body == null ? "" : body)
                        .setAutoCancel(true);
                manager.notify(nextNotificationId[0]++, builder.build());
                return true;
            };
            final int[] nextDialogId = {40000};
            ScriptRuntime.DialogBridge dialogs = (title, message, positive, negative) -> {
                int requestId = nextDialogId[0]++;
                runOnUiThread(() -> {
                    AlertDialog.Builder builder = new AlertDialog.Builder(this)
                            .setTitle(title == null ? "" : title)
                            .setMessage(message == null ? "" : message)
                            .setPositiveButton(positive == null || positive.isEmpty() ? "OK" : positive, (dialog, which) -> {
                                if (router != null) router.resolveDialog(requestId, true);
                            });
                    if (negative != null && !negative.isEmpty()) {
                        builder.setNegativeButton(negative, (dialog, which) -> {
                            if (router != null) router.resolveDialog(requestId, false);
                        });
                    }
                    builder.setOnCancelListener(dialog -> { if (router != null) router.resolveDialog(requestId, false); });
                    builder.show();
                });
                return requestId;
            };
            NativeCapabilityBroker capabilities = new NativeCapabilityBroker("core", "network", "device", "storage", "permissions", "filesystem", "notifications", "media", "sensors", "dialog");
            router = new NativeRouter(host, actionDispatcher(), this::readAsset, server::fetch, server::fetchAsync, device, storage, capabilities, null, fileSystem, notifications, null, null, dialogs);
            router.loadManifest();
            router.start(routeFromIntent(getIntent()));
            startHmrPolling();
        } catch (Exception error) {
            android.util.Log.e("NuxtNative", "Unable to start native route host", error);
            showStartupError(host, error);
        }
        };
        if (devServerBase.isEmpty()) {
            initialize.run();
        } else {
            new Thread(() -> {
                try {
                    prepareDevAssets();
                    runOnUiThread(initialize);
                } catch (Exception error) {
                    runOnUiThread(() -> showStartupError(host, error));
                }
            }, "nuxt-native-startup").start();
        }
    }

    @Override
    public void onBackPressed() {
        try {
            if (router != null && router.back()) return;
        } catch (Exception error) {
            android.util.Log.e("NuxtNative", "Unable to navigate back", error);
            if (router != null) router.showError(error);
        }
        super.onBackPressed();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        boolean wirelessConnection = configureDevServerFromIntent(intent);
        if (wirelessConnection && router != null) {
            hmrVersion = "";
            if (!hmrRunning) startHmrPolling();
            try { router.reloadCurrent(); }
            catch (Exception error) { router.showError(error); }
        }
        if (router != null) {
            try { router.push(routeFromIntent(intent)); }
            catch (Exception error) { router.showError(error); }
        }
    }

    private String routeFromIntent(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || data.getPath() == null || data.getPath().isEmpty()) return "/";
        StringBuilder path = new StringBuilder(data.getPath());
        if (data.getEncodedQuery() != null) path.append('?').append(data.getEncodedQuery());
        if (data.getEncodedFragment() != null) path.append('#').append(data.getEncodedFragment());
        return path.toString();
    }

    @Override
    protected void onPause() {
        if (router != null) router.setAppState("background");
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (router != null) router.setAppState("active");
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (router != null && requestCode >= 10000) {
            boolean granted = grantResults.length > 0 && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED;
            router.resolvePermission(requestCode, granted);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (router != null && requestCode >= 20000) {
            String uri = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                try {
                    int takeFlags = data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION;
                    getContentResolver().takePersistableUriPermission(data.getData(), takeFlags);
                } catch (SecurityException ignored) { }
                uri = data.getData().toString();
            }
            router.resolveMedia(requestCode, resultCode == RESULT_OK, uri);
        }
    }

    private NativeRenderer.ActionDispatcher actionDispatcher() {
        return new NativeRenderer.ActionDispatcher() {
            @Override public void dispatch(String action, View source) { dispatchAction(action, source, null); }
            @Override public void dispatch(String action, View source, String eventJson) { dispatchAction(action, source, eventJson); }
        };
    }

    private void dispatchAction(String action, View source, String eventJson) {
        try {
            if (action.startsWith("navigate:")) {
                router.push(action.substring("navigate:".length()));
            } else if (router != null) {
                if (eventJson == null) router.invokeAsync(action, error -> handleActionError(action, error));
                else router.invokeAsync(action, eventJson, error -> handleActionError(action, error));
            }
        } catch (Exception error) {
            android.util.Log.e("NuxtNative", "Unable to dispatch native action: " + action, error);
            if (router != null && !router.handleError(error)) router.showError(error);
        }
    }

    private void handleActionError(String action, Throwable error) {
        if (error != null) {
            android.util.Log.e("NuxtNative", "Page action failed: " + action, error);
            if (!router.handleError(error)) router.showError(error);
        }
    }

    @Override
    protected void onDestroy() {
        hmrRunning = false;
        hmrHandler.removeCallbacksAndMessages(null);
        if (router != null) router.close();
        if (server != null) server.close();
        super.onDestroy();
    }

    private String readAsset(String name) throws Exception {
        if (!devServerBase.isEmpty()) {
            return readDevAsset(name);
        }
        return readBundledAsset(name);
    }

    private void prepareDevAssets() throws Exception {
        ArrayList<String> pending = new ArrayList<>();
        Set<String> queued = new HashSet<>();
        String[] manifests = {"native-config.json", "server-routes.json", "server-middleware.json", "server-plugins.json", "routes.json", "middleware.json", "plugins.json", "public-assets.json", "error.ir.json", "error.script.js", "error.script.json"};
        for (String manifest : manifests) {
            pending.add(manifest);
            queued.add(manifest);
        }
        for (int index = 0; index < pending.size(); index++) {
            String name = pending.get(index);
            String body;
            try {
                body = readDevAssetNetwork(name);
            } catch (java.io.IOException error) {
                if (name.startsWith("server-") || name.equals("middleware.json") || name.equals("plugins.json") || name.equals("public-assets.json") || name.startsWith("error.")) continue;
                throw error;
            }
            devAssetCache.put(name, body);
            try {
                collectAssetNames(new JSONObject(body), pending, queued);
            } catch (org.json.JSONException ignored) {
                // Non-JSON assets do not contain additional asset references.
            }
        }
    }

    private void collectAssetNames(Object value, ArrayList<String> pending, Set<String> queued) throws org.json.JSONException {
        if (value instanceof JSONObject) {
            JSONObject object = (JSONObject) value;
            java.util.Iterator<String> keys = object.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                Object child = object.get(key);
                if ("asset".equals(key) && child instanceof String) queueAssetBundle((String) child, pending, queued);
                collectAssetNames(child, pending, queued);
            }
        } else if (value instanceof JSONArray) {
            JSONArray array = (JSONArray) value;
            for (int index = 0; index < array.length(); index++) collectAssetNames(array.get(index), pending, queued);
        }
    }

    private void queueAssetBundle(String asset, ArrayList<String> pending, Set<String> queued) {
        if (queued.add(asset)) pending.add(asset);
        if (asset.endsWith(".ir.json")) {
            String script = asset.substring(0, asset.length() - ".ir.json".length());
            if (queued.add(script + ".script.js")) pending.add(script + ".script.js");
            if (queued.add(script + ".script.json")) pending.add(script + ".script.json");
        }
    }

    private String readBundledAsset(String name) throws Exception {
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(getAssets().open(name)))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    private void configureDevServer() {
        try {
            JSONObject config = new JSONObject(readBundledAsset("native-config.json"));
            JSONObject devServer = config.optJSONObject("devServer");
            if (devServer != null) {
                devServerBase = devServer.optString("url", "").replaceAll("/+$", "");
                devServerToken = devServer.optString("token", "");
            }
            if (!devServerBase.isEmpty()) android.util.Log.i("NuxtNativeHMR", "Dev server: " + devServerBase);
        } catch (Exception ignored) {
            devServerBase = "";
            devServerToken = "";
        }
    }

    private boolean configureDevServerFromIntent(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !"nuxtnative".equalsIgnoreCase(data.getScheme()) || !"connect".equalsIgnoreCase(data.getHost())) return false;
        String url = data.getQueryParameter("url");
        String token = data.getQueryParameter("token");
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://")) || token == null || token.trim().isEmpty()) return false;
        devServerBase = url.replaceAll("/+$", "");
        devServerToken = token;
        android.util.Log.i("NuxtNativeHMR", "Connected wirelessly to " + devServerBase);
        return true;
    }

    private String readDevAsset(String name) throws Exception {
        String cached = devAssetCache.get(name);
        if (cached != null) return cached;
        String body = readDevAssetNetwork(name);
        devAssetCache.put(name, body);
        return body;
    }

    private String readDevAssetNetwork(String name) throws Exception {
        String separator = devServerBase.contains("?") ? "&" : "?";
        String tokenQuery = devServerToken.isEmpty() ? "" : separator + "token=" + URLEncoder.encode(devServerToken, StandardCharsets.UTF_8.name());
        HttpURLConnection connection = (HttpURLConnection) new URL(devServerBase + "/" + name + tokenQuery).openConnection();
        connection.setConnectTimeout(2000);
        connection.setReadTimeout(3000);
        connection.setUseCaches(false);
        connection.setRequestProperty("Cache-Control", "no-cache");
        int responseCode = connection.getResponseCode();
        if (responseCode != HttpURLConnection.HTTP_OK) {
            throw new java.io.IOException("Dev asset unavailable: " + name + " from " + devServerBase + " (HTTP " + responseCode + ")");
        }
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line).append('\n');
        } finally {
            connection.disconnect();
        }
        return result.toString();
    }

    private void startHmrPolling() {
        if (devServerBase.isEmpty() || hmrRunning) return;
        hmrRunning = true;
        Thread poller = new Thread(() -> {
            while (hmrRunning) {
                try {
                    String status = readDevAssetNetwork("__nuxt_native_hmr");
                    String nextVersion = new JSONObject(status).optString("version", "");
                    if (!hmrVersion.isEmpty() && !hmrVersion.equals(nextVersion)) {
                        android.util.Log.i("NuxtNativeHMR", "Reloading route assets: " + hmrVersion + " -> " + nextVersion);
                        prepareDevAssets();
                        hmrHandler.post(() -> {
                            try { if (router != null) router.reloadCurrent(); }
                            catch (Exception error) { if (router != null) router.showError(error); }
                        });
                    }
                    hmrVersion = nextVersion;
                } catch (Exception error) {
                    android.util.Log.w("NuxtNativeHMR", "Dev bridge unavailable", error);
                }
                try { Thread.sleep(450); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); return; }
            }
        }, "nuxt-native-hmr");
        poller.setDaemon(true);
        poller.start();
    }

    private void showStartupError(FrameLayout host, Throwable error) {
        LinearLayout screen = new LinearLayout(this);
        screen.setOrientation(LinearLayout.VERTICAL);
        screen.setPadding(48, 48, 48, 48);
        TextView title = new TextView(this);
        title.setText("Unable to start Nuxt-native");
        title.setTextColor(Color.rgb(185, 28, 28));
        title.setTextSize(24);
        title.setTypeface(null, 1);
        TextView detail = new TextView(this);
        String message = error == null ? "Unknown native startup error" : error.getMessage();
        detail.setText(message == null || message.isEmpty() ? String.valueOf(error) : message);
        detail.setTextSize(16);
        Button retry = new Button(this);
        retry.setText("Try again");
        retry.setOnClickListener(view -> recreate());
        screen.addView(title, new LinearLayout.LayoutParams(-1, -2));
        screen.addView(detail, new LinearLayout.LayoutParams(-1, -2));
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(-1, -2);
        retryParams.topMargin = 24;
        screen.addView(retry, retryParams);
        host.removeAllViews();
        host.addView(screen, new FrameLayout.LayoutParams(-1, -1));
    }
}
