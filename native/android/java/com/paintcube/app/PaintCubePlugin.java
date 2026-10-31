package com.paintcube.app;

import android.content.Context;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;
import java.util.Set;

/**
 * Paint Cube's bridge to the phone: reads the tutorials aloud with the phone's own
 * English voice (Android's WebView has no speech of its own). The web side lives in
 * src/platform/voice.ts.
 */
@CapacitorPlugin(name = "PaintCube")
public class PaintCubePlugin extends Plugin {

    private TextToSpeech tts;
    private boolean ready = false;
    /** A line asked for before the speech engine was ready; spoken as soon as it is. */
    private String pending = null;
    private float pendingRate = 1.0f;

    @Override
    public void load() {
        Context ctx = getContext().getApplicationContext();
        tts = new TextToSpeech(ctx, status -> {
            if (status != TextToSpeech.SUCCESS || tts == null) return;
            Locale[] wanted = { new Locale("en", "IN"), Locale.UK, Locale.US, Locale.ENGLISH };
            for (Locale l : wanted) {
                int r = tts.setLanguage(l);
                if (r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED) {
                    ready = true;
                    break;
                }
            }
            Voice best = bestVoice();
            if (best != null) tts.setVoice(best);
            if (ready && pending != null) {
                speakNow(pending, pendingRate);
                pending = null;
            }
        });
    }

    /** Clear, natural, offline English voices first (Indian English, then British, then US). */
    private Voice bestVoice() {
        Voice best = null;
        int bestScore = Integer.MIN_VALUE;
        try {
            Set<Voice> all = tts.getVoices();
            if (all == null) return null;
            for (Voice v : all) {
                if (v.getLocale() == null || !"en".equals(v.getLocale().getLanguage())) continue;
                if (v.getFeatures() != null && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                int s = v.getQuality() / 10;
                String c = v.getLocale().getCountry();
                if ("IN".equals(c)) s += 30;
                else if ("GB".equals(c)) s += 20;
                else if ("US".equals(c)) s += 15;
                if (v.isNetworkConnectionRequired()) s -= 12;
                if (s > bestScore) {
                    bestScore = s;
                    best = v;
                }
            }
        } catch (Exception ignored) {
            // Some engines throw before they are ready.
        }
        return best;
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        Double rate = call.getDouble("rate", 1.0);
        float r = rate == null ? 1.0f : rate.floatValue();
        if (tts == null || text == null || text.isEmpty()) {
            call.resolve();
            return;
        }
        if (!ready) {
            pending = text;
            pendingRate = r;
            call.resolve();
            return;
        }
        speakNow(text, r);
        call.resolve();
    }

    private void speakNow(String text, float rate) {
        tts.setSpeechRate(rate);
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "pc");
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        pending = null;
        if (tts != null) tts.stop();
        call.resolve();
    }

    @PluginMethod
    public void speaking(PluginCall call) {
        JSObject r = new JSObject();
        r.put("speaking", tts != null && (tts.isSpeaking() || (!ready && pending != null)));
        call.resolve(r);
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
    }
}
