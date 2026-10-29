package com.nuxtnative.prototype;

import org.json.JSONArray;

import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Host-owned policy for native services exposed to generated JavaScript.
 *
 * Capabilities are deliberately names rather than Android objects. This keeps
 * the JavaScript boundary serializable and gives a future permission broker a
 * single place to add, remove, or audit service access.
 */
public final class NativeCapabilityBroker {
    private final Set<String> granted = new LinkedHashSet<>();

    public NativeCapabilityBroker(String... capabilities) {
        if (capabilities != null) {
            for (String capability : capabilities) {
                if (capability != null && !capability.trim().isEmpty()) granted.add(capability.trim());
            }
        }
    }

    public synchronized boolean has(String capability) {
        return capability != null && granted.contains(capability);
    }

    public synchronized void grant(String capability) {
        if (capability != null && !capability.trim().isEmpty()) granted.add(capability.trim());
    }

    public synchronized void revoke(String capability) {
        if (capability != null) granted.remove(capability);
    }

    public synchronized void configure(JSONArray capabilities) {
        granted.clear();
        if (capabilities == null) return;
        for (int i = 0; i < capabilities.length(); i++) {
            String capability = capabilities.optString(i, "");
            if (!capability.trim().isEmpty()) granted.add(capability.trim());
        }
    }

    public synchronized String snapshot() {
        JSONArray result = new JSONArray();
        for (String capability : granted) result.put(capability);
        return result.toString();
    }
}
