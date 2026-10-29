package com.nuxtnative.prototype;

import java.util.List;

/** Pure history arithmetic shared by the native router and JVM tests. */
public final class NativeHistory {
    private NativeHistory() { }

    public static int targetIndex(List<String> entries, int currentIndex, int delta) {
        if (delta == 0 || entries == null) return -1;
        int target = currentIndex + delta;
        return target < 0 || target >= entries.size() ? -1 : target;
    }

    public static String target(List<String> entries, int currentIndex, int delta) {
        int target = targetIndex(entries, currentIndex, delta);
        return target < 0 ? null : entries.get(target);
    }
}
