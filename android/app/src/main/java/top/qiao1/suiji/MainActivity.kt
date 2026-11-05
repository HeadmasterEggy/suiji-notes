package top.qiao1.suiji

import android.app.Activity
import android.app.DownloadManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import org.json.JSONObject

// 随记 for Android: the web app in a full-screen WebView, like the Mac app. The page itself (and its offline
// cache) comes from the site, so a deploy updates the app. Native parts: back button, file picking, downloads,
// system bar colours, and a launcher icon that follows the style picked in Settings.
class MainActivity : Activity() {
  private val home = Uri.parse(BuildConfig.HOME)
  private lateinit var root: FrameLayout
  private lateinit var web: WebView
  private var picking: ValueCallback<Array<Uri>>? = null
  private var style: String? = null   // the style the launcher icon should show; applied when the app is left

  override fun onCreate(saved: Bundle?) {
    super.onCreate(saved)
    root = FrameLayout(this)
    web = WebView(this)
    root.addView(web)
    setContentView(root)
    // Draw behind the system bars and pad the page by their size (and the keyboard's), filled with the page colour.
    if (Build.VERSION.SDK_INT >= 30) {
      window.setDecorFitsSystemWindows(false)
      root.setOnApplyWindowInsetsListener { v, insets ->
        val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout())
        v.setPadding(b.left, b.top, b.right, b.bottom)
        WindowInsets.CONSUMED
      }
    }

    web.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      allowFileAccess = false
      setSupportMultipleWindows(false)   // target=_blank links come through shouldOverrideUrlLoading
      userAgentString = "$userAgentString SuijiAndroid/${packageManager.getPackageInfo(packageName, 0).versionName}"
    }
    CookieManager.getInstance().setAcceptCookie(true)
    web.addJavascriptInterface(Bridge(), "suijiAndroid")
    web.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, r: WebResourceRequest): Boolean {
        val url = r.url
        if (url.host == home.host) return false
        if (url.path?.contains("/storage/v1/object/") == true && url.getQueryParameter("download") != null) download(url.toString(), null, null)
        else try { startActivity(Intent(Intent.ACTION_VIEW, url)) } catch (_: Exception) {}
        return true
      }
      override fun onReceivedError(view: WebView, r: WebResourceRequest, e: WebResourceError) {
        // Only before the first visit (no offline copy yet): say so, and try again on a tap.
        if (!r.isForMainFrame) return
        view.loadDataWithBaseURL(null, OFFLINE, "text/html", "utf-8", null)
      }
    }
    web.webChromeClient = object : WebChromeClient() {
      override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams): Boolean {
        picking?.onReceiveValue(null)
        picking = cb
        val pick = p.createIntent().putExtra(Intent.EXTRA_ALLOW_MULTIPLE, p.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
        return try { startActivityForResult(pick, PICK); true } catch (_: Exception) { picking = null; false }
      }
    }
    web.setDownloadListener { url, _, disposition, mime, _ -> download(url, disposition, mime) }

    if (saved != null) web.restoreState(saved) else web.loadUrl(home.toString())
  }

  // Files the page offers for download go to Downloads, with the system's notification.
  private fun download(url: String, disposition: String?, mime: String?) {
    val name = URLUtil.guessFileName(url, disposition, mime)
    val req = DownloadManager.Request(Uri.parse(url))
      .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
      .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
    if (mime != null) req.setMimeType(mime)
    (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
    Toast.makeText(this, name, Toast.LENGTH_SHORT).show()
  }

  @Deprecated("Activity result API needs AndroidX; this keeps the app dependency-free")
  override fun onActivityResult(code: Int, result: Int, data: Intent?) {
    if (code != PICK) return super.onActivityResult(code, result, data)
    val clip = data?.clipData
    val uris = when {
      result != RESULT_OK -> null
      clip != null -> Array(clip.itemCount) { clip.getItemAt(it).uri }
      data?.data != null -> arrayOf(data.data!!)
      else -> null
    }
    picking?.onReceiveValue(uris); picking = null
  }

  // Back closes what the page has open (settings, a menu, the outline) or goes from a document to the
  // sidebar (window.suijiBack in app.js); with nothing left the app goes to the background.
  @Deprecated("Predictive back is not opted into, so this is still called")
  override fun onBackPressed() {
    web.evaluateJavascript("window.suijiBack ? window.suijiBack() : false") { handled ->
      if (handled == "true") return@evaluateJavascript
      if (web.canGoBack()) web.goBack() else moveTaskToBack(true)
    }
  }

  override fun onSaveInstanceState(out: Bundle) { super.onSaveInstanceState(out); web.saveState(out) }

  override fun onStop() {
    super.onStop()
    CookieManager.getInstance().flush()
    style?.let { setIcon(it) }
  }

  // Switching the enabled launcher alias while the app is on screen can close it on some launchers,
  // so this waits until the app is in the background.
  private val aliases = mapOf("paper" to "Paper", "terminal" to "Terminal", "blocks" to "Blocks", "ink" to "Ink", "eink" to "Eink", "notebook" to "Notebook", "swiss" to "Swiss", "neon" to "Neon", "blueprint" to "Blueprint", "clay" to "Clay", "sunset" to "Sunset", "eyecare" to "Eyecare")
  private fun setIcon(s: String) {
    val want = aliases[s] ?: "Glass"
    for (a in aliases.values + "Glass") {
      val c = ComponentName(this, "top.qiao1.suiji.$a")   // the class name, not packageName (debug builds add .debug)
      val state = if (a == want) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
      if (packageManager.getComponentEnabledSetting(c) != state) packageManager.setComponentEnabledSetting(c, state, PackageManager.DONT_KILL_APP)
    }
  }

  inner class Bridge {
    // The tap on the "no connection" page.
    @JavascriptInterface fun retry() { runOnUiThread { web.loadUrl(home.toString()) } }

    // {style, bg, dark}: sent by the page whenever its style or light / dark changes.
    @JavascriptInterface fun post(json: String) {
      val m = try { JSONObject(json) } catch (_: Exception) { return }
      runOnUiThread {
        style = m.optString("style", "")
        val bg = try { Color.parseColor(m.optString("bg")) } catch (_: Exception) { null }
        if (bg != null) { root.setBackgroundColor(bg); window.setBackgroundDrawable(null) }
        @Suppress("DEPRECATION")
        if (bg != null && Build.VERSION.SDK_INT < 30) { window.statusBarColor = bg; window.navigationBarColor = bg }
        barIcons(light = !m.optBoolean("dark"))
      }
    }
  }

  // Dark icons on a light page, light icons on a dark one.
  private fun barIcons(light: Boolean) {
    if (Build.VERSION.SDK_INT >= 30) {
      val mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
      window.insetsController?.setSystemBarsAppearance(if (light) mask else 0, mask)
    } else {
      @Suppress("DEPRECATION")
      window.decorView.systemUiVisibility = if (light) View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR else 0
    }
  }

  companion object {
    const val PICK = 1
    val OFFLINE = """<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;height:100vh;display:grid;place-items:center;font:16px system-ui;color:#555;text-align:center"
      onclick="suijiAndroid.retry()"><div><b style="font-size:22px;color:#111">随记</b><p>连不上网络，联网后点一下重试<br>No connection. Tap to try again.</p></div>"""
  }
}
