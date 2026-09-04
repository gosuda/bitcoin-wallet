//! IPC error envelope: `{ code, message }`. Never carries key material.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: &'static str,
    pub message: String,
}

impl AppError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("internal", message)
    }
}

impl From<wallet_core::Error> for AppError {
    fn from(e: wallet_core::Error) -> Self {
        use wallet_core::Error as E;
        let code = match &e {
            E::InvalidKey(_) => "invalid_key",
            E::InvalidAddress(_) => "invalid_address",
            E::Descriptor(_) => "descriptor",
            E::Persist(_) => "persist",
            E::Backend(_) => "backend",
            E::BuildTx(_) => "build_tx",
            E::Sign(_) => "sign",
            E::Psbt(_) => "psbt",
            E::Unsupported(_) => "unsupported",
        };
        Self::new(code, e.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        Self::internal(e.to_string())
    }
}

impl From<tauri_plugin_store::Error> for AppError {
    fn from(e: tauri_plugin_store::Error) -> Self {
        Self::new("config", e.to_string())
    }
}

pub type AppResult<T> = std::result::Result<T, AppError>;
