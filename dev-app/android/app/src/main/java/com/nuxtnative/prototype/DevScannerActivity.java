package com.nuxtnative.prototype;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;

public final class DevScannerActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        startScanner();
    }

    private void startScanner() {
        IntentIntegrator scanner = new IntentIntegrator(this);
        scanner.setDesiredBarcodeFormats(IntentIntegrator.QR_CODE);
        scanner.setPrompt("Scan the Nuxt-native QR code");
        scanner.setBeepEnabled(true);
        scanner.setOrientationLocked(true);
        scanner.setCaptureActivity(com.journeyapps.barcodescanner.CaptureActivity.class);
        scanner.initiateScan();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        IntentResult result = IntentIntegrator.parseActivityResult(requestCode, resultCode, data);
        if (result != null) {
            if (result.getContents() == null) {
                finish();
                return;
            }
            try {
                Uri connection = Uri.parse(result.getContents());
                if (!"nuxtnative".equalsIgnoreCase(connection.getScheme()) || !"connect".equalsIgnoreCase(connection.getHost())) {
                    throw new IllegalArgumentException("Not a Nuxt-native connection QR code");
                }
                Intent launch = new Intent(this, MainActivity.class);
                launch.setData(connection);
                startActivity(launch);
                finish();
            } catch (Exception error) {
                Toast.makeText(this, "That QR code is not a Nuxt-native connection", Toast.LENGTH_LONG).show();
                startScanner();
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }
}
