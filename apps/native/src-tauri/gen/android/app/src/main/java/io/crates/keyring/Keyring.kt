package io.crates.keyring

import android.content.Context

/**
 * Hands the Android application context to the Rust credential store.
 *
 * `android-native-keyring-store` reaches the Android Keystore through
 * `ndk_context`, which somebody has to initialise. Its README says Tauri Mobile
 * already does — that is out of date: tao dropped the call after 0.34, and
 * Tauri 2.11 ships tao 0.35, so nothing initialises it and the store panics
 * with "android context was not initialized".
 *
 * The JNI symbol this binds to is already exported from the app's own library,
 * because the crate is linked into it — so there is no second `.so` to ship,
 * only this declaration. `loadLibrary` is idempotent and makes the call safe
 * regardless of whether `Rust.kt` has been touched yet.
 */
class Keyring {
    companion object {
        init {
            System.loadLibrary("bitcoin_wallet_app_lib")
        }

        external fun initializeNdkContext(context: Context)
    }
}
