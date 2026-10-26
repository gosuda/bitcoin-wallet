package dev.gosuda.bitcoinwallet

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import io.crates.keyring.Keyring

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Before super: super.onCreate starts the Rust side, which reads the
    // credential store at startup.
    Keyring.initializeNdkContext(applicationContext)

    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}
