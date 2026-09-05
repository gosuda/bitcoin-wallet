package dev.gosuda.bitcoinwallet

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import io.crates.keyring.Keyring

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Before super: super.onCreate starts the Rust side, which reads the
    // credential store at startup. Without this the store has no Android
    // context and panics across the JNI boundary.
    Keyring.initializeNdkContext(applicationContext)

    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
