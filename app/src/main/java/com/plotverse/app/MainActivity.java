package com.plotverse.app;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.graphics.Color;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.Window;
import android.view.WindowManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {
    private WebView webView;
    private DownloadManager downloadManager;
    private long activeDownloadId = -1L;
    private BroadcastReceiver downloadReceiver;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(11, 11, 14));
        window.setNavigationBarColor(Color.rgb(11, 11, 14));
        window.getDecorView().setSystemUiVisibility(0);
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        downloadManager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        registerDownloadReceiver();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(11, 11, 14));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setDefaultTextEncodingName("UTF-8");
        webView.addJavascriptInterface(new UpdateBridge(), "PlotverseAndroid");
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    private void registerDownloadReceiver() {
        downloadReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
                if (intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L) != activeDownloadId) return;
                DownloadManager.Query query = new DownloadManager.Query().setFilterById(activeDownloadId);
                android.database.Cursor cursor = downloadManager.query(query);
                try {
                    if (cursor == null || !cursor.moveToFirst()) { updateStatus("Не удалось проверить загрузку APK."); return; }
                    int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    if (status != DownloadManager.STATUS_SUCCESSFUL) { updateStatus("Загрузка не удалась. Проверь интернет и повтори попытку."); return; }
                    Uri apkUri = downloadManager.getUriForDownloadedFile(activeDownloadId);
                    if (apkUri == null) { updateStatus("APK скачан, но установщик не получил файл."); return; }
                    runOnUiThread(() -> launchInstaller(apkUri));
                } finally { if (cursor != null) cursor.close(); }
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(downloadReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(downloadReceiver, filter);
    }

    private void launchInstaller(Uri uri) {
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            updateStatus("Разреши установку неизвестных приложений для PLOTVERSE. Затем снова нажми «Проверить обновления».");
            startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            updateStatus("Открыт установщик Android. Подтверди обновление.");
        } catch (Exception e) { updateStatus("Не удалось открыть установщик: " + e.getMessage()); }
    }

    private void updateStatus(String message) {
        if (webView == null) return;
        String quoted = JSONObject.quote(message);
        runOnUiThread(() -> webView.evaluateJavascript("if(window.setUpdateStatus)window.setUpdateStatus(" + quoted + ");", null));
    }

    private class UpdateBridge {
        @JavascriptInterface public String getVersionName() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
            catch (Exception e) { return "unknown"; }
        }
        @JavascriptInterface public void checkAndInstallUpdate() {
            new Thread(() -> {
                HttpURLConnection c = null;
                try {
                    updateStatus("Проверяем последнюю версию…");
                    c = (HttpURLConnection) new URL("https://api.github.com/repos/raeffsky/PLOTVERSE/releases/latest").openConnection();
                    c.setConnectTimeout(15000); c.setReadTimeout(15000);
                    c.setRequestProperty("Accept", "application/vnd.github+json");
                    c.setRequestProperty("User-Agent", "PLOTVERSE-Android");
                    int code = c.getResponseCode();
                    if (code != 200) { updateStatus("Не удалось проверить релиз (HTTP " + code + "). Релиз может ещё не быть опубликован."); return; }
                    StringBuilder sb = new StringBuilder();
                    try (BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) {
                        String line; while ((line = br.readLine()) != null) sb.append(line);
                    }
                    JSONObject release = new JSONObject(sb.toString());
                    String tag = release.optString("tag_name", "");
                    String current = getVersionName();
                    if (tag.equalsIgnoreCase("v" + current) || tag.equalsIgnoreCase(current)) {
                        updateStatus("Установлена последняя версия (" + current + ")."); return;
                    }
                    JSONArray assets = release.optJSONArray("assets");
                    String apk = null;
                    if (assets != null) for (int i = 0; i < assets.length(); i++) {
                        JSONObject asset = assets.getJSONObject(i);
                        if ("PLOTVERSE.apk".equalsIgnoreCase(asset.optString("name"))) {
                            apk = asset.optString("browser_download_url", null); break;
                        }
                    }
                    if (apk == null || apk.isEmpty()) { updateStatus("Релиз " + tag + " найден, но файл PLOTVERSE.apk отсутствует."); return; }
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(apk));
                    request.setTitle("Обновление PLOTVERSE " + tag);
                    request.setDescription("Скачивание обновления");
                    request.setMimeType("application/vnd.android.package-archive");
                    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "PLOTVERSE-update.apk");
                    activeDownloadId = downloadManager.enqueue(request);
                    updateStatus("Найдена версия " + tag + ". Скачивание началось; после загрузки откроется установщик.");
                } catch (Exception e) { updateStatus("Ошибка проверки обновления: " + e.getMessage()); }
                finally { if (c != null) c.disconnect(); }
            }).start();
        }
    }

    @Override protected void onDestroy() {
        if (downloadReceiver != null) try { unregisterReceiver(downloadReceiver); } catch (Exception ignored) {}
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }
}
