package com.nuxtnative.prototype;

import android.content.Context;
import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.content.res.ColorStateList;
import android.net.Uri;
import android.view.View;
import android.view.ViewGroup;
import android.view.MotionEvent;
import android.view.KeyEvent;
import android.text.Editable;
import android.text.TextWatcher;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.HorizontalScrollView;
import android.widget.RadioButton;
import android.widget.SeekBar;
import android.widget.Spinner;
import android.widget.ArrayAdapter;
import android.widget.CompoundButton;
import android.widget.Switch;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.text.InputType;
import android.text.InputFilter;
import android.view.Gravity;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.Collections;
import java.util.List;
import java.util.ArrayList;
import java.util.Map;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import android.util.Base64;
import android.util.Patterns;

/** Renders the compiler's platform-neutral IR into real Android views. */
public final class NativeRenderer {
    public interface ActionDispatcher {
        void dispatch(String action, View source);
        default void dispatch(String action, View source, String eventJson) { dispatch(action, source); }
    }
    public interface StateDispatcher { void update(String name, String value); }
    private final Context context;
    private final ActionDispatcher actions;
    private final StateDispatcher stateUpdates;
    private final ViewGroup portalHost;
    private final FrameLayout portalLayer;
    private final Map<String, Object> state = new HashMap<>();
    private final Map<JSONObject, View> nodeViews = new IdentityHashMap<>();
    private final Map<JSONObject, List<ForItem>> forItems = new IdentityHashMap<>();
    private final Map<JSONObject, String> structuralSelections = new IdentityHashMap<>();
    private final Map<View, DynamicSnapshot> dynamicSnapshots = new IdentityHashMap<>();
    private final Map<ImageView, Integer> imageLoadTokens = new IdentityHashMap<>();
    private JSONObject document;
    private JSONObject dynamicStyleTokens;
    private View root;
    private boolean rendering;
    private boolean renderingRootNode;

    public NativeRenderer(Context context, ActionDispatcher actions) {
        this(context, actions, (name, value) -> { }, null);
    }

    public NativeRenderer(Context context, ActionDispatcher actions, StateDispatcher stateUpdates) {
        this(context, actions, stateUpdates, null);
    }

    public NativeRenderer(Context context, ActionDispatcher actions, StateDispatcher stateUpdates, ViewGroup portalHost) {
        this.context = context;
        this.actions = actions;
        this.stateUpdates = stateUpdates;
        this.portalHost = portalHost;
        this.portalLayer = new FrameLayout(context);
        this.portalLayer.setClipChildren(false);
        this.portalLayer.setClipToPadding(false);
        state.put("saving", false);
        state.put("pending", false);
    }

    public View render(JSONObject document) throws JSONException {
        this.document = document;
        this.dynamicStyleTokens = document.optJSONObject("styleTokens");
        JSONArray nodes = document.getJSONArray("nodes");
        if (nodes.length() != 1) throw new JSONException("A screen must have exactly one root node");
        rendering = true;
        renderingRootNode = true;
        try {
            root = renderNode(nodes.getJSONObject(0));
        } finally {
            rendering = false;
        }
        return root;
    }

    /** Attach the route's Teleport overlay after the route root has been mounted. */
    public void attachPortals() {
        if (portalHost == null || portalLayer.getParent() != null) return;
        portalHost.addView(portalLayer, new ViewGroup.LayoutParams(-1, -1));
    }

    public void seedState(String name, Object value) {
        state.put(name, value);
    }

    public void updateState(String name, String value) {
        setStateValue(name, parseStateValue(value));
        if (root == null || document == null) return;
        try {
            JSONObject rootNode = document.getJSONArray("nodes").getJSONObject(0);
            if (hasForNodes(rootNode) && !hasNonForStructuralNodes(rootNode) && reconcileForNodes(rootNode)) return;
            if (hasStructuralNodes(rootNode)) {
                reconcileStructuralNode(root, rootNode);
                return;
            }
            refreshNode(root, rootNode);
        } catch (JSONException error) { throw new RuntimeException("Unable to refresh native state", error); }
    }

