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
        // The core owns the code table, so the browser build and this shell
        // report the same names for the same failures.
        Self::new(e.code(), e.to_string())
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
