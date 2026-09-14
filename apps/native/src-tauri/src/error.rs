//! IPC error envelope: `{ code, message, details? }`. Never carries key
//! material — `details` only ever holds what `wallet_core::Error::details`
//! puts there, which is amounts and reasons, not secrets.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl AppError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("internal", message)
    }
}

impl From<wallet_core::Error> for AppError {
    fn from(e: wallet_core::Error) -> Self {
        // The core owns the code table, so the browser build and this shell
        // report the same names — and the same structured details — for the
        // same failures.
        Self {
            code: e.code(),
            message: e.to_string(),
            details: e.details(),
        }
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
