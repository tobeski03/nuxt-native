package com.nuxtnative.prototype;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private static final int BLUE = Color.rgb(37, 99, 235);
    private static final int GRAY_50 = Color.rgb(249, 250, 251);

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(renderProfilePage());
    }

    // This is the first native renderer target. The eventual compiler will emit
    // an equivalent view tree from examples/profile.vue.
    private View renderProfilePage() {
        LinearLayout screen = column(GRAY_50, 20, 24, 20, 24);

        TextView title = text("Your profile", 24, Color.rgb(17, 24, 39));
        title.setTypeface(null, 1);
        screen.addView(title, params(-1, -2, 0, 0, 0, 20));

        TextView description = text("A native Android page authored with Nuxt conventions.", 14, Color.rgb(107, 114, 128));
        screen.addView(description, params(-1, -2, 0, 0, 0, 20));

        EditText name = new EditText(this);
        name.setHint("Your name");
        name.setSingleLine(true);
        screen.addView(name, params(-1, -2, 0, 0, 0, 20));

        Button save = new Button(this);
        save.setText("Save changes");
        save.setTextColor(Color.WHITE);
        save.setBackgroundColor(BLUE);
        save.setOnClickListener(view -> {
            save.setText("Saved");
            save.setEnabled(false);
        });
        screen.addView(save, params(-1, -2, 0, 0, 0, 0));

        return screen;
    }

    private LinearLayout column(int background, int left, int top, int right, int bottom) {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(background);
        layout.setPadding(left, top, right, bottom);
        return layout;
    }

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private LinearLayout.LayoutParams params(int width, int height, int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams result = new LinearLayout.LayoutParams(width, height);
        result.setMargins(left, top, right, bottom);
        return result;
    }
}
