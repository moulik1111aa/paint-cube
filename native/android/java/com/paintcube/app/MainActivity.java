package com.paintcube.app;

import android.os.Build;
import android.os.Bundle;
import android.view.Display;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    @SuppressWarnings("deprecation")
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugin (the phone's voice) must be registered before the bridge starts.
        registerPlugin(PaintCubePlugin.class);
        super.onCreate(savedInstanceState);
        try {
            WebView web = getBridge() != null ? getBridge().getWebView() : null;
            if (web != null) {
                WebSettings s = web.getSettings();
                // Every label and button is sized for the game's own type: the phone's
                // font-size setting scaled text on top of that and pushed it off screen.
                s.setTextZoom(100);
                s.setMediaPlaybackRequiresUserGesture(false);
                if (Build.VERSION.SDK_INT >= 33) s.setAlgorithmicDarkeningAllowed(false);
                else if (Build.VERSION.SDK_INT >= 29) s.setForceDark(WebSettings.FORCE_DARK_OFF);
            }
        } catch (Exception ignored) {
            // Older WebViews: nothing to change.
        }
        preferHighestRefreshRate();
    }

    /** Ask for the screen's fastest refresh rate (90/120 Hz phones), for smooth animation. */
    private void preferHighestRefreshRate() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        try {
            Window w = getWindow();
            Display d = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? getDisplay() : getWindowManager().getDefaultDisplay();
            if (d == null) return;
            Display.Mode best = d.getMode();
            for (Display.Mode m : d.getSupportedModes()) {
                if (m.getPhysicalWidth() == best.getPhysicalWidth() && m.getPhysicalHeight() == best.getPhysicalHeight()
                        && m.getRefreshRate() > best.getRefreshRate()) best = m;
            }
            WindowManager.LayoutParams p = w.getAttributes();
            p.preferredDisplayModeId = best.getModeId();
            w.setAttributes(p);
        } catch (Exception ignored) {
            // Keep the default rate.
        }
    }
}