    public void updateSnapshot(String snapshot) {
        if (snapshot == null || snapshot.isEmpty()) return;
        try {
            JSONObject values = new JSONObject(snapshot);
            java.util.Iterator<String> keys = values.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                state.put(key, values.get(key));
            }
            if (root == null || document == null) return;
            JSONObject rootNode = document.getJSONArray("nodes").getJSONObject(0);
            if (!hasStructuralNodes(rootNode)) {
                refreshNode(root, rootNode);
                return;
            }
            if (hasForNodes(rootNode) && !hasNonForStructuralNodes(rootNode) && reconcileForNodes(rootNode)) return;
            reconcileStructuralNode(root, rootNode);
        } catch (JSONException error) { throw new RuntimeException("Unable to apply native state snapshot", error); }
    }

    private View renderNode(JSONObject node) throws JSONException {
        boolean isRootNode = renderingRootNode;
        renderingRootNode = false;
        String type = node.getString("type");
        if ("dynamic-component".equals(type)) return renderDynamicNode(node);
        if ("conditional".equals(type)) return renderConditionalNode(node);
        if ("for".equals(type)) return renderForNode(node);
        if ("client-only".equals(type)) return renderChildren(node.optJSONArray("children"));
        if ("island".equals(type)) return renderIslandNode(node);
        if ("head".equals(type)) return renderHeadNode(node);
        if ("head-title".equals(type) || "head-meta".equals(type) || "head-link".equals(type)) return renderHeadMetadataNode(node);
        if ("route-announcer".equals(type)) return renderRouteAnnouncerNode(node);
        if ("portal".equals(type)) return renderPortalNode(node);
        if ("keep-alive".equals(type)) return renderKeepAliveNode(node);
        if ("transition".equals(type)) return renderTransitionNode(node);
        if ("suspense".equals(type)) return renderSuspenseNode(node);
        if ("error-boundary".equals(type)) return renderErrorBoundaryNode(node);
        if ("select".equals(type)) return renderSelectNode(node);
        JSONObject style = node.optJSONObject("style");
        View view;
        if (type.equals("screen") && isRootNode) {
            ScrollView scroll = new ScrollView(context);
            scroll.setFillViewport(true);
            scroll.setVerticalScrollBarEnabled(true);
            scroll.setScrollbarFadingEnabled(false);
            scroll.setNestedScrollingEnabled(true);
            scroll.setOverScrollMode(View.OVER_SCROLL_ALWAYS);
            scroll.setSmoothScrollingEnabled(true);
            view = scroll;
        }
        else if ((type.equals("container") || type.equals("table") || type.equals("table-section") || type.equals("table-row") || type.equals("table-cell")) && isHorizontalScrollStyle(style)) view = new HorizontalScrollView(context);
        else if ((type.equals("container") || type.equals("table") || type.equals("table-section") || type.equals("table-row") || type.equals("table-cell")) && isVerticalScrollStyle(style)) view = new ScrollView(context);
        else if (type.equals("screen") || type.equals("container") || type.equals("table") || type.equals("table-section") || type.equals("table-row") || type.equals("table-cell")) view = new LinearLayout(context);
        else if (type.equals("form")) view = new FormLayout(context);
        else if (type.equals("list")) view = new ScrollView(context);
        else if (type.equals("text") || type.equals("text-node")) view = new TextView(context);
        else if (type.equals("text-input")) view = new EditText(context);
        else if (type.equals("checkbox")) view = new CheckBox(context);
        else if (type.equals("radio")) view = new RadioButton(context);
        else if (type.equals("switch")) view = new Switch(context);
        else if (type.equals("seekbar")) view = new SeekBar(context);
        else if (type.equals("image")) {
            ImageView image = new ImageView(context);
            image.setAdjustViewBounds(true);
            image.setScaleType(ImageView.ScaleType.FIT_CENTER);
            view = image;
        }
        else if (type.equals("divider")) {
            view = new View(context);
            view.setBackgroundColor(Color.rgb(229, 231, 235));
            view.setMinimumHeight(Math.max(1, Math.round(context.getResources().getDisplayMetrics().density)));
        }
        else if (type.equals("line-break")) view = new TextView(context);
        else if (type.equals("loading-indicator")) {
            view = new ProgressBar(context);
            view.setVisibility(isPending() ? View.VISIBLE : View.GONE);
        }
        else if (type.equals("button") || type.equals("link")) {
            Button button = new Button(context);
            button.setAllCaps(false);
            button.setMinHeight(0);
            button.setMinimumHeight(0);
            view = button;
        }
        else view = new LinearLayout(context);

        if (style != null && "relative".equals(style.optString("position")) && view instanceof LinearLayout && !(view instanceof FormLayout)) {
            view = new FrameLayout(context);
        } else if (style != null && isFlowStyle(style) && view instanceof LinearLayout && !(view instanceof FormLayout)) {
            view = new NativeFlowLayout(context);
        }
        if (view instanceof NativeFlowLayout) configureFlowLayout((NativeFlowLayout) view, style);
        applyStyle(view, style);
        applyVariantStyles(view, node);
        applyVariantLayout(view, node);
        applyDynamicBindings(view, node);
        applyProps(view, node.optJSONObject("props"), node.optString("tag", ""));

        if (view instanceof ScrollView || view instanceof HorizontalScrollView) {
            boolean horizontalScroll = view instanceof HorizontalScrollView;
            if (view instanceof ScrollView) {
                ScrollView scroll = (ScrollView) view;
                scroll.setFillViewport(true);
                scroll.setNestedScrollingEnabled(true);
                scroll.setSmoothScrollingEnabled(true);
            } else {
                HorizontalScrollView scroll = (HorizontalScrollView) view;
                scroll.setFillViewport(true);
                scroll.setNestedScrollingEnabled(true);
                scroll.setSmoothScrollingEnabled(true);
            }
            ViewGroup layout = style != null && "relative".equals(style.optString("position"))
                    ? new FrameLayout(context)
                    : style != null && isFlowStyle(style)
                    ? new NativeFlowLayout(context)
                    : new LinearLayout(context);
            if (layout instanceof NativeFlowLayout) configureFlowLayout((NativeFlowLayout) layout, style);
            if (layout instanceof LinearLayout) ((LinearLayout) layout).setOrientation(horizontalScroll || style != null && "row".equals(style.optString("flexDirection")) ? LinearLayout.HORIZONTAL : LinearLayout.VERTICAL);
            else layout.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            if (layout instanceof LinearLayout) applyLayoutGravity((LinearLayout) layout, style);
            int contentWidth = horizontalScroll ? ViewGroup.LayoutParams.WRAP_CONTENT : ViewGroup.LayoutParams.MATCH_PARENT;
            int contentHeight = horizontalScroll ? ViewGroup.LayoutParams.MATCH_PARENT : ViewGroup.LayoutParams.WRAP_CONTENT;
            if (view instanceof ScrollView) ((ScrollView) view).addView(layout, new ViewGroup.LayoutParams(contentWidth, contentHeight));
            else ((HorizontalScrollView) view).addView(layout, new ViewGroup.LayoutParams(contentWidth, contentHeight));
            JSONObject childParentStyle = style;
            if (horizontalScroll) {
                childParentStyle = style == null ? new JSONObject() : new JSONObject(style.toString());
                childParentStyle.put("flexDirection", "row");
            }
            JSONArray children = node.optJSONArray("children");
            if (children != null) for (int i = 0; i < children.length(); i++) {
                JSONObject childNode = children.getJSONObject(i);
                View child = renderNode(childNode);
                layout.addView(child, layout instanceof FrameLayout
                        ? frameChildParams(childNode.optJSONObject("style"))
                        : childParams(childParentStyle, childNode.optJSONObject("style")));
            }
        } else if (view instanceof FrameLayout) {
            FrameLayout layout = (FrameLayout) view;
            JSONArray children = node.optJSONArray("children");
            if (children != null) for (int i = 0; i < children.length(); i++) {
                JSONObject childNode = children.getJSONObject(i);
                View child = renderNode(childNode);
                layout.addView(child, frameChildParams(childNode.optJSONObject("style")));
            }
        } else if (view instanceof LinearLayout) {
            LinearLayout layout = (LinearLayout) view;
            layout.setOrientation(("table-row".equals(type) || style != null && "row".equals(style.optString("flexDirection"))) ? LinearLayout.HORIZONTAL : LinearLayout.VERTICAL);
            applyLayoutGravity(layout, style);
            JSONArray children = node.optJSONArray("children");
            if (children != null) for (int i = 0; i < children.length(); i++) {
                View child = renderNode(children.getJSONObject(i));
                layout.addView(child, childParams(style, children.getJSONObject(i).optJSONObject("style")));
            }
        } else if (view instanceof NativeFlowLayout) {
            NativeFlowLayout layout = (NativeFlowLayout) view;
            JSONArray children = node.optJSONArray("children");
            if (children != null) for (int i = 0; i < children.length(); i++) {
                View child = renderNode(children.getJSONObject(i));
                layout.addView(child, childParams(style, children.getJSONObject(i).optJSONObject("style")));
            }
        } else if (view instanceof TextView) ((TextView) view).setText(formatText("line-break".equals(type) ? "\n" : textContent(node), style));
        return view;
    }

    private View renderSelectNode(JSONObject node) throws JSONException {
        Spinner spinner = new Spinner(context);
        ArrayList<String> labels = new ArrayList<>();
        ArrayList<String> values = new ArrayList<>();
        JSONArray children = node.optJSONArray("children");
        if (children != null) for (int i = 0; i < children.length(); i++) {
            JSONObject option = children.getJSONObject(i);
            labels.add(textContent(option));
            values.add(option.optJSONObject("props") == null ? labels.get(labels.size() - 1) : option.optJSONObject("props").optString("value", labels.get(labels.size() - 1)));
        }
        ArrayAdapter<String> adapter = new ArrayAdapter<>(context, android.R.layout.simple_spinner_item, labels);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinner.setAdapter(adapter);
        JSONObject props = node.optJSONObject("props");
        String changeAction = eventAction(props, "@change");
        String modelKey = modelPropKey(props);
        if (props != null && (modelKey != null || changeAction != null)) {
            String binding = modelExpression(props);
            spinner.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
                @Override public void onNothingSelected(android.widget.AdapterView<?> parent) { }
                @Override public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
                    if (rendering || position >= values.size()) return;
                    String value = values.get(position);
                    if (!binding.isEmpty()) stateUpdates.update(binding, modelUpdateValue(value, modelKey));
                    if (changeAction != null) actions.dispatch(changeAction, spinner, controlPayload("change", value));
                    spinner.postDelayed(() -> {
                        boolean previousRendering = rendering;
                        rendering = true;
                        try {
                            spinner.setSelection(position, false);
                            updateSpinnerDisplay(spinner, value);
                        }
                        finally { rendering = previousRendering; }
                    }, 80L);
                }
            });
        }
        syncSelectSelection(spinner, node);
        applyProps(spinner, props, "select");
        applyStyle(spinner, node.optJSONObject("style"));
        applyVariantStyles(spinner, node);
        applyDynamicBindings(spinner, node);
        return spinner;
    }

    private View renderSuspenseNode(JSONObject node) throws JSONException {
        String selection = hasPendingState() ? "fallback" : "content";
        if (selection.equals(structuralSelections.get(node)) && nodeViews.containsKey(node)) return nodeViews.get(node);
        structuralSelections.put(node, selection);
        View rendered;
        if ("fallback".equals(selection)) {
            JSONArray fallback = node.optJSONArray("fallback");
            rendered = fallback != null && fallback.length() > 0 ? renderChildren(fallback) : emptyLayout();
        } else {
            rendered = renderChildren(node.optJSONArray("children"));
        }
        nodeViews.put(node, rendered);
        return rendered;
    }

    /**
     * Native apps do not need an SSR island hydration boundary. The packaged
     * island content is already part of the native route asset, so render its
     * default slot directly and retain the fallback slot for empty islands.
     */
    private View renderIslandNode(JSONObject node) throws JSONException {
        JSONArray children = node.optJSONArray("children");
        if (children != null && children.length() > 0) return renderChildren(children);
        JSONArray fallback = node.optJSONArray("fallback");
        return fallback != null && fallback.length() > 0 ? renderChildren(fallback) : emptyLayout();
    }

    private View renderErrorBoundaryNode(JSONObject node) throws JSONException {
        try {
            return renderChildren(node.optJSONArray("children"));
        } catch (Exception error) {
            JSONArray fallback = node.optJSONArray("fallback");
            if (fallback != null && fallback.length() > 0) return renderChildren(fallback);
            TextView message = new TextView(context);
            message.setText(error.getMessage() == null ? "Component failed to render" : error.getMessage());
            return message;
        }
    }

    private View renderKeepAliveNode(JSONObject node) throws JSONException {
        View cached = nodeViews.get(node);
        if (cached != null) return cached;
        View rendered = renderChildren(node.optJSONArray("children"));
        nodeViews.put(node, rendered);
        return rendered;
    }

    private View renderRouteAnnouncerNode(JSONObject node) throws JSONException {
        TextView announcer = new TextView(context);
        String path = String.valueOf(state.getOrDefault("__nuxtRoutePath", "/"));
        announcer.setText("Navigated to " + path);
        announcer.setContentDescription("Navigated to " + path);
        announcer.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        announcer.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
        applyStyle(announcer, node.optJSONObject("style"));
        return announcer;
    }

    private View renderHeadNode(JSONObject node) throws JSONException {
        JSONArray children = node.optJSONArray("children");
        if (children != null) for (int i = 0; i < children.length(); i++) applyHeadNode(children.getJSONObject(i));
        return emptyLayout();
    }

    private View renderHeadMetadataNode(JSONObject node) throws JSONException {
        applyHeadNode(node);
        return emptyLayout();
    }

    private void applyHeadNode(JSONObject node) throws JSONException {
        String type = node.optString("type", "");
        if ("head".equals(type)) {
            JSONArray children = node.optJSONArray("children");
            if (children != null) for (int i = 0; i < children.length(); i++) applyHeadNode(children.getJSONObject(i));
            return;
        }
        if ("head-title".equals(type) && context instanceof Activity) {
            ((Activity) context).setTitle(textContent(node));
        }
    }

    private View renderPortalNode(JSONObject node) throws JSONException {
        JSONObject props = node.optJSONObject("props");
        boolean disabled = props != null && isTrue(String.valueOf(props.opt("disabled")));
        if (disabled || portalHost == null) return renderChildren(node.optJSONArray("children"));
        View content = renderChildren(node.optJSONArray("children"));
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(-1, -1);
        portalLayer.addView(content, params);
        return emptyLayout();
    }

    private View renderTransitionNode(JSONObject node) throws JSONException {
        View rendered = renderChildren(node.optJSONArray("children"));
        nodeViews.put(node, rendered);
        JSONObject props = node.optJSONObject("props");
        String name = props == null ? "fade" : props.optString("name", "fade");
        long duration = transitionDuration(props);
        String easing = props == null ? "standard" : props.optString("easing", "standard");
        if (props != null && props.has("@before-enter")) actions.dispatch(props.getString("@before-enter"), rendered);
        animate(rendered, "slide".equals(name) ? "slide-up" : "scale".equals(name) ? "scale-in" : "fade-in", duration, easing,
            props == null ? "" : props.optString("@after-enter", ""));
        return rendered;
    }

    private boolean hasPendingState() {
        for (Map.Entry<String, Object> entry : state.entrySet()) {
            if (entry.getKey().toLowerCase(java.util.Locale.ROOT).contains("pending") && Boolean.TRUE.equals(entry.getValue())) return true;
        }
        return false;
    }

    private View renderDynamicNode(JSONObject node) throws JSONException {
        String selected = evaluateDynamicSelector(node.optJSONObject("props"));
        if (selected.equals(structuralSelections.get(node)) && nodeViews.containsKey(node)) return nodeViews.get(node);
        structuralSelections.put(node, selected);
        JSONArray variants = node.optJSONArray("variants");
        JSONArray selectedNodes = null;
        if (variants != null) for (int i = 0; i < variants.length(); i++) {
            JSONObject variant = variants.getJSONObject(i);
            if (selected.equals(variant.optString("name"))) {
                selectedNodes = variant.optJSONArray("nodes");
                break;
            }
        }

        if (selectedNodes == null || selectedNodes.length() == 0) {
            LinearLayout empty = new LinearLayout(context);
            empty.setOrientation(LinearLayout.VERTICAL);
            applyStyle(empty, node.optJSONObject("style"));
            nodeViews.put(node, empty);
            return empty;
        }
        if (selectedNodes.length() == 1) {
            View rendered = renderNode(selectedNodes.getJSONObject(0));
            nodeViews.put(node, rendered);
            return rendered;
        }

        LinearLayout wrapper = new LinearLayout(context);
        wrapper.setOrientation(LinearLayout.VERTICAL);
        applyStyle(wrapper, node.optJSONObject("style"));
        for (int i = 0; i < selectedNodes.length(); i++) {
            JSONObject child = selectedNodes.getJSONObject(i);
            View view = renderNode(child);
            wrapper.addView(view, childParams(node.optJSONObject("style"), child.optJSONObject("style")));
        }
        nodeViews.put(node, wrapper);
        return wrapper;
    }

    private View renderConditionalNode(JSONObject node) throws JSONException {
        String selection = selectedConditionalKey(node);
        if (selection.equals(structuralSelections.get(node)) && nodeViews.containsKey(node)) return nodeViews.get(node);
        structuralSelections.put(node, selection);
        JSONArray branches = node.optJSONArray("branches");
        View rendered = emptyLayout();
        if (branches != null) for (int i = 0; i < branches.length(); i++) {
            JSONObject branch = branches.getJSONObject(i);
            if (String.valueOf(i).equals(selection)) {
                rendered = renderChildren(branch.optJSONArray("children"));
                break;
            }
        }
        nodeViews.put(node, rendered);
        return rendered;
    }

    private String selectedConditionalKey(JSONObject node) throws JSONException {
        JSONArray branches = node.optJSONArray("branches");
        if (branches == null) return "-1";
        for (int i = 0; i < branches.length(); i++) {
            JSONObject branch = branches.getJSONObject(i);
            String condition = branch.optString("condition", "");
            if (condition.isEmpty() || evaluateBoolean(condition)) return String.valueOf(i);
        }
        return "-1";
    }

    private boolean reconcileStructuralNode(View current, JSONObject node) throws JSONException {
        current = childContainer(current);
        String type = node.optString("type", "");
        if ("for".equals(type)) {
            reconcileForNode(node);
            return true;
        }
        if ("conditional".equals(type) || "dynamic-component".equals(type) || "suspense".equals(type) || "keep-alive".equals(type) || "transition".equals(type)) {
            View previous = nodeViews.get(node);
            View next = renderNode(node);
            if (previous != null && previous != next) replaceSubtree(previous, next, node);
            if (next != null) refreshActiveStructuralChildren(next, activeStructuralChildren(node));
            return true;
        }
        boolean found = false;
        JSONArray children = node.optJSONArray("children");
        if (children != null && current instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) current;
            for (int i = 0; i < children.length() && i < group.getChildCount(); i++) {
                JSONObject child = children.getJSONObject(i);
                if (hasStructuralNodes(child)) {
                    reconcileStructuralNode(group.getChildAt(i), child);
                    found = true;
                } else {
                    refreshNode(group.getChildAt(i), child);
                }
            }
        }
        return found;
    }

    private JSONArray activeStructuralChildren(JSONObject node) throws JSONException {
        String type = node.optString("type", "");
        if ("conditional".equals(type)) {
            JSONArray branches = node.optJSONArray("branches");
            int index = Integer.parseInt(structuralSelections.getOrDefault(node, "-1"));
            return index >= 0 && branches != null && index < branches.length() ? branches.getJSONObject(index).optJSONArray("children") : new JSONArray();
        }
        if ("dynamic-component".equals(type)) {
            String selected = structuralSelections.getOrDefault(node, "");
            JSONArray variants = node.optJSONArray("variants");
            if (variants != null) for (int i = 0; i < variants.length(); i++) if (selected.equals(variants.getJSONObject(i).optString("name"))) return variants.getJSONObject(i).optJSONArray("nodes");
        }
        if ("suspense".equals(type) && "fallback".equals(structuralSelections.get(node))) return node.optJSONArray("fallback");
        return node.optJSONArray("children");
    }

    private void refreshActiveStructuralChildren(View rendered, JSONArray children) throws JSONException {
        if (children == null || children.length() == 0) return;
        if (children.length() == 1) {
            JSONObject child = children.getJSONObject(0);
            if (hasStructuralNodes(child)) reconcileStructuralNode(rendered, child);
            else refreshNode(rendered, child);
            return;
        }
        if (!(rendered instanceof ViewGroup)) return;
        ViewGroup group = (ViewGroup) rendered;
        for (int i = 0; i < children.length() && i < group.getChildCount(); i++) {
            JSONObject child = children.getJSONObject(i);
            if (hasStructuralNodes(child)) reconcileStructuralNode(group.getChildAt(i), child);
            else refreshNode(group.getChildAt(i), child);
        }
    }

    private void replaceSubtree(View previous, View next, JSONObject node) {
        ViewGroup parent = (ViewGroup) previous.getParent();
        if (parent == null) return;
        int index = parent.indexOfChild(previous);
        ViewGroup.LayoutParams params = previous.getLayoutParams();
        parent.removeViewAt(index);
        parent.addView(next, index, params);
        nodeViews.put(node, next);
    }

    private View renderForNode(JSONObject node) throws JSONException {
        LinearLayout wrapper = new LinearLayout(context);
        wrapper.setOrientation(LinearLayout.VERTICAL);
        nodeViews.put(node, wrapper);
        List<ForItem> rendered = new java.util.ArrayList<>();
        forItems.put(node, rendered);
        Object source = evaluateValue(node.optString("source", ""));
        JSONArray items = source instanceof JSONArray ? (JSONArray) source : null;
        if (items == null && source instanceof JSONObject) {
            JSONObject object = (JSONObject) source;
            items = new JSONArray();
            List<String> keys = new ArrayList<>();
            java.util.Iterator<String> iterator = object.keys();
            while (iterator.hasNext()) keys.add(iterator.next());
            Collections.sort(keys);
            for (String key : keys) {
                items.put(new JSONObject().put("key", key).put("value", object.get(key)));
            }
        }
        JSONArray children = node.optJSONArray("children");
        if (items == null || children == null) return wrapper;
        boolean objectSource = source instanceof JSONObject;
        for (int i = 0; i < items.length(); i++) {
            String valueName = node.optString("value", "item");
            String keyName = node.optString("key", "");
            String indexName = node.optString("index", "");
            Object entry = items.get(i);
            Object itemValue = objectSource && entry instanceof JSONObject ? ((JSONObject) entry).opt("value") : entry;
            Object itemKeyValue = objectSource && entry instanceof JSONObject ? ((JSONObject) entry).opt("key") : i;
            Object previousValue = state.put(valueName, itemValue);
            Object previousKey = keyName.isEmpty() ? null : state.put(keyName, itemKeyValue);
            Object previousIndex = indexName.isEmpty() ? null : state.put(indexName, i);
            Object itemKey = node.has("track") ? evaluateValue(node.optString("track", "")) : i;
            ForItem item = createForItem(itemKey, children);
            wrapper.addView(item.view, childParams(null, null));
            rendered.add(item);
            restoreState(valueName, previousValue);
            if (!keyName.isEmpty()) restoreState(keyName, previousKey);
            if (!indexName.isEmpty()) restoreState(indexName, previousIndex);
        }
        return wrapper;
    }

    private boolean reconcileForNodes(JSONObject node) throws JSONException {
        boolean found = false;
        if ("for".equals(node.optString("type"))) {
            reconcileForNode(node);
            found = true;
        }
        JSONArray children = node.optJSONArray("children");
        if (children != null) for (int i = 0; i < children.length(); i++) if (reconcileForNodes(children.getJSONObject(i))) found = true;
        return found;
    }

    private void reconcileForNode(JSONObject node) throws JSONException {
        View rawWrapper = nodeViews.get(node);
        if (!(rawWrapper instanceof ViewGroup)) return;
        ViewGroup wrapper = (ViewGroup) rawWrapper;
        Object source = evaluateValue(node.optString("source", ""));
        JSONArray items = source instanceof JSONArray ? (JSONArray) source : null;
        JSONArray children = node.optJSONArray("children");
        if (items == null || children == null) {
            wrapper.removeAllViews();
            forItems.put(node, new java.util.ArrayList<>());
            return;
        }
        boolean objectSource = source instanceof JSONObject;
        Map<String, ForItem> previous = new LinkedHashMap<>();
        List<ForItem> existing = forItems.get(node);
        if (existing != null) for (ForItem item : existing) previous.put(String.valueOf(item.key), item);
        List<ForItem> next = new java.util.ArrayList<>();
        String valueName = node.optString("value", "item");
        String keyName = node.optString("key", "");
        String indexName = node.optString("index", "");
        for (int i = 0; i < items.length(); i++) {
            Object entry = items.get(i);
            Object itemValue = objectSource && entry instanceof JSONObject ? ((JSONObject) entry).opt("value") : entry;
            Object itemKeyValue = objectSource && entry instanceof JSONObject ? ((JSONObject) entry).opt("key") : i;
            Object previousValue = state.put(valueName, itemValue);
            Object previousKey = keyName.isEmpty() ? null : state.put(keyName, itemKeyValue);
            Object previousIndex = indexName.isEmpty() ? null : state.put(indexName, i);
            Object itemKey = node.has("track") ? evaluateValue(node.optString("track", "")) : i;
            ForItem item = previous.remove(String.valueOf(itemKey));
            if (item == null) {
                item = createForItem(itemKey, children);
            } else {
                refreshForItem(item);
                item.key = itemKey;
            }
            next.add(item);
            restoreState(valueName, previousValue);
            if (!keyName.isEmpty()) restoreState(keyName, previousKey);
            if (!indexName.isEmpty()) restoreState(indexName, previousIndex);
        }
        wrapper.removeAllViews();
        for (ForItem item : next) wrapper.addView(item.view, childParams(null, null));
        forItems.put(node, next);
    }

    private ForItem createForItem(Object itemKey, JSONArray children) throws JSONException {
        LinearLayout itemContainer = new LinearLayout(context);
        itemContainer.setOrientation(LinearLayout.VERTICAL);
        List<JSONObject> itemNodes = new ArrayList<>();
        for (int j = 0; j < children.length(); j++) {
            JSONObject child = new JSONObject(children.getJSONObject(j).toString());
            itemNodes.add(child);
            View view = renderNode(child);
            itemContainer.addView(view, childParams(null, child.optJSONObject("style")));
        }
        return new ForItem(itemKey, itemContainer, itemNodes);
    }

    private void refreshForItem(ForItem item) throws JSONException {
        if (!(item.view instanceof ViewGroup)) return;
        ViewGroup group = (ViewGroup) item.view;
        for (int i = 0; i < item.nodes.size() && i < group.getChildCount(); i++) {
            JSONObject child = item.nodes.get(i);
            if (hasStructuralNodes(child)) reconcileStructuralNode(group.getChildAt(i), child);
            else refreshNode(group.getChildAt(i), child);
        }
    }

    private boolean hasForNodes(JSONObject node) throws JSONException {
        if ("for".equals(node.optString("type"))) return true;
        JSONArray children = node.optJSONArray("children");
        if (children != null) for (int i = 0; i < children.length(); i++) if (hasForNodes(children.getJSONObject(i))) return true;
        return false;
    }

    private boolean hasNonForStructuralNodes(JSONObject node) throws JSONException {
        String type = node.optString("type");
        if ("dynamic-component".equals(type) || "conditional".equals(type) || "suspense".equals(type) || "error-boundary".equals(type) || "keep-alive".equals(type)) return true;
        JSONArray children = node.optJSONArray("children");
        if (children != null) for (int i = 0; i < children.length(); i++) if (hasNonForStructuralNodes(children.getJSONObject(i))) return true;
        return false;
    }

    private static final class ForItem {
        Object key;
        final View view;
        final List<JSONObject> nodes;
        ForItem(Object key, View view, List<JSONObject> nodes) { this.key = key; this.view = view; this.nodes = nodes; }
    }

    private View renderChildren(JSONArray children) throws JSONException {
        if (children == null || children.length() == 0) return emptyLayout();
        if (children.length() == 1) return renderNode(children.getJSONObject(0));
        LinearLayout wrapper = new LinearLayout(context);
        wrapper.setOrientation(LinearLayout.VERTICAL);
        for (int i = 0; i < children.length(); i++) {
            JSONObject child = children.getJSONObject(i);
            View view = renderNode(child);
            wrapper.addView(view, childParams(null, child.optJSONObject("style")));
        }
        return wrapper;
    }

    private LinearLayout emptyLayout() {
        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        return layout;
    }

    private void restoreState(String name, Object previous) {
        if (previous == null) state.remove(name); else state.put(name, previous);
    }

    private String evaluateDynamicSelector(JSONObject props) throws JSONException {
        if (props == null) return "";
        Object selector = props.has(":is") ? props.get(":is") : props.opt("is");
        if (selector == null) return "";
        String expression = String.valueOf(selector).trim();
        if ((expression.startsWith("'") && expression.endsWith("'")) || (expression.startsWith("\"") && expression.endsWith("\""))) {
            return expression.substring(1, expression.length() - 1);
        }
        Object value = state.get(expression);
        return value == null ? expression : String.valueOf(value);
    }

    private boolean hasStructuralNodes(JSONObject node) throws JSONException {
        if ("dynamic-component".equals(node.optString("type")) || "conditional".equals(node.optString("type")) || "for".equals(node.optString("type")) || "suspense".equals(node.optString("type")) || "error-boundary".equals(node.optString("type")) || "keep-alive".equals(node.optString("type"))) return true;
        JSONArray children = node.optJSONArray("children");
        if (children != null) for (int i = 0; i < children.length(); i++) {
            if (hasStructuralNodes(children.getJSONObject(i))) return true;
        }
        JSONArray branches = node.optJSONArray("branches");
        if (branches != null) for (int i = 0; i < branches.length(); i++) {
            JSONArray branchChildren = branches.getJSONObject(i).optJSONArray("children");
            if (branchChildren != null) for (int j = 0; j < branchChildren.length(); j++) {
                if (hasStructuralNodes(branchChildren.getJSONObject(j))) return true;
            }
        }
        JSONArray fallback = node.optJSONArray("fallback");
        if (fallback != null) for (int i = 0; i < fallback.length(); i++) if (hasStructuralNodes(fallback.getJSONObject(i))) return true;
        JSONArray variants = node.optJSONArray("variants");
        if (variants != null) for (int i = 0; i < variants.length(); i++) {
            JSONArray nodes = variants.getJSONObject(i).optJSONArray("nodes");
            if (nodes != null) for (int j = 0; j < nodes.length(); j++) {
                if (hasStructuralNodes(nodes.getJSONObject(j))) return true;
            }
        }
        return false;
    }

    private String textContent(JSONObject node) throws JSONException {
        if (node.getString("type").equals("text-node")) {
            Object content = node.opt("content");
            if (content instanceof JSONObject) return evaluate(((JSONObject) content).optString("expression", ""));
            return String.valueOf(content == null ? "" : content);
        }
        JSONArray children = node.optJSONArray("children");
        StringBuilder text = new StringBuilder();
        if (children != null) for (int i = 0; i < children.length(); i++) text.append(textContent(children.getJSONObject(i)));
        return text.toString();
    }

    private String evaluate(String source) {
        String expression = source.trim();
        int logicalOr = topLevelToken(expression, "||", 0);
        if (logicalOr >= 0) {
            Object left = evaluateValue(expression.substring(0, logicalOr));
            return isTruthy(left)
                    ? String.valueOf(left)
                    : evaluate(expression.substring(logicalOr + 2));
        }
        int nullish = topLevelToken(expression, "??", 0);
        if (nullish >= 0) {
            Object left = evaluateValue(expression.substring(0, nullish));
            return left == null || left == JSONObject.NULL
                    ? evaluate(expression.substring(nullish + 2))
                    : String.valueOf(left);
        }
        int question = topLevelOperator(expression, '?', 0);
        if (question >= 0) {
            int colon = matchingTernaryColon(expression, question + 1);
            if (colon > question) {
                return evaluate(evaluateBoolean(expression.substring(0, question))
                        ? expression.substring(question + 1, colon)
                        : expression.substring(colon + 1));
            }
        }
        Object value = evaluateValue(expression);
        return value == null ? expression : String.valueOf(value);
    }

    private boolean isTruthy(Object value) {
        if (value == null || value == JSONObject.NULL) return false;
        if (value instanceof Boolean) return (Boolean) value;
        if (value instanceof Number) return ((Number) value).doubleValue() != 0;
        return !String.valueOf(value).isEmpty();
    }

    private String normalizeRouteLocation(Object value) {
        if (value == null || value == JSONObject.NULL) return "/";
        if (value instanceof JSONObject) {
            try {
                JSONObject location = (JSONObject) value;
                String target = location.optString("path", "/");
                JSONObject query = location.optJSONObject("query");
                List<String> pairs = new ArrayList<>();
                if (query != null) {
                    java.util.Iterator<String> keys = query.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        Object queryValue = query.get(key);
                        if (queryValue == JSONObject.NULL) {
                            pairs.add(encodeRoutePart(key));
                        } else if (queryValue instanceof JSONArray) {
                            JSONArray values = (JSONArray) queryValue;
                            for (int index = 0; index < values.length(); index++) {
                                Object item = values.get(index);
                                pairs.add(encodeRoutePart(key) + "=" + encodeRoutePart(item == JSONObject.NULL ? "" : String.valueOf(item)));
                            }
                        } else {
                            pairs.add(encodeRoutePart(key) + "=" + encodeRoutePart(String.valueOf(queryValue)));
                        }
                    }
                }
                if (!pairs.isEmpty()) target += "?" + String.join("&", pairs);
                String hash = location.optString("hash", "");
                if (!hash.isEmpty()) target += hash.startsWith("#") ? hash : "#" + hash;
                return target;
            } catch (JSONException ignored) { return "/"; }
        }
        return String.valueOf(value);
    }

    private String encodeRoutePart(String value) {
        try { return java.net.URLEncoder.encode(value, "UTF-8").replace("+", "%20"); }
        catch (Exception ignored) { return value; }
    }

    /** Find a conditional operator outside strings and nested expressions. */
    private int topLevelOperator(String expression, char operator, int start) {
        char quote = 0;
        int depth = 0;
        for (int i = start; i < expression.length(); i++) {
            char current = expression.charAt(i);
            if (quote != 0) {
                if (current == quote && (i == 0 || expression.charAt(i - 1) != '\\')) quote = 0;
                continue;
            }
            if (current == '\'' || current == '\"') { quote = current; continue; }
            if (current == '(' || current == '[' || current == '{') { depth++; continue; }
            if (current == ')' || current == ']' || current == '}') { depth = Math.max(0, depth - 1); continue; }
            if (depth == 0 && current == operator) return i;
        }
        return -1;
    }

    private int topLevelToken(String expression, String token, int start) {
        char quote = 0;
        int depth = 0;
        for (int i = start; i <= expression.length() - token.length(); i++) {
            char current = expression.charAt(i);
            if (quote != 0) {
                if (current == quote && (i == 0 || expression.charAt(i - 1) != '\\')) quote = 0;
                continue;
            }
            if (current == '\'' || current == '"') { quote = current; continue; }
            if (current == '(' || current == '[' || current == '{') { depth++; continue; }
            if (current == ')' || current == ']' || current == '}') { depth = Math.max(0, depth - 1); continue; }
            if (depth == 0 && expression.startsWith(token, i)) return i;
        }
        return -1;
    }

    private int matchingTernaryColon(String expression, int start) {
        int nested = 0;
        for (int i = start; i < expression.length(); i++) {
            int question = topLevelOperator(expression, '?', i);
            int colon = topLevelOperator(expression, ':', i);
            if (question < 0 && colon < 0) return -1;
            if (question >= 0 && (colon < 0 || question < colon)) {
                nested++;
                i = question;
            } else {
                if (nested == 0) return colon;
                nested--;
                i = colon;
            }
        }
        return -1;
    }

    private boolean evaluateBoolean(String source) {
        String expression = source.trim();
        if (expression.startsWith("!")) return !evaluateBoolean(expression.substring(1));
        if (expression.contains("&&")) {
            for (String part : expression.split("&&")) if (!evaluateBoolean(part)) return false;
            return true;
        }
        if (expression.contains("||")) {
            for (String part : expression.split("\\|\\|")) if (evaluateBoolean(part)) return true;
            return false;
        }
        java.util.regex.Matcher comparison = java.util.regex.Pattern.compile("(.+?)\\s*(===|==|!==|!=)\\s*(.+)").matcher(expression);
        if (comparison.matches()) {
            Object left = evaluateValue(comparison.group(1));
            Object right = evaluateValue(comparison.group(3));
            boolean equal = String.valueOf(left).equals(String.valueOf(right));
            return comparison.group(2).contains("!") ? !equal : equal;
        }
        Object value = evaluateValue(expression);
        if (value instanceof Boolean) return (Boolean) value;
        if (value == null || value == JSONObject.NULL) return false;
        if (value instanceof JSONObject || value instanceof JSONArray) return true;
        if (value instanceof Number) return ((Number) value).doubleValue() != 0;
        return !String.valueOf(value).isEmpty();
    }

    private Object evaluateValue(String source) {
        String expression = source.trim();
        if ((expression.startsWith("'") && expression.endsWith("'")) || (expression.startsWith("\"") && expression.endsWith("\""))) return expression.substring(1, expression.length() - 1);
        Object value = state.get(expression);
        if (value != null) return value;
        if (expression.matches("-?\\d+(\\.\\d+)?")) try { return Double.parseDouble(expression); } catch (NumberFormatException ignored) { }
        String propertyPath = expression.replace("?.", ".");
        String[] segments = propertyPath.split("\\.");
        if (segments.length > 1 && !segments[0].isEmpty()) {
            Object current = state.get(segments[0]);
            for (int i = 1; i < segments.length; i++) {
                if (current == null || current == JSONObject.NULL) return null;
                String property = segments[i];
                if (current instanceof JSONObject) current = ((JSONObject) current).opt(property);
                else if (current instanceof Map) current = ((Map<?, ?>) current).get(property);
                else return null;
            }
            return current;
        }
        return value;
    }

    private Object parseStateValue(String value) {
        if (value == null) return null;
        if ("true".equals(value)) return Boolean.TRUE;
        if ("false".equals(value)) return Boolean.FALSE;
        try {
            Object parsed = new JSONTokener(value).nextValue();
            if (parsed instanceof JSONObject || parsed instanceof JSONArray || parsed instanceof Number) return parsed;
        } catch (JSONException ignored) { }
        return value;
    }

    private void refreshNode(View view, JSONObject node) throws JSONException {
        String nodeType = node.getString("type");
        if ("head".equals(nodeType) || "head-title".equals(nodeType) || "head-meta".equals(nodeType) || "head-link".equals(nodeType)) {
            applyHeadNode(node);
            return;
        }
        view = childContainer(view);
        if (view instanceof TextView && !"text-input".equals(nodeType)) {
            String nextText = formatText(textContent(node), node.optJSONObject("style"));
            if (!nextText.equals(((TextView) view).getText().toString())) ((TextView) view).setText(nextText);
        }
        if (view instanceof ProgressBar && "loading-indicator".equals(node.getString("type"))) {
            view.setVisibility(isPending() ? View.VISIBLE : View.GONE);
        }
        applyDynamicBindings(view, node);
        JSONObject props = node.optJSONObject("props");
        applyAccessibility(view, props, node.optString("tag", ""));
        if (view instanceof ImageView && props != null && props.has(":src")) loadImage((ImageView) view, evaluate(props.getString(":src")));
        if (props != null && props.has(":disabled")) view.setEnabled(!evaluateBoolean(props.getString(":disabled")));
        if (props != null && props.has("v-show")) view.setVisibility(evaluateBoolean(props.getString("v-show")) ? View.VISIBLE : View.GONE);
        if (props != null && props.has(":hidden")) view.setVisibility(evaluateBoolean(props.getString(":hidden")) ? View.GONE : View.VISIBLE);
        if (view instanceof CompoundButton && props != null && props.has(":checked")) ((CompoundButton) view).setChecked(evaluateBoolean(props.getString(":checked")));
        if (view instanceof Spinner && "select".equals(node.optString("tag", ""))) syncSelectSelection((Spinner) view, node);
        if (view instanceof CompoundButton && props != null && modelPropKey(props) != null) syncCompoundButtonState((CompoundButton) view, props);
        if (view instanceof SeekBar && props != null) syncSeekBarState((SeekBar) view, props);
        if (view instanceof EditText && props != null && modelPropKey(props) != null) {
            String binding = modelExpression(props);
            Object current = stateValue(binding);
            if (current != null && !String.valueOf(current).equals(((EditText) view).getText().toString())) {
                rendering = true;
                ((EditText) view).setText(String.valueOf(current));
                rendering = false;
            }
        }
        JSONArray children = node.optJSONArray("children");
        if (children != null && view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < children.length() && i < group.getChildCount(); i++) refreshNode(group.getChildAt(i), children.getJSONObject(i));
        }
    }

    private View childContainer(View view) {
        if (view instanceof ScrollView && ((ScrollView) view).getChildCount() > 0) return ((ScrollView) view).getChildAt(0);
        if (view instanceof HorizontalScrollView && ((HorizontalScrollView) view).getChildCount() > 0) return ((HorizontalScrollView) view).getChildAt(0);
        return view;
    }

    private void syncSelectSelection(Spinner spinner, JSONObject node) throws JSONException {
        JSONObject props = node.optJSONObject("props");
        String modelKey = modelPropKey(props);
        if (modelKey == null) return;
        Object current = stateValue(modelExpression(props));
        if (current == null) return;
        String selected = String.valueOf(current);
        JSONArray children = node.optJSONArray("children");
        if (children == null) return;
        int target = -1;
        for (int i = 0; i < children.length(); i++) {
            JSONObject option = children.getJSONObject(i);
            JSONObject optionProps = option.optJSONObject("props");
            String value = optionProps == null ? textContent(option) : optionProps.optString("value", textContent(option));
            if (selected.equals(value)) {
                target = i;
                break;
            }
        }
        if (target >= 0) {
            final int resolvedTarget = target;
            Runnable updateSelection = () -> {
                boolean previousRendering = rendering;
                rendering = true;
                try {
                    if (spinner.getSelectedItemPosition() != resolvedTarget) spinner.setSelection(resolvedTarget, false);
                    updateSpinnerDisplay(spinner, selected);
                }
                finally { rendering = previousRendering; }
            };
            if (spinner.isAttachedToWindow()) spinner.post(updateSelection);
            else updateSelection.run();
        }
    }

    private void updateSpinnerDisplay(Spinner spinner, String value) {
        View selectedView = spinner.getSelectedView();
        if (selectedView instanceof TextView) ((TextView) selectedView).setText(value);
    }

    private String modelPropKey(JSONObject props) {
        if (props == null) return null;
        if (props.has("v-model")) return "v-model";
        java.util.Iterator<String> keys = props.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (key.startsWith("v-model.")) return key;
        }
        return null;
    }

    private String modelExpression(JSONObject props) {
        String key = modelPropKey(props);
        return key == null ? "" : props.optString(key, "");
    }

    private Object stateValue(String expression) {
        if (expression == null || expression.isEmpty()) return null;
        Object direct = state.get(expression);
        if (direct != null) return direct;
        if (!expression.matches("[A-Za-z_$][A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*|\\[[0-9]+\\])*") ) return null;
        String[] parts = expression.replaceAll("\\[([0-9]+)\\]", ".\\$1").split("\\.");
        Object current = state.get(parts[0]);
        for (int i = 1; i < parts.length && current != null; i++) {
            if (current instanceof JSONObject) current = ((JSONObject) current).opt(parts[i]);
            else if (current instanceof JSONArray) {
                try { current = ((JSONArray) current).opt(Integer.parseInt(parts[i])); }
                catch (NumberFormatException ignored) { return null; }
            } else return null;
        }
        return current;
    }

    private void setStateValue(String expression, Object value) {
        if (expression == null || expression.isEmpty()) return;
        if (!expression.matches("[A-Za-z_$][A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*|\\[[0-9]+\\])*") ) return;
        String[] parts = expression.replaceAll("\\[([0-9]+)\\]", ".\\$1").split("\\.");
        if (parts.length == 1) { state.put(expression, value); return; }
        Object current = state.get(parts[0]);
        if (current == null) { state.put(expression, value); return; }
        for (int i = 1; i < parts.length - 1; i++) {
            if (current instanceof JSONObject) current = ((JSONObject) current).opt(parts[i]);
            else if (current instanceof JSONArray) {
                try { current = ((JSONArray) current).opt(Integer.parseInt(parts[i])); }
                catch (NumberFormatException ignored) { return; }
            } else return;
        }
        String leaf = parts[parts.length - 1];
        if (current instanceof JSONObject) {
            try { ((JSONObject) current).put(leaf, value); }
            catch (JSONException ignored) { }
        }
        else if (current instanceof JSONArray) {
            try { ((JSONArray) current).put(Integer.parseInt(leaf), value); }
            catch (Exception ignored) { }
        }
    }

    private String modelValue(String value, String modelKey) {
        String normalized = value == null ? "" : value;
        if (modelKey != null && modelKey.contains(".trim")) normalized = normalized.trim();
        if (modelKey != null && modelKey.contains(".number")) {
            try {
                double number = Double.parseDouble(normalized.trim());
                if (number == Math.rint(number)) return String.valueOf((long) number);
                return String.valueOf(number);
            } catch (NumberFormatException ignored) { }
        }
        return normalized;
    }

    private String modelUpdateValue(String value, String modelKey) {
        String normalized = modelValue(value, modelKey);
        if (modelKey != null && modelKey.contains(".number") && normalized.matches("-?\\d+(?:\\.\\d+)?")) return "__nuxt_native_number__:" + normalized;
        return normalized;
    }

    private void syncCompoundButtonState(CompoundButton button, JSONObject props) throws JSONException {
        String modelKey = modelPropKey(props);
        Object current = stateValue(modelExpression(props));
        if (current == null) return;
        boolean checked;
        if (isCheckbox(props) && current instanceof JSONArray) checked = arrayContains((JSONArray) current, controlValue(props));
        else if (isRadio(props)) checked = modelValueMatches(current, controlValue(props), modelKey);
        else checked = current instanceof Boolean ? (Boolean) current : isTrue(String.valueOf(current));
        if (button.isChecked() == checked) return;
        boolean previousRendering = rendering;
        rendering = true;
        try { button.setChecked(checked); }
        finally { rendering = previousRendering; }
    }

    private void syncSeekBarState(SeekBar seekBar, JSONObject props) throws JSONException {
        String modelKey = modelPropKey(props);
        if (modelKey == null) return;
        Object current = stateValue(modelExpression(props));
        if (current == null) return;
        int min = integerProp(props, "min", 0);
        int step = Math.max(1, integerProp(props, "step", 1));
        int target = progressForValue(String.valueOf(current), min, step, seekBar.getMax());
        if (seekBar.getProgress() == target) return;
        boolean previousRendering = rendering;
        rendering = true;
        try { seekBar.setProgress(target); }
        finally { rendering = previousRendering; }
    }

    private int progressForValue(String value, int min, int step, int maxProgress) {
        try {
            int numeric = (int) Math.round(Double.parseDouble(value));
            return Math.max(0, Math.min(maxProgress, Math.round((numeric - min) / (float) step)));
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private int integerProp(JSONObject props, String name, int fallback) {
        try { return props.has(name) ? (int) Math.round(props.getDouble(name)) : fallback; }
        catch (Exception ignored) { return fallback; }
    }

    private boolean isCheckbox(JSONObject props) { return props != null && "checkbox".equalsIgnoreCase(props.optString("type", "")); }
    private boolean isRadio(JSONObject props) { return props != null && "radio".equalsIgnoreCase(props.optString("type", "")); }
    private String controlValue(JSONObject props) { return props == null ? "on" : props.optString("value", "on"); }
    private boolean arrayContains(JSONArray values, String target) {
        for (int i = 0; i < values.length(); i++) if (target.equals(String.valueOf(values.opt(i)))) return true;
        return false;
    }
    private boolean modelValueMatches(Object current, String value, String modelKey) {
        if (modelKey != null && modelKey.contains(".number")) return modelValue(String.valueOf(current), modelKey).equals(modelValue(value, modelKey));
        return String.valueOf(current).equals(value);
    }
    private String checkboxModelValue(Object current, String value, boolean checked) {
        if (!(current instanceof JSONArray)) return String.valueOf(checked);
        JSONArray next = new JSONArray();
        JSONArray values = (JSONArray) current;
        for (int i = 0; i < values.length(); i++) {
            Object item = values.opt(i);
            if (!value.equals(String.valueOf(item))) next.put(item);
        }
        if (checked) next.put(value);
        return next.toString();
    }

    private boolean isPending() {
        return Boolean.TRUE.equals(state.get("pending")) || Boolean.TRUE.equals(state.get("__nuxtNavigationPending"));
    }

    private void applyLayoutGravity(LinearLayout layout, JSONObject style) {
        if (style == null) return;
        int gravity = 0;
        boolean row = layout.getOrientation() == LinearLayout.HORIZONTAL;
        String align = style.optString("alignItems", "");
        if (row) {
            if ("center".equals(align)) gravity |= Gravity.CENTER_VERTICAL;
            else if ("end".equals(align)) gravity |= Gravity.BOTTOM;
        } else {
            if ("center".equals(align)) gravity |= Gravity.CENTER_HORIZONTAL;
            else if ("end".equals(align)) gravity |= Gravity.RIGHT;
        }
        String justify = style.optString("justifyContent", "");
        if (row) {
            if ("center".equals(justify) || "space-around".equals(justify) || "space-evenly".equals(justify)) gravity |= Gravity.CENTER_HORIZONTAL;
            else if ("end".equals(justify)) gravity |= Gravity.RIGHT;
        } else {
            if ("center".equals(justify) || "space-around".equals(justify) || "space-evenly".equals(justify)) gravity |= Gravity.CENTER_VERTICAL;
            else if ("end".equals(justify)) gravity |= Gravity.BOTTOM;
        }
        if (gravity != 0) layout.setGravity(gravity);
    }

    private void applyProps(View view, JSONObject props, String tag) throws JSONException {
        if (props == null) return;
        if (props.has("disabled") && !props.has(":disabled")) view.setEnabled(false);
        if (view instanceof EditText && props.has("placeholder")) ((EditText) view).setHint(props.getString("placeholder"));
        if (view instanceof EditText) {
            EditText input = (EditText) view;
            boolean multiline = "textarea".equals(tag);
            input.setSingleLine(!multiline);
            String inputType = props.optString("type", "text").toLowerCase(java.util.Locale.ROOT);
            if (multiline) {
                input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
                int rows = integerProp(props, "rows", 0);
                if (rows > 0) {
                    input.setMinLines(rows);
                    input.setMaxLines(Integer.MAX_VALUE);
                    input.setGravity(Gravity.TOP | Gravity.START);
                }
            } else if ("password".equals(inputType)) input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
            else if ("email".equals(inputType)) input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
            else if ("url".equals(inputType)) input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
            else if ("tel".equals(inputType)) input.setInputType(InputType.TYPE_CLASS_PHONE);
            else if ("number".equals(inputType)) input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL | InputType.TYPE_NUMBER_FLAG_SIGNED);
            else if ("search".equals(inputType)) input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_WEB_EDIT_TEXT);
            if (props.has("maxlength")) {
                int maxLength = integerProp(props, "maxlength", 0);
                if (maxLength > 0) input.setFilters(new InputFilter[] { new InputFilter.LengthFilter(maxLength) });
            }
            if (props.has("required") || props.has("minlength") || props.has("pattern")) {
                input.setTag(new ValidationRules(
                        props.has("required"),
                        props.optString("type", "text"),
                        integerProp(props, "minlength", 0),
                        props.optString("pattern", "")
                ));
            }
            if (props.has("readonly")) {
                input.setFocusable(false);
                input.setFocusableInTouchMode(false);
                input.setCursorVisible(false);
                input.setKeyListener(null);
            }
            String modelKey = modelPropKey(props);
            String binding = modelExpression(props);
            if (modelKey != null) {
                input.addTextChangedListener(new TextWatcher() {
                    @Override public void beforeTextChanged(CharSequence value, int start, int count, int after) { }
                    @Override public void onTextChanged(CharSequence value, int start, int before, int count) { }
                    @Override public void afterTextChanged(Editable value) { if (!rendering && !modelKey.contains(".lazy")) stateUpdates.update(binding, modelUpdateValue(value.toString(), modelKey)); }
                });
                if (modelKey.contains(".lazy")) input.setOnFocusChangeListener((source, focused) -> {
                    if (!focused && !rendering) stateUpdates.update(binding, modelUpdateValue(input.getText().toString(), modelKey));
                });
            }
            String inputAction = eventAction(props, "@input");
            String changeAction = eventAction(props, "@change");
            String focusAction = eventAction(props, "@focus");
            String blurAction = eventAction(props, "@blur");
            String keyDownAction = eventAction(props, "@keydown");
            String keyUpAction = eventAction(props, "@keyup");
            String keyDownModifier = eventKeyModifier(props, "@keydown");
            String keyUpModifier = eventKeyModifier(props, "@keyup");
            if (inputAction != null) {
                String action = inputAction;
                input.addTextChangedListener(new TextWatcher() {
                    @Override public void beforeTextChanged(CharSequence value, int start, int count, int after) { }
                    @Override public void onTextChanged(CharSequence value, int start, int before, int count) {
                        if (!rendering) actions.dispatch(action, input, controlPayload("input", value.toString()));
                    }
                    @Override public void afterTextChanged(Editable value) { }
                });
            }
            if (keyDownAction != null || keyUpAction != null) {
                input.setOnKeyListener((source, keyCode, event) -> {
                    if (rendering || event.getAction() == KeyEvent.ACTION_MULTIPLE) return false;
                    String action = event.getAction() == KeyEvent.ACTION_DOWN ? keyDownAction : keyUpAction;
                    String modifier = event.getAction() == KeyEvent.ACTION_DOWN ? keyDownModifier : keyUpModifier;
                    if (action != null && keyMatchesModifier(modifier, keyCode, event)) actions.dispatch(action, source, keyPayload(event.getAction() == KeyEvent.ACTION_DOWN ? "keydown" : "keyup", keyCode, event));
                    return false;
                });
            }
            if ((modelKey != null && modelKey.contains(".lazy")) || changeAction != null || focusAction != null || blurAction != null) {
                input.setOnFocusChangeListener((source, focused) -> {
                    if (rendering) return;
                    if (focused) {
                        if (focusAction != null) actions.dispatch(focusAction, source, controlPayload("focus", input.getText().toString()));
                    } else {
                        if (modelKey != null && modelKey.contains(".lazy")) stateUpdates.update(binding, modelUpdateValue(input.getText().toString(), modelKey));
                        if (changeAction != null) actions.dispatch(changeAction, source, controlPayload("change", input.getText().toString()));
                        if (blurAction != null) actions.dispatch(blurAction, source, controlPayload("blur", input.getText().toString()));
                    }
                });
            }
        }
        if (view instanceof CompoundButton) {
            CompoundButton button = (CompoundButton) view;
            if (props.has("required")) button.setTag(new ValidationRules(true, "toggle", 0, ""));
            if (props.has("checked") && props.get("checked") instanceof Boolean) button.setChecked(props.getBoolean("checked"));
            String changeAction = eventAction(props, "@change");
            String modelKey = modelPropKey(props);
            if (modelKey != null || changeAction != null) {
                String binding = modelExpression(props);
                button.setOnCheckedChangeListener((source, checked) -> {
                    if (rendering) return;
                    String value = String.valueOf(checked);
                    if (!binding.isEmpty()) {
                        Object current = stateValue(binding);
                        if (isCheckbox(props)) stateUpdates.update(binding, checkboxModelValue(current, controlValue(props), checked));
                        else if (isRadio(props)) { if (checked) stateUpdates.update(binding, modelUpdateValue(controlValue(props), modelKey)); }
                        else stateUpdates.update(binding, value);
                    }
                    if (changeAction != null) actions.dispatch(changeAction, source, controlPayload("change", value));
                });
            }
        }
        if (view instanceof SeekBar) {
            SeekBar seekBar = (SeekBar) view;
            int min = integerProp(props, "min", 0);
            int max = integerProp(props, "max", 100);
            int step = Math.max(1, integerProp(props, "step", 1));
            seekBar.setMax(Math.max(0, (max - min) / step));
            if (props.has("value")) seekBar.setProgress(progressForValue(props.optString("value", "0"), min, step, seekBar.getMax()));
            String inputAction = eventAction(props, "@input");
            String changeAction = eventAction(props, "@change");
            String modelKey = modelPropKey(props);
            if (modelKey != null || inputAction != null || changeAction != null) {
                String binding = modelExpression(props);
                seekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
                    @Override public void onProgressChanged(SeekBar source, int progress, boolean fromUser) {
                        if (!rendering && fromUser) {
                            String value = String.valueOf(min + progress * step);
                            if (!binding.isEmpty()) stateUpdates.update(binding, modelUpdateValue(value, modelKey));
                            if (inputAction != null) actions.dispatch(inputAction, source, controlPayload("input", value));
                        }
                    }
                    @Override public void onStartTrackingTouch(SeekBar source) { }
                    @Override public void onStopTrackingTouch(SeekBar source) {
                        if (!rendering && changeAction != null) actions.dispatch(changeAction, source, controlPayload("change", String.valueOf(min + source.getProgress() * step)));
                    }
                });
            }
            syncSeekBarState(seekBar, props);
        }
        if (view instanceof ImageView) {
            String source = props.has(":src") ? evaluate(props.getString(":src")) : props.optString("src", "");
            if (!source.isEmpty()) loadImage((ImageView) view, source);
        }
        if (props.has(":disabled")) view.setEnabled(!evaluateBoolean(props.getString(":disabled")));
        if (props.has("v-show")) view.setVisibility(evaluateBoolean(props.getString("v-show")) ? View.VISIBLE : View.GONE);
        if (props.has("hidden")) view.setVisibility(View.GONE);
        if (props.has(":hidden")) view.setVisibility(evaluateBoolean(props.getString(":hidden")) ? View.GONE : View.VISIBLE);
        if (view instanceof FormLayout) {
            String submitAction = eventAction(props, "@submit");
            ((FormLayout) view).setSubmitAction(submitAction);
        }
        if (props.has("to") || props.has("href") || props.has(":to") || props.has(":href")) {
            view.setOnClickListener(source -> {
                Object targetValue = props.has(":to") ? evaluateValue(props.optString(":to", ""))
                        : props.has(":href") ? evaluateValue(props.optString(":href", ""))
                        : props.has("to") ? props.optString("to", "") : props.optString("href", "");
                String target = normalizeRouteLocation(targetValue);
                actions.dispatch("navigate:" + target, source);
                submitFormIfNeeded(source, props);
            });
        } else if (eventAction(props, "@click") != null) {
            String action = eventAction(props, "@click");
            view.setOnClickListener(source -> {
                actions.dispatch(action, source);
                submitFormIfNeeded(source, props);
            });
        } else if (view instanceof Button && "submit".equalsIgnoreCase(props.optString("type", ""))) {
            view.setOnClickListener(this::submitForm);
        }
        String focusAction = eventAction(props, "@focus");
        String blurAction = eventAction(props, "@blur");
        if (!(view instanceof EditText) && (focusAction != null || blurAction != null)) {
            view.setOnFocusChangeListener((source, focused) -> {
                if (rendering) return;
                String action = focused ? focusAction : blurAction;
                if (action != null) actions.dispatch(action, source, controlPayload(focused ? "focus" : "blur", ""));
            });
        }
        String longPressAction = eventAction(props, "@longpress");
        if (longPressAction == null) longPressAction = eventAction(props, "@long-press");
        if (longPressAction != null) {
            String action = longPressAction;
            view.setOnLongClickListener(source -> { actions.dispatch(action, source); return true; });
        }
        String rawStartAction = eventAction(props, "@touchstart");
        String rawEndAction = eventAction(props, "@touchend");
        String rawLeftAction = eventAction(props, "@swipeleft");
        String rawRightAction = eventAction(props, "@swiperight");
        String rawUpAction = eventAction(props, "@swipeup");
        String rawDownAction = eventAction(props, "@swipedown");
        if (rawStartAction != null || rawEndAction != null || rawLeftAction != null || rawRightAction != null || rawUpAction != null || rawDownAction != null) {
            final String startAction = rawStartAction == null ? "" : rawStartAction;
            final String endAction = rawEndAction == null ? "" : rawEndAction;
            final String leftAction = rawLeftAction == null ? "" : rawLeftAction;
            final String rightAction = rawRightAction == null ? "" : rawRightAction;
            final String upAction = rawUpAction == null ? "" : rawUpAction;
            final String downAction = rawDownAction == null ? "" : rawDownAction;
            final float[] touchStart = new float[2];
            final float threshold = 32f * context.getResources().getDisplayMetrics().density;
            view.setOnTouchListener((source, event) -> {
                if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                    touchStart[0] = event.getX();
                    touchStart[1] = event.getY();
                    if (!startAction.isEmpty()) actions.dispatch(startAction, source, gesturePayload("touchstart", event.getX(), event.getY(), 0, 0));
                }
                if (event.getActionMasked() == MotionEvent.ACTION_UP) {
                    float dx = event.getX() - touchStart[0];
                    float dy = event.getY() - touchStart[1];
                    if (!endAction.isEmpty()) actions.dispatch(endAction, source, gesturePayload("touchend", event.getX(), event.getY(), dx, dy));
                    if (Math.max(Math.abs(dx), Math.abs(dy)) >= threshold) {
                        boolean horizontal = Math.abs(dx) >= Math.abs(dy);
                        String gestureType = horizontal ? (dx < 0 ? "swipeleft" : "swiperight") : (dy < 0 ? "swipeup" : "swipedown");
                        String gestureAction = horizontal ? (dx < 0 ? leftAction : rightAction) : (dy < 0 ? upAction : downAction);
                        if (!gestureAction.isEmpty()) actions.dispatch(gestureAction, source, gesturePayload(gestureType, event.getX(), event.getY(), dx, dy));
                    }
                }
                return false;
            });
        }
        applyAccessibility(view, props, tag);
    }

    /** Resolve an event binding while allowing Vue modifiers such as .stop or .prevent. */
    private String eventAction(JSONObject props, String event) throws JSONException {
        if (props == null) return null;
        if (props.has(event)) return props.optString(event, "");
        java.util.Iterator<String> keys = props.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (key.startsWith(event + ".")) return props.optString(key, "");
        }
        return null;
    }

    private String eventKeyModifier(JSONObject props, String event) throws JSONException {
        if (props == null) return null;
        String bindingKey = eventBindingKey(props, event);
        if (bindingKey == null || bindingKey.equals(event)) return null;
        StringBuilder result = new StringBuilder();
        String[] modifiers = bindingKey.substring(event.length() + 1).split("\\.");
        for (String modifier : modifiers) if (isKeyModifier(modifier)) {
            if (result.length() > 0) result.append(',');
            result.append(modifier);
        }
        return result.length() == 0 ? null : result.toString();
    }

    private String eventBindingKey(JSONObject props, String event) throws JSONException {
        if (props == null) return null;
        if (props.has(event)) return event;
        java.util.Iterator<String> keys = props.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (key.startsWith(event + ".")) return key;
        }
        return null;
    }

    private boolean isKeyModifier(String modifier) {
        return "enter".equals(modifier) || "return".equals(modifier) || "escape".equals(modifier) || "esc".equals(modifier)
                || "tab".equals(modifier) || "space".equals(modifier) || "delete".equals(modifier) || "backspace".equals(modifier)
                || "left".equals(modifier) || "right".equals(modifier) || "up".equals(modifier) || "down".equals(modifier)
                || "home".equals(modifier) || "end".equals(modifier) || "ctrl".equals(modifier) || "shift".equals(modifier)
                || "alt".equals(modifier) || "meta".equals(modifier);
    }

    private boolean keyMatchesModifier(String modifier, int keyCode, KeyEvent event) {
        if (modifier == null || modifier.isEmpty()) return true;
        for (String part : modifier.split(",")) {
            boolean matches;
            if ("enter".equals(part) || "return".equals(part)) matches = keyCode == KeyEvent.KEYCODE_ENTER;
            else if ("escape".equals(part) || "esc".equals(part)) matches = keyCode == KeyEvent.KEYCODE_ESCAPE;
            else if ("tab".equals(part)) matches = keyCode == KeyEvent.KEYCODE_TAB;
            else if ("space".equals(part)) matches = keyCode == KeyEvent.KEYCODE_SPACE;
            else if ("delete".equals(part)) matches = keyCode == KeyEvent.KEYCODE_FORWARD_DEL;
            else if ("backspace".equals(part)) matches = keyCode == KeyEvent.KEYCODE_DEL;
            else if ("left".equals(part)) matches = keyCode == KeyEvent.KEYCODE_DPAD_LEFT;
            else if ("right".equals(part)) matches = keyCode == KeyEvent.KEYCODE_DPAD_RIGHT;
            else if ("up".equals(part)) matches = keyCode == KeyEvent.KEYCODE_DPAD_UP;
            else if ("down".equals(part)) matches = keyCode == KeyEvent.KEYCODE_DPAD_DOWN;
            else if ("home".equals(part)) matches = keyCode == KeyEvent.KEYCODE_MOVE_HOME;
            else if ("end".equals(part)) matches = keyCode == KeyEvent.KEYCODE_MOVE_END;
            else if ("ctrl".equals(part)) matches = event.isCtrlPressed();
            else if ("shift".equals(part)) matches = event.isShiftPressed();
            else if ("alt".equals(part)) matches = event.isAltPressed();
            else if ("meta".equals(part)) matches = event.isMetaPressed();
            else matches = true;
            if (!matches) return false;
        }
        return true;
    }

    private String gesturePayload(String type, float x, float y, float dx, float dy) {
        return "{\"type\":\"" + type + "\",\"x\":" + x + ",\"y\":" + y + ",\"dx\":" + dx + ",\"dy\":" + dy + "}";
    }

    private String controlPayload(String type, String value) {
        return "{\"type\":\"" + type + "\",\"value\":\"" + escapeJson(value) + "\"}";
    }

    private String keyPayload(String type, int keyCode, KeyEvent event) {
        return "{\"type\":\"" + type + "\",\"keyCode\":" + keyCode + ",\"key\":\"" + escapeJson(KeyEvent.keyCodeToString(keyCode)) + "\",\"repeat\":" + (event.getRepeatCount() > 0 ? "true" : "false") + "}";
    }

    private String escapeJson(String value) {
        return String.valueOf(value == null ? "" : value)
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\r", "\\r")
                .replace("\n", "\\n");
    }

    private void submitFormIfNeeded(View source, JSONObject props) {
        if ("submit".equalsIgnoreCase(props.optString("type", ""))) submitForm(source);
    }

    private void submitForm(View source) {
        View current = source;
        while (current != null) {
            if (current instanceof FormLayout) {
                ((FormLayout) current).submit();
                return;
            }
            android.view.ViewParent parent = current.getParent();
            current = parent instanceof View ? (View) parent : null;
        }
    }

    private static final class ValidationRules {
        final boolean required;
        final String type;
        final int minLength;
        final String pattern;

        ValidationRules(boolean required, String type, int minLength, String pattern) {
            this.required = required;
            this.type = type == null ? "text" : type.toLowerCase(java.util.Locale.ROOT);
            this.minLength = Math.max(0, minLength);
            this.pattern = pattern == null ? "" : pattern;
        }
    }

    private final class FormLayout extends LinearLayout {
        private String submitAction = "";

        FormLayout(Context context) {
            super(context);
        }

        void setSubmitAction(String action) {
            submitAction = action == null ? "" : action;
        }

        void submit() {
            View invalid = firstInvalidField(this);
            if (invalid != null) {
                invalid.requestFocus();
                if (invalid instanceof TextView) ((TextView) invalid).setError(requiredError(invalid));
                return;
            }
            if (!submitAction.isEmpty()) actions.dispatch(submitAction, this);
        }

        private String requiredError(View view) {
            Object tag = view.getTag();
            if (tag instanceof ValidationRules) {
                ValidationRules rules = (ValidationRules) tag;
                if ("email".equals(rules.type)) return "Enter a valid email";
                if (rules.minLength > 0) return "Enter at least " + rules.minLength + " characters";
                if (!rules.pattern.isEmpty()) return "Enter a valid value";
            }
            return "Required";
        }

        private View firstInvalidField(ViewGroup group) {
            for (int i = 0; i < group.getChildCount(); i++) {
                View child = group.getChildAt(i);
                if (!child.isEnabled()) continue;
                Object tag = child.getTag();
                if (tag instanceof ValidationRules) {
                    ValidationRules rules = (ValidationRules) tag;
                    if (child instanceof EditText) {
                        String value = ((EditText) child).getText().toString().trim();
                        if (value.isEmpty() && rules.required) return child;
                        if (!value.isEmpty() && "email".equals(rules.type) && !Patterns.EMAIL_ADDRESS.matcher(value).matches()) return child;
                        if (!value.isEmpty() && rules.minLength > 0 && value.length() < rules.minLength) return child;
                        if (!value.isEmpty() && !rules.pattern.isEmpty()) {
                            try {
                                if (!java.util.regex.Pattern.matches(rules.pattern, value)) return child;
                            } catch (java.util.regex.PatternSyntaxException ignored) { }
                        }
                    }
                    if (child instanceof CompoundButton && rules.required && !((CompoundButton) child).isChecked()) return child;
                }
                if (child instanceof ViewGroup) {
                    View invalid = firstInvalidField((ViewGroup) child);
                    if (invalid != null) return invalid;
                }
            }
            return null;
        }
    }

    /** Small native flow container for flex-row/flex-wrap layouts. */
    private final class NativeFlowLayout extends ViewGroup {
        private int gridColumns;
        private int gridGap;

        NativeFlowLayout(Context context) { super(context); setClipChildren(false); }

        void setGrid(int columns, int gap) {
            gridColumns = Math.max(0, columns);
            gridGap = Math.max(0, gap);
        }

        @Override protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
            int width = MeasureSpec.getSize(widthMeasureSpec);
            int available = width > 0 ? width - getPaddingLeft() - getPaddingRight() : Integer.MAX_VALUE;
            if (gridColumns > 0) {
                measureGrid(widthMeasureSpec, heightMeasureSpec, available);
                return;
            }
            int lineWidth = 0;
            int lineHeight = 0;
            int totalHeight = getPaddingTop() + getPaddingBottom();
            int maxWidth = 0;
            for (int i = 0; i < getChildCount(); i++) {
                View child = getChildAt(i);
                if (child.getVisibility() == GONE) continue;
                ViewGroup.MarginLayoutParams params = marginParams(child);
                child.measure(childSpec(params.width, widthMeasureSpec), childSpec(params.height, heightMeasureSpec));
                int childWidth = child.getMeasuredWidth() + params.leftMargin + params.rightMargin;
                int childHeight = child.getMeasuredHeight() + params.topMargin + params.bottomMargin;
                if (lineWidth > 0 && lineWidth + childWidth > available) {
                    maxWidth = Math.max(maxWidth, lineWidth);
                    totalHeight += lineHeight;
                    lineWidth = 0;
                    lineHeight = 0;
                }
                lineWidth += childWidth;
                lineHeight = Math.max(lineHeight, childHeight);
            }
            maxWidth = Math.max(maxWidth, lineWidth);
            totalHeight += lineHeight;
            int resolvedWidth = resolveSize(Math.max(maxWidth + getPaddingLeft() + getPaddingRight(), getSuggestedMinimumWidth()), widthMeasureSpec);
            int resolvedHeight = resolveSize(Math.max(totalHeight, getSuggestedMinimumHeight()), heightMeasureSpec);
            setMeasuredDimension(resolvedWidth, resolvedHeight);
        }

        @Override protected void onLayout(boolean changed, int left, int top, int right, int bottom) {
            int available = right - left - getPaddingLeft() - getPaddingRight();
            if (gridColumns > 0) {
                layoutGrid(left, top, right, bottom, available);
                return;
            }
            int x = getPaddingLeft();
            int y = getPaddingTop();
            int lineHeight = 0;
            for (int i = 0; i < getChildCount(); i++) {
                View child = getChildAt(i);
                if (child.getVisibility() == GONE) continue;
                ViewGroup.MarginLayoutParams params = marginParams(child);
                int childWidth = child.getMeasuredWidth() + params.leftMargin + params.rightMargin;
                int childHeight = child.getMeasuredHeight() + params.topMargin + params.bottomMargin;
                if (x > getPaddingLeft() && x - getPaddingLeft() + childWidth > available) {
                    x = getPaddingLeft();
                    y += lineHeight;
                    lineHeight = 0;
                }
                int childLeft = x + params.leftMargin;
                int childTop = y + params.topMargin;
                child.layout(childLeft, childTop, childLeft + child.getMeasuredWidth(), childTop + child.getMeasuredHeight());
                x += childWidth;
                lineHeight = Math.max(lineHeight, childHeight);
            }
        }

        private ViewGroup.MarginLayoutParams marginParams(View child) {
            ViewGroup.LayoutParams raw = child.getLayoutParams();
            return raw instanceof ViewGroup.MarginLayoutParams ? (ViewGroup.MarginLayoutParams) raw : new ViewGroup.MarginLayoutParams(raw);
        }

        private int childSpec(int dimension, int parentSpec) {
            int mode = MeasureSpec.getMode(parentSpec);
            int size = MeasureSpec.getSize(parentSpec);
            if (dimension >= 0) return MeasureSpec.makeMeasureSpec(dimension, MeasureSpec.EXACTLY);
            if (dimension == ViewGroup.LayoutParams.MATCH_PARENT && mode != MeasureSpec.UNSPECIFIED) return MeasureSpec.makeMeasureSpec(size, mode);
            return MeasureSpec.makeMeasureSpec(size, MeasureSpec.AT_MOST);
        }

        private void measureGrid(int widthMeasureSpec, int heightMeasureSpec, int available) {
            int columns = Math.max(1, gridColumns);
            int cellWidth = Math.max(0, (available - gridGap * (columns - 1)) / columns);
            int rowHeight = 0;
            int visible = 0;
            ArrayList<Integer> rowHeights = new ArrayList<>();
            for (int i = 0; i < getChildCount(); i++) {
                View child = getChildAt(i);
                if (child.getVisibility() == GONE) continue;
                ViewGroup.MarginLayoutParams params = marginParams(child);
                int contentWidth = Math.max(0, cellWidth - params.leftMargin - params.rightMargin);
                child.measure(MeasureSpec.makeMeasureSpec(contentWidth, MeasureSpec.EXACTLY), childSpec(params.height, heightMeasureSpec));
                rowHeight = Math.max(rowHeight, child.getMeasuredHeight() + params.topMargin + params.bottomMargin);
                visible++;
                if (visible % columns == 0) { rowHeights.add(rowHeight); rowHeight = 0; }
            }
            if (visible % columns != 0) rowHeights.add(rowHeight);
            int measuredHeight = 0;
            for (int index = 0; index < rowHeights.size(); index++) {
                measuredHeight += rowHeights.get(index);
                if (index + 1 < rowHeights.size()) measuredHeight += gridGap;
            }
            int totalHeight = getPaddingTop() + getPaddingBottom() + measuredHeight;
            int measuredWidth = MeasureSpec.getSize(widthMeasureSpec);
            int resolvedWidth = resolveSize(Math.max(measuredWidth > 0 ? measuredWidth : cellWidth * columns + gridGap * (columns - 1) + getPaddingLeft() + getPaddingRight(), getSuggestedMinimumWidth()), widthMeasureSpec);
            int resolvedHeight = resolveSize(Math.max(totalHeight, getSuggestedMinimumHeight()), heightMeasureSpec);
            setMeasuredDimension(resolvedWidth, resolvedHeight);
        }

        private void layoutGrid(int left, int top, int right, int bottom, int available) {
            int columns = Math.max(1, gridColumns);
            int cellWidth = Math.max(0, (available - gridGap * (columns - 1)) / columns);
            int x = getPaddingLeft();
            int y = getPaddingTop();
            int rowHeight = 0;
            int column = 0;
            for (int i = 0; i < getChildCount(); i++) {
                View child = getChildAt(i);
                if (child.getVisibility() == GONE) continue;
                ViewGroup.MarginLayoutParams params = marginParams(child);
                int childLeft = x + params.leftMargin;
                int childTop = y + params.topMargin;
                child.layout(childLeft, childTop, childLeft + child.getMeasuredWidth(), childTop + child.getMeasuredHeight());
                rowHeight = Math.max(rowHeight, child.getMeasuredHeight() + params.topMargin + params.bottomMargin);
                column++;
                if (column == columns) {
                    x = getPaddingLeft();
                    y += rowHeight + gridGap;
                    rowHeight = 0;
                    column = 0;
                } else {
                    x += cellWidth + gridGap;
                }
            }
        }
    }

    private boolean isFlowStyle(JSONObject style) {
        return style != null && ("wrap".equals(style.optString("flexWrap")) || "grid".equals(style.optString("display")) || style.optInt("gridColumns", 0) > 0);
    }

    private boolean isVerticalScrollStyle(JSONObject style) {
        if (style == null) return false;
        String overflow = style.optString("overflow", "");
        String overflowY = style.optString("overflowY", "");
        return "auto".equals(overflow) || "scroll".equals(overflow) || "auto".equals(overflowY) || "scroll".equals(overflowY);
    }

    private boolean isHorizontalScrollStyle(JSONObject style) {
        if (style == null) return false;
        String overflow = style.optString("overflow", "");
        String overflowX = style.optString("overflowX", "");
        return "auto".equals(overflowX) || "scroll".equals(overflowX) || ("auto".equals(overflow) || "scroll".equals(overflow)) && "row".equals(style.optString("flexDirection"));
    }

    private void configureFlowLayout(NativeFlowLayout layout, JSONObject style) {
        if (style == null) return;
        layout.setGrid(style.optInt("gridColumns", 0), style.optInt("gap", 0));
    }

    private void applyAccessibility(View view, JSONObject props, String tag) throws JSONException {
        if (props == null) return;
        String label = accessibilityValue(props, "aria-label");
        if (label == null || label.isEmpty()) label = accessibilityValue(props, "content-description");
        if ((label == null || label.isEmpty()) && "img".equalsIgnoreCase(tag)) label = accessibilityValue(props, "alt");
        if (label != null && !label.isEmpty()) view.setContentDescription(label);

        String role = accessibilityValue(props, "role");
        if (role == null || role.isEmpty()) role = accessibilityValue(props, "aria-role");
        if (role != null && !role.isEmpty()) {
            final String accessibilityClass = accessibilityClassForRole(role);
            view.setAccessibilityDelegate(new View.AccessibilityDelegate() {
                @Override public void onInitializeAccessibilityNodeInfo(View host, android.view.accessibility.AccessibilityNodeInfo info) {
                    super.onInitializeAccessibilityNodeInfo(host, info);
                    info.setClassName(accessibilityClass);
                }
            });
        }
        if (android.os.Build.VERSION.SDK_INT >= 28 && (role != null && "heading".equalsIgnoreCase(role) || tag.matches("h[1-6]"))) view.setAccessibilityHeading(true);

        String hidden = accessibilityValue(props, "aria-hidden");
        if (isTrue(hidden)) view.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        else if (isFalse(hidden)) view.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);

        String disabled = accessibilityValue(props, "aria-disabled");
        if (isTrue(disabled)) view.setEnabled(false);
        else if (isFalse(disabled) && !props.has(":disabled")) view.setEnabled(true);

        String focusable = accessibilityValue(props, "tabindex");
        if (focusable != null && !focusable.isEmpty()) {
            try { view.setFocusable(Integer.parseInt(focusable) >= 0); }
            catch (NumberFormatException ignored) { }
        }
        String live = accessibilityValue(props, "aria-live");
        if (live != null && !live.isEmpty()) {
            if ("assertive".equalsIgnoreCase(live)) view.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_ASSERTIVE);
            else if ("polite".equalsIgnoreCase(live)) view.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        }
        String description = accessibilityValue(props, "aria-description");
        if (description != null && !description.isEmpty() && android.os.Build.VERSION.SDK_INT >= 26) view.setTooltipText(description);
    }

    private String accessibilityValue(JSONObject props, String name) throws JSONException {
        String dynamic = ":" + name;
        if (props.has(dynamic)) return evaluate(props.getString(dynamic));
        if (!props.has(name)) return null;
        Object value = props.get(name);
        return value == JSONObject.NULL ? null : String.valueOf(value);
    }

    private boolean isTrue(String value) { return "true".equalsIgnoreCase(value) || "1".equals(value); }
    private boolean isFalse(String value) { return "false".equalsIgnoreCase(value) || "0".equals(value); }

    private String accessibilityClassForRole(String role) {
        if ("button".equalsIgnoreCase(role)) return "android.widget.Button";
        if ("checkbox".equalsIgnoreCase(role)) return "android.widget.CheckBox";
        if ("image".equalsIgnoreCase(role) || "img".equalsIgnoreCase(role)) return "android.widget.ImageView";
        if ("link".equalsIgnoreCase(role)) return "android.widget.TextView";
        return "android.view.View";
    }

    private void loadImage(ImageView view, String source) {
        int token = beginImageLoad(view);
        if (source == null || source.isEmpty()) {
            view.setImageDrawable(null);
            return;
        }
        if (source.startsWith("data:")) {
            loadDataImage(view, source, token);
            return;
        }
        if (!source.startsWith("http://") && !source.startsWith("https://")) {
            String assetPath = packagedAssetPath(source);
            if (assetPath != null) {
                new Thread(() -> {
                    try (InputStream stream = context.getAssets().open(assetPath)) {
                        android.graphics.Bitmap bitmap = BitmapFactory.decodeStream(stream);
                        postImage(view, token, bitmap);
                    } catch (Exception ignored) {
                        // Missing public assets remain local to the image view; page runtime stays alive.
                    }
                }).start();
            } else {
                view.setImageURI(Uri.parse(source));
            }
            return;
        }
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(source).openConnection();
                connection.setConnectTimeout(10000);
                connection.setReadTimeout(15000);
                connection.connect();
                android.graphics.Bitmap bitmap = BitmapFactory.decodeStream(connection.getInputStream());
                postImage(view, token, bitmap);
            } catch (Exception ignored) {
                // Image failures remain local to the image view; page runtime stays alive.
            } finally {
                if (connection != null) connection.disconnect();
            }
        }).start();
    }

    private void loadDataImage(ImageView view, String source, int token) {
        new Thread(() -> {
            try {
                int comma = source.indexOf(',');
                if (comma < 0) return;
                String metadata = source.substring(5, comma).toLowerCase(java.util.Locale.ROOT);
                String payload = source.substring(comma + 1);
                byte[] bytes = metadata.contains(";base64")
                        ? Base64.decode(payload, Base64.DEFAULT)
                        : java.net.URLDecoder.decode(payload, StandardCharsets.UTF_8.name()).getBytes(StandardCharsets.UTF_8);
                android.graphics.Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                postImage(view, token, bitmap);
            } catch (Exception ignored) {
                // Invalid data URLs remain local to the image view; page runtime stays alive.
            }
        }).start();
    }

    private int beginImageLoad(ImageView view) {
        int token = imageLoadTokens.getOrDefault(view, 0) + 1;
        imageLoadTokens.put(view, token);
        return token;
    }

    private void postImage(ImageView view, int token, android.graphics.Bitmap bitmap) {
        if (bitmap == null) return;
        new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
            if (imageLoadTokens.getOrDefault(view, 0) == token) view.setImageBitmap(bitmap);
            else bitmap.recycle();
        });
    }

    private void applyStyle(View view, JSONObject style) throws JSONException {
        if (style == null) return;
        if (style.has("animation")) animate(view, style.getString("animation"));
        if (style.has("minWidth")) view.setMinimumWidth(Math.max(0, style.optInt("minWidth", 0)));
        if (style.has("minHeight")) view.setMinimumHeight(Math.max(0, style.optInt("minHeight", 0)));
        if (view instanceof TextView) {
            TextView text = (TextView) view;
            if (style.has("maxWidth")) text.setMaxWidth(Math.max(0, style.optInt("maxWidth", Integer.MAX_VALUE)));
            if (style.has("maxHeight")) text.setMaxHeight(Math.max(0, style.optInt("maxHeight", Integer.MAX_VALUE)));
        }
        if (hasGradient(style)) view.setBackground(backgroundDrawable(style));
        else if (style.has("backgroundColor")) view.setBackgroundColor(parseColor(style.getString("backgroundColor")));
        if (view instanceof TextView) {
            TextView text = (TextView) view;
            text.setIncludeFontPadding(false);
            if (style.has("color")) text.setTextColor(parseColor(style.getString("color")));
            if (style.has("fontSize")) text.setTextSize((float) style.getDouble("fontSize"));
            if (style.has("letterSpacing") && android.os.Build.VERSION.SDK_INT >= 21) text.setLetterSpacing((float) style.optDouble("letterSpacing", 0.0));
            if (style.has("fontWeight") && style.getInt("fontWeight") >= 600) text.setTypeface(null, 1);
            if (style.has("fontStyle")) text.setTypeface(null, "italic".equals(style.optString("fontStyle")) ? 2 : 0);
            if (style.has("textDecoration")) {
                String decoration = style.optString("textDecoration");
                text.getPaint().setUnderlineText("underline".equals(decoration));
                text.getPaint().setStrikeThruText("line-through".equals(decoration));
            }
            if (style.has("textAlign")) {
                String align = style.optString("textAlign");
                text.setGravity("center".equals(align) ? Gravity.CENTER_HORIZONTAL : "right".equals(align) ? Gravity.RIGHT : Gravity.LEFT);
            }
            if (style.has("lineHeight") && style.has("fontSize")) {
                float fontSize = (float) style.optDouble("fontSize");
                float lineHeight = (float) style.optDouble("lineHeight");
                text.setLineSpacing(Math.max(0f, lineHeight - fontSize), 1f);
            }
        }
        if (view instanceof ImageView && style.has("objectFit")) {
            String fit = style.optString("objectFit", "contain");
            ImageView image = (ImageView) view;
            if ("cover".equals(fit)) image.setScaleType(ImageView.ScaleType.CENTER_CROP);
            else if ("fill".equals(fit)) image.setScaleType(ImageView.ScaleType.FIT_XY);
            else if ("none".equals(fit)) image.setScaleType(ImageView.ScaleType.CENTER);
            else image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        }
        boolean hasPadding = style.has("padding") || style.has("paddingHorizontal") || style.has("paddingVertical")
                || style.has("paddingLeft") || style.has("paddingTop") || style.has("paddingRight") || style.has("paddingBottom");
        if (hasPadding) {
            int padding = style.optInt("padding", 0);
            int horizontalPadding = style.has("paddingHorizontal") ? style.optInt("paddingHorizontal", padding) : padding;
            int verticalPadding = style.has("paddingVertical") ? style.optInt("paddingVertical", padding) : padding;
            int leftPadding = style.has("paddingLeft") ? style.optInt("paddingLeft", horizontalPadding) : horizontalPadding;
            int topPadding = style.has("paddingTop") ? style.optInt("paddingTop", verticalPadding) : verticalPadding;
            int rightPadding = style.has("paddingRight") ? style.optInt("paddingRight", horizontalPadding) : horizontalPadding;
            int bottomPadding = style.has("paddingBottom") ? style.optInt("paddingBottom", verticalPadding) : verticalPadding;
            view.setPadding(leftPadding, topPadding, rightPadding, bottomPadding);
        }
        if (!hasGradient(style) && style.has("borderRadius")) {
            GradientDrawable background = new GradientDrawable();
            background.setColor(style.has("backgroundColor") ? parseColor(style.getString("backgroundColor")) : Color.TRANSPARENT);
            background.setCornerRadius((float) style.getDouble("borderRadius"));
            if (style.has("borderWidth")) background.setStroke(style.optInt("borderWidth", 1), parseColor(style.optString("borderColor", "#00000000")));
            view.setBackground(background);
        } else if (!hasGradient(style) && (style.has("borderWidth") || style.has("borderColor"))) {
            GradientDrawable background = new GradientDrawable();
            background.setColor(style.has("backgroundColor") ? parseColor(style.getString("backgroundColor")) : Color.TRANSPARENT);
            if (style.has("borderWidth")) background.setStroke(style.optInt("borderWidth", 1), parseColor(style.optString("borderColor", "#00000000")));
            view.setBackground(background);
        }
        if (style.has("opacity")) view.setAlpha((float) style.optDouble("opacity", 1.0));
        if (style.has("elevation")) view.setElevation((float) style.optDouble("elevation", 0.0));
        if (style.has("zIndex") && android.os.Build.VERSION.SDK_INT >= 21) view.setZ((float) style.optDouble("zIndex", 0.0));
        if (view instanceof ViewGroup && style.has("overflow")) {
            ((ViewGroup) view).setClipChildren("hidden".equals(style.optString("overflow")));
        }
    }

    private String formatText(String value, JSONObject style) {
        if (value == null || style == null) return value;
        String transform = style.optString("textTransform", "none");
        if ("uppercase".equals(transform)) return value.toUpperCase(java.util.Locale.ROOT);
        if ("lowercase".equals(transform)) return value.toLowerCase(java.util.Locale.ROOT);
        if ("capitalize".equals(transform)) {
            StringBuilder result = new StringBuilder();
            boolean wordStart = true;
            for (int i = 0; i < value.length(); i++) {
                char character = value.charAt(i);
                if (Character.isWhitespace(character)) { wordStart = true; result.append(character); }
                else { result.append(wordStart ? String.valueOf(character).toUpperCase(java.util.Locale.ROOT) : character); wordStart = false; }
            }
            return result.toString();
        }
        return value;
    }

    private String packagedAssetPath(String source) {
        if (source == null || source.isEmpty() || source.startsWith("data:") || source.startsWith("file:") || source.startsWith("content:") || source.startsWith("android.resource:")) return null;
        String path = source.startsWith("/") ? source.substring(1) : source;
        if (path.startsWith("public/")) path = path.substring("public/".length());
        if (path.isEmpty() || path.contains("..") || path.contains("\\") || path.contains(":")) return null;
        return "public/" + path;
    }

    private void animate(View view, String animation) {
        animate(view, animation, 220L, "standard", "");
    }

    private void animate(View view, String animation, long duration, String easing, String afterAction) {
        view.animate().cancel();
        android.view.ViewPropertyAnimator animator = view.animate().setDuration(duration).setInterpolator(interpolator(easing));
        if (afterAction != null && !afterAction.isEmpty()) animator.withEndAction(() -> actions.dispatch(afterAction, view));
        if ("fade-in".equals(animation)) {
            view.setAlpha(0f);
            animator.alpha(1f).start();
        } else if ("slide-up".equals(animation)) {
            view.setAlpha(0f);
            view.setTranslationY(24f * context.getResources().getDisplayMetrics().density);
            animator.alpha(1f).translationY(0f).start();
        } else if ("scale-in".equals(animation)) {
            view.setAlpha(0f);
            view.setScaleX(0.96f);
            view.setScaleY(0.96f);
            animator.alpha(1f).scaleX(1f).scaleY(1f).start();
        }
    }

    private long transitionDuration(JSONObject props) {
        if (props == null || !props.has("duration")) return 220L;
        try { return Math.max(0L, Long.parseLong(props.getString("duration"))); }
        catch (Exception ignored) { return 220L; }
    }

    private android.animation.TimeInterpolator interpolator(String easing) {
        if ("linear".equals(easing)) return new android.view.animation.LinearInterpolator();
        if ("ease-in".equals(easing)) return new android.view.animation.AccelerateInterpolator();
        if ("ease-out".equals(easing)) return new android.view.animation.DecelerateInterpolator();
        return new android.view.animation.AccelerateDecelerateInterpolator();
    }

    private void applyDynamicBindings(View view, JSONObject node) throws JSONException {
        String classExpression = node.optString("classBinding", "");
        JSONObject bindings = node.optJSONObject("styleBindings");
        JSONObject props = node.optJSONObject("props");
        String objectBinding = props == null ? "" : props.optString("v-bind", "");
        boolean hasDynamicBindings = !classExpression.isEmpty() || (bindings != null && bindings.length() > 0) || !objectBinding.isEmpty();
        if (hasDynamicBindings) {
            DynamicSnapshot snapshot = dynamicSnapshots.get(view);
            if (snapshot == null) {
                snapshot = new DynamicSnapshot(view);
                dynamicSnapshots.put(view, snapshot);
            } else snapshot.restore(view);
            applyVariantStyles(view, node);
        }
        if (!classExpression.isEmpty()) applyDynamicClasses(view, evaluateClasses(classExpression));
        if (bindings == null) {
            applyObjectBinding(view, props, objectBinding, node.optString("tag", ""));
            applyStateStyles(view, node);
            return;
        }
        JSONObject dynamicStyle = new JSONObject();
        java.util.Iterator<String> keys = bindings.keys();
        while (keys.hasNext()) {
            String property = keys.next();
            Object expression = bindings.get(property);
            dynamicStyle.put(property, evaluateValue(String.valueOf(expression)));
        }
        applyStyle(view, dynamicStyle);
        applyObjectBinding(view, props, objectBinding, node.optString("tag", ""));
        applyStateStyles(view, node);
    }

    private void applyObjectBinding(View view, JSONObject props, String expression, String tag) throws JSONException {
        if (expression == null || expression.isEmpty()) return;
        Object value = evaluateValue(expression);
        if (!(value instanceof JSONObject)) return;
        JSONObject bound = (JSONObject) value;
        if (bound.has("class")) applyDynamicClasses(view, String.valueOf(bound.opt("class")));
        if (bound.has("style")) {
            Object style = bound.opt("style");
            if (style instanceof JSONObject) applyStyle(view, (JSONObject) style);
        }
        if (bound.has("disabled")) view.setEnabled(!objectBoolean(bound.opt("disabled")));
        if (bound.has("hidden")) view.setVisibility(objectBoolean(bound.opt("hidden")) ? View.GONE : View.VISIBLE);
        JSONObject accessibility = new JSONObject();
        String[] accessibilityNames = { "aria-label", "aria-description", "aria-hidden", "aria-disabled", "aria-live", "role", "tabindex", "alt", "content-description" };
        for (String name : accessibilityNames) if (bound.has(name)) accessibility.put(name, bound.opt(name));
        if (accessibility.length() > 0) applyAccessibility(view, accessibility, tag);
        if (bound.has("placeholder") && view instanceof EditText) ((EditText) view).setHint(String.valueOf(bound.opt("placeholder")));
        if (bound.has("value") && view instanceof EditText && !((EditText) view).hasFocus()) {
            Object next = bound.opt("value");
            ((EditText) view).setText(next == null || next == JSONObject.NULL ? "" : String.valueOf(next));
        }
        if (bound.has("src") && view instanceof ImageView) loadImage((ImageView) view, String.valueOf(bound.opt("src")));
    }

    private boolean objectBoolean(Object value) {
        if (value instanceof Boolean) return (Boolean) value;
        if (value == null || value == JSONObject.NULL) return false;
        return isTrue(String.valueOf(value));
    }

    /** Captures the non-reactive Android properties so dynamic class/style updates can replace prior values. */
    private static final class DynamicSnapshot {
        final Drawable background;
        final float alpha;
        final ColorStateList textColors;
        final float textSize;
        final Typeface typeface;
        final int gravity;
        final int orientation;

        DynamicSnapshot(View view) {
            background = view.getBackground();
            alpha = view.getAlpha();
            if (view instanceof TextView) {
                TextView text = (TextView) view;
                textColors = text.getTextColors();
                textSize = text.getTextSize();
                typeface = text.getTypeface();
                gravity = text.getGravity();
            } else {
                textColors = null;
                textSize = 0f;
                typeface = null;
                gravity = 0;
            }
            orientation = view instanceof LinearLayout ? ((LinearLayout) view).getOrientation() : -1;
        }

        void restore(View view) {
            view.setBackground(background);
            view.setAlpha(alpha);
            if (view instanceof TextView) {
                TextView text = (TextView) view;
                if (textColors != null) text.setTextColor(textColors);
                if (textSize > 0f) text.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, textSize);
                text.setTypeface(typeface);
                text.setGravity(gravity);
            }
            if (view instanceof LinearLayout && orientation >= 0) ((LinearLayout) view).setOrientation(orientation);
        }
    }

    /** Apply Tailwind responsive and system-theme variants to the native view surface. */
    private void applyVariantStyles(View view, JSONObject node) throws JSONException {
        applyStyle(view, effectiveVariantStyle(node));
    }

    private void applyVariantLayout(View view, JSONObject node) throws JSONException {
        JSONObject style = effectiveVariantStyle(node);
        if (view instanceof NativeFlowLayout) configureFlowLayout((NativeFlowLayout) view, style);
        if (view instanceof LinearLayout && !(view instanceof NativeFlowLayout)) {
            LinearLayout layout = (LinearLayout) view;
            if ("row".equals(style.optString("flexDirection"))) layout.setOrientation(LinearLayout.HORIZONTAL);
            else if ("column".equals(style.optString("flexDirection"))) layout.setOrientation(LinearLayout.VERTICAL);
            applyLayoutGravity(layout, style);
        }
    }

    private JSONObject effectiveVariantStyle(JSONObject node) throws JSONException {
        JSONObject result = new JSONObject();
        JSONObject base = node.optJSONObject("style");
        if (base != null) {
            java.util.Iterator<String> keys = base.keys();
            while (keys.hasNext()) { String key = keys.next(); result.put(key, base.get(key)); }
        }
        JSONObject responsive = node.optJSONObject("responsiveStyles");
        if (responsive != null) {
            int width = context.getResources().getDisplayMetrics().widthPixels;
            String[] names = { "sm", "md", "lg", "xl", "2xl" };
            int[] breakpoints = { 640, 768, 1024, 1280, 1536 };
            for (int index = 0; index < names.length; index++) if (width >= breakpoints[index]) mergeStyle(result, responsive.optJSONObject(names[index]));
        }
        JSONObject themes = node.optJSONObject("themeStyles");
        if (themes != null) {
            int mode = context.getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
            mergeStyle(result, themes.optJSONObject(mode == android.content.res.Configuration.UI_MODE_NIGHT_YES ? "dark" : "light"));
        }
        return result;
    }

    private void mergeStyle(JSONObject target, JSONObject source) throws JSONException {
        if (source == null) return;
        java.util.Iterator<String> keys = source.keys();
        while (keys.hasNext()) { String key = keys.next(); target.put(key, source.get(key)); }
    }

    /** Apply Tailwind interaction variants through Android's native state system. */
    private void applyStateStyles(View view, JSONObject node) throws JSONException {
        JSONObject states = effectiveStateStyles(node);
        if (states == null || states.length() == 0) return;
        JSONObject base = effectiveVariantStyle(node);
        boolean hasBackgroundState = false;
        boolean hasTextState = false;
        String[] names = { "pressed", "focused", "hovered", "selected", "disabled" };
        for (String name : names) {
            JSONObject state = states.optJSONObject(name);
            if (state != null && (state.has("backgroundColor") || state.has("gradientFrom") || state.has("gradientVia") || state.has("gradientTo") || state.has("borderWidth") || state.has("borderColor"))) hasBackgroundState = true;
            if (state != null && state.has("color")) hasTextState = true;
        }
        if (hasBackgroundState) {
            StateListDrawable backgrounds = new StateListDrawable();
            addBackgroundState(backgrounds, states.optJSONObject("pressed"), new int[] { android.R.attr.state_pressed }, base);
            addBackgroundState(backgrounds, states.optJSONObject("focused"), new int[] { android.R.attr.state_focused }, base);
            addBackgroundState(backgrounds, states.optJSONObject("hovered"), new int[] { android.R.attr.state_hovered }, base);
            addBackgroundState(backgrounds, states.optJSONObject("selected"), new int[] { android.R.attr.state_selected }, base);
            addBackgroundState(backgrounds, states.optJSONObject("disabled"), new int[] { -android.R.attr.state_enabled }, base);
            backgrounds.addState(new int[] {}, backgroundDrawable(base));
            view.setBackground(backgrounds);
        }
        if (hasTextState && view instanceof TextView) {
            int defaultColor = parseColor(base == null ? "#000000" : base.optString("color", "#000000"));
            int[][] specs = new int[][] {
                    new int[] { android.R.attr.state_pressed },
                    new int[] { android.R.attr.state_focused },
                    new int[] { android.R.attr.state_hovered },
                    new int[] { android.R.attr.state_selected },
                    new int[] { -android.R.attr.state_enabled },
                    new int[] {}
            };
            int[] colors = new int[] {
                    stateColor(states.optJSONObject("pressed"), defaultColor),
                    stateColor(states.optJSONObject("focused"), defaultColor),
                    stateColor(states.optJSONObject("hovered"), defaultColor),
                    stateColor(states.optJSONObject("selected"), defaultColor),
                    stateColor(states.optJSONObject("disabled"), defaultColor),
                    defaultColor
            };
            ((TextView) view).setTextColor(new ColorStateList(specs, colors));
        }
    }

    private JSONObject effectiveStateStyles(JSONObject node) throws JSONException {
        JSONObject result = new JSONObject();
        mergeStateStyles(result, node.optJSONObject("stateStyles"));
        JSONObject responsive = node.optJSONObject("responsiveStateStyles");
        if (responsive != null) {
            int width = context.getResources().getDisplayMetrics().widthPixels;
            String[] names = { "sm", "md", "lg", "xl", "2xl" };
            int[] breakpoints = { 640, 768, 1024, 1280, 1536 };
            for (int index = 0; index < names.length; index++) if (width >= breakpoints[index]) mergeStateStyles(result, responsive.optJSONObject(names[index]));
        }
        JSONObject themes = node.optJSONObject("themeStateStyles");
        if (themes != null) {
            int mode = context.getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
            mergeStateStyles(result, themes.optJSONObject(mode == android.content.res.Configuration.UI_MODE_NIGHT_YES ? "dark" : "light"));
        }
        return result;
    }

    private void mergeStateStyles(JSONObject target, JSONObject source) throws JSONException {
        if (source == null) return;
        java.util.Iterator<String> states = source.keys();
        while (states.hasNext()) {
            String state = states.next();
            JSONObject values = source.optJSONObject(state);
            if (values == null) continue;
            JSONObject destination = target.optJSONObject(state);
            if (destination == null) { destination = new JSONObject(); target.put(state, destination); }
            mergeStyle(destination, values);
        }
    }

    private void addBackgroundState(StateListDrawable target, JSONObject state, int[] spec, JSONObject base) throws JSONException {
        if (state != null && (state.has("backgroundColor") || state.has("gradientFrom") || state.has("gradientVia") || state.has("gradientTo") || state.has("borderWidth") || state.has("borderColor"))) target.addState(spec, backgroundDrawable(state, base));
    }

    private GradientDrawable backgroundDrawable(JSONObject style) throws JSONException { return backgroundDrawable(style, null); }

    private GradientDrawable backgroundDrawable(JSONObject style, JSONObject fallback) throws JSONException {
        GradientDrawable background = new GradientDrawable();
        String color = style != null && style.has("backgroundColor") ? style.optString("backgroundColor")
                : fallback != null ? fallback.optString("backgroundColor", "#00000000") : "#00000000";
        boolean solidOverride = style != null && style.has("backgroundColor") && !hasGradient(style);
        if (!solidOverride && (hasGradient(style) || hasGradient(fallback))) {
            JSONObject source = hasGradient(style) ? style : fallback;
            String from = source.optString("gradientFrom", color);
            String to = source.optString("gradientTo", from);
            String via = source.optString("gradientVia", "");
            int[] colors = via.isEmpty()
                    ? new int[] { parseColor(from), parseColor(to) }
                    : new int[] { parseColor(from), parseColor(via), parseColor(to) };
            background.setOrientation(gradientOrientation(source.optString("gradientDirection", "r")));
            background.setColors(colors);
        } else background.setColor(parseColor(color));
        double radius = style != null && style.has("borderRadius") ? style.optDouble("borderRadius")
                : fallback != null ? fallback.optDouble("borderRadius", 0) : 0;
        if (radius > 0) background.setCornerRadius((float) radius);
        int width = style != null && style.has("borderWidth") ? style.optInt("borderWidth")
                : fallback != null ? fallback.optInt("borderWidth", 0) : 0;
        if (width > 0) {
            String border = style != null && style.has("borderColor") ? style.optString("borderColor")
                    : fallback != null ? fallback.optString("borderColor", "#00000000") : "#00000000";
            background.setStroke(width, parseColor(border));
        }
        return background;
    }

    private boolean hasGradient(JSONObject style) {
        return style != null && (style.has("gradientDirection") || style.has("gradientFrom") || style.has("gradientVia") || style.has("gradientTo"));
    }

    private GradientDrawable.Orientation gradientOrientation(String direction) {
        if ("t".equals(direction)) return GradientDrawable.Orientation.BOTTOM_TOP;
        if ("tr".equals(direction)) return GradientDrawable.Orientation.BL_TR;
        if ("br".equals(direction)) return GradientDrawable.Orientation.TL_BR;
        if ("b".equals(direction)) return GradientDrawable.Orientation.TOP_BOTTOM;
        if ("bl".equals(direction)) return GradientDrawable.Orientation.TR_BL;
        if ("l".equals(direction)) return GradientDrawable.Orientation.RIGHT_LEFT;
        if ("tl".equals(direction)) return GradientDrawable.Orientation.BR_TL;
        return GradientDrawable.Orientation.LEFT_RIGHT;
    }

    private int stateColor(JSONObject state, int fallback) {
        return state != null && state.has("color") ? parseColor(state.optString("color")) : fallback;
    }

    private String evaluateClasses(String expression) {
        String source = expression == null ? "" : expression.trim();
        if (source.startsWith("[") && source.endsWith("]")) {
            StringBuilder result = new StringBuilder();
            for (String part : splitTopLevel(source.substring(1, source.length() - 1), ',')) appendClassValue(result, evaluateClasses(part));
            return result.toString();
        }
        if (source.startsWith("{") && source.endsWith("}")) {
            StringBuilder result = new StringBuilder();
            for (String part : splitTopLevel(source.substring(1, source.length() - 1), ',')) {
                int separator = topLevelOperator(part, ':', 0);
                if (separator < 0) continue;
                String key = part.substring(0, separator).trim();
                if ((key.startsWith("'") && key.endsWith("'")) || (key.startsWith("\"") && key.endsWith("\""))) key = key.substring(1, key.length() - 1);
                if (evaluateBoolean(part.substring(separator + 1))) appendClassValue(result, key);
            }
            return result.toString();
        }
        return classValue(evaluate(source));
    }

    private List<String> splitTopLevel(String source, char separator) {
        List<String> parts = new ArrayList<>();
        char quote = 0;
        int depth = 0;
        int start = 0;
        for (int i = 0; i < source.length(); i++) {
            char current = source.charAt(i);
            if (quote != 0) {
                if (current == quote && (i == 0 || source.charAt(i - 1) != '\\')) quote = 0;
                continue;
            }
            if (current == '\'' || current == '"') { quote = current; continue; }
            if (current == '(' || current == '[' || current == '{') depth++;
            else if (current == ')' || current == ']' || current == '}') depth = Math.max(0, depth - 1);
            else if (current == separator && depth == 0) { parts.add(source.substring(start, i).trim()); start = i + 1; }
        }
        parts.add(source.substring(start).trim());
        return parts;
    }

    private String classValue(Object value) {
        if (value == null || value == JSONObject.NULL || value instanceof Boolean && !((Boolean) value)) return "";
        if (value instanceof JSONArray) {
            StringBuilder result = new StringBuilder();
            JSONArray values = (JSONArray) value;
            for (int i = 0; i < values.length(); i++) appendClassValue(result, classValue(values.opt(i)));
            return result.toString();
        }
        if (value instanceof JSONObject) {
            StringBuilder result = new StringBuilder();
            JSONObject values = (JSONObject) value;
            java.util.Iterator<String> keys = values.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                if (evaluateBoolean(String.valueOf(values.opt(key)))) appendClassValue(result, key);
            }
            return result.toString();
        }
        return String.valueOf(value);
    }

    private void appendClassValue(StringBuilder target, String value) {
        if (value == null || value.isEmpty()) return;
        if (target.length() > 0) target.append(' ');
        target.append(value);
    }

    private void applyDynamicClasses(View view, String classes) {
        for (String token : classes.split("\\s+")) {
            if (token.startsWith("bg-")) view.setBackgroundColor(parseColor(dynamicColor(token.substring(3))));
            else if (view instanceof TextView && token.startsWith("text-")) {
                String value = token.substring(5);
                if (value.startsWith("xs")) ((TextView) view).setTextSize(12);
                else if (value.startsWith("sm")) ((TextView) view).setTextSize(14);
                else if (value.startsWith("base")) ((TextView) view).setTextSize(16);
                else if (value.startsWith("lg")) ((TextView) view).setTextSize(18);
                else if (value.startsWith("xl")) ((TextView) view).setTextSize(20);
                else if (value.startsWith("2xl")) ((TextView) view).setTextSize(24);
                else if (value.equals("center")) ((TextView) view).setGravity(Gravity.CENTER_HORIZONTAL);
                else ((TextView) view).setTextColor(parseColor(dynamicColor(value)));
            } else if (token.equals("font-bold") && view instanceof TextView) ((TextView) view).setTypeface(null, 1);
            else if (token.startsWith("opacity-")) {
                try { view.setAlpha(Math.max(0f, Math.min(1f, Integer.parseInt(token.substring(8)) / 100f))); }
                catch (NumberFormatException ignored) { }
            } else if (token.equals("flex-row") && view instanceof LinearLayout) ((LinearLayout) view).setOrientation(LinearLayout.HORIZONTAL);
            else if (token.equals("flex-col") && view instanceof LinearLayout) ((LinearLayout) view).setOrientation(LinearLayout.VERTICAL);
        }
    }

    private String dynamicColor(String name) {
        if (name.startsWith("#") || name.startsWith("rgb") || name.startsWith("rgba")) return name;
        if (dynamicStyleTokens != null && dynamicStyleTokens.has(name)) return dynamicStyleTokens.optString(name, name);
        Map<String, String> colors = new HashMap<>();
        colors.put("white", "#ffffff"); colors.put("black", "#000000");
        colors.put("slate-100", "#f1f5f9"); colors.put("slate-500", "#64748b"); colors.put("slate-900", "#0f172a");
        colors.put("gray-50", "#f9fafb"); colors.put("gray-100", "#f3f4f6"); colors.put("gray-500", "#6b7280"); colors.put("gray-700", "#374151"); colors.put("gray-900", "#111827");
        colors.put("blue-50", "#eff6ff"); colors.put("blue-100", "#dbeafe"); colors.put("blue-500", "#3b82f6"); colors.put("blue-600", "#2563eb"); colors.put("blue-700", "#1d4ed8"); colors.put("blue-900", "#1e3a8a");
        colors.put("emerald-50", "#ecfdf5"); colors.put("emerald-500", "#10b981"); colors.put("emerald-700", "#047857"); colors.put("emerald-900", "#064e3b");
        colors.put("red-600", "#dc2626"); colors.put("green-600", "#16a34a"); colors.put("amber-500", "#f59e0b"); colors.put("rose-500", "#f43f5e");
        return colors.getOrDefault(name, name);
    }

    private LinearLayout.LayoutParams childParams(JSONObject parentStyle, JSONObject childStyle) throws JSONException {
        boolean row = parentStyle != null && "row".equals(parentStyle.optString("flexDirection"));
        boolean grid = parentStyle != null && parentStyle.optInt("gridColumns", 0) > 0;
        int width = dimension(childStyle, "width", row ? ViewGroup.LayoutParams.WRAP_CONTENT : ViewGroup.LayoutParams.MATCH_PARENT);
        int height = dimension(childStyle, "height", ViewGroup.LayoutParams.WRAP_CONTENT);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(width, height);
        if (!grid && childStyle != null && (childStyle.has("flex") || childStyle.has("flexGrow"))) {
            float weight = childStyle.has("flex") ? (float) childStyle.optDouble("flex", 0) : (float) childStyle.optDouble("flexGrow", 0);
            if (weight > 0) {
                if (row) params.width = 0; else params.height = 0;
                params.weight = weight;
            }
        }
        int axisGap = 0;
        boolean rowGap = false;
        if (parentStyle != null && parentStyle.has("gap")) {
            axisGap = parentStyle.getInt("gap");
            rowGap = "row".equals(parentStyle.optString("flexDirection"));
        }
        if (childStyle != null) {
            int horizontal = childStyle.optInt("marginHorizontal", childStyle.optInt("margin", 0));
            int vertical = childStyle.optInt("marginVertical", childStyle.optInt("margin", 0));
            params.setMargins(
                    childStyle.optInt("marginLeft", horizontal),
                    childStyle.optInt("marginTop", vertical),
                    childStyle.optInt("marginRight", horizontal) + (rowGap ? axisGap : 0),
                    childStyle.optInt("marginBottom", vertical) + (rowGap ? 0 : axisGap)
            );
        } else if (rowGap) {
            params.rightMargin = axisGap;
        } else if (axisGap > 0) {
            params.bottomMargin = axisGap;
        }
        return params;
    }

    private FrameLayout.LayoutParams frameChildParams(JSONObject style) throws JSONException {
        boolean absolute = style != null && "absolute".equals(style.optString("position"));
        int width = dimension(style, "width", absolute ? ViewGroup.LayoutParams.WRAP_CONTENT : ViewGroup.LayoutParams.MATCH_PARENT);
        int height = dimension(style, "height", ViewGroup.LayoutParams.WRAP_CONTENT);
        if (style != null && style.has("inset")) {
            width = ViewGroup.LayoutParams.MATCH_PARENT;
            height = ViewGroup.LayoutParams.MATCH_PARENT;
        }
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(width, height);
        if (style == null) return params;
        int left = style.has("inset") ? style.optInt("inset", 0) : style.optInt("insetLeft", 0);
        int top = style.has("inset") ? style.optInt("inset", 0) : style.optInt("insetTop", 0);
        int right = style.has("inset") ? style.optInt("inset", 0) : style.optInt("insetRight", 0);
        int bottom = style.has("inset") ? style.optInt("inset", 0) : style.optInt("insetBottom", 0);
        if (style.has("left")) left = style.optInt("left", left);
        if (style.has("top")) top = style.optInt("top", top);
        if (style.has("right")) right = style.optInt("right", right);
        if (style.has("bottom")) bottom = style.optInt("bottom", bottom);
        params.leftMargin = left;
        params.topMargin = top;
        params.rightMargin = right;
        params.bottomMargin = bottom;
        if (style.has("right") && !style.has("left")) params.gravity |= Gravity.RIGHT;
        if (style.has("bottom") && !style.has("top")) params.gravity |= Gravity.BOTTOM;
        return params;
    }

    private int dimension(JSONObject style, String key, int fallback) throws JSONException {
        if (style == null || !style.has(key)) return fallback;
        Object value = style.get(key);
        if ("fill".equals(value) || "screen".equals(value)) return ViewGroup.LayoutParams.MATCH_PARENT;
        if (value instanceof Number) return ((Number) value).intValue();
        return fallback;
    }

    private int parseColor(String value) {
        try { return Color.parseColor(value); } catch (IllegalArgumentException ignored) { return Color.TRANSPARENT; }
    }
}
