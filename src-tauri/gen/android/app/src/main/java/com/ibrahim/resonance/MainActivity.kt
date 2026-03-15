package com.ibrahim.resonance

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // Prevent WebView from throttling JS timers and pausing audio when the app
  // goes to background. onPause normally calls WebView.onPause() which suspends
  // the JS engine — overriding it to skip that keeps audio playing.
  override fun onPause() {
    // Intentionally do NOT call webView?.onPause() so the JS thread keeps running.
    super.onPause()
  }

  override fun onResume() {
    super.onResume()
    // Resume JS execution if it was paused by something else.
    try {
      val field = TauriActivity::class.java.getDeclaredField("webView")
      field.isAccessible = true
      val webView = field.get(this) as? WebView
      webView?.onResume()
    } catch (_: Exception) {}
  }
}
