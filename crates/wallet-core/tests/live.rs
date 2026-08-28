//! Live-network smoke tests. Run with: `cargo test -p wallet-core --test live -- --ignored`

use wallet_core::{AddressType, BackendConfig, KeyMaterial, Network, WalletConfig, WalletHandle};

const KEY: &str = "0000000000000000000000000000000000000000000000000000000000000001";

async fn smoke(backend: BackendConfig) {
    let cfg = WalletConfig {
        network: Network::Signet,
        address_type: AddressType::P2wpkh,
        backend,
        db_path: None,
    };
    let w = WalletHandle::open(cfg, &KeyMaterial::PrivHex(KEY.into())).unwrap();
    assert!(w.chain_height().await.unwrap() > 200_000);
    assert!(w.estimate_fee().await.unwrap().for_target(6).is_some());
    w.sync().await.unwrap();
    let _ = w.balance().unwrap();
    let _ = w.list_utxos().unwrap();
}

#[tokio::test]
#[ignore = "needs network"]
async fn esplora_signet() {
    smoke(BackendConfig::Esplora {
        url: Network::Signet.default_esplora_url().into(),
    })
    .await;
}
