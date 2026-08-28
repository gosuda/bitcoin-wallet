package address

import (
	"encoding/hex"

	"github.com/gosuda/btctxbuilder/types"
)

func GenerateAddress(addrType types.AddrType) (privHex string, pubHex string, addr string, err error) {
	var priv, pub []byte
	switch addrType {
	case types.P2TR:
		signer, err := types.NewSchnorrSigner("")
		if err != nil {
			return "", "", "", err
		}
		priv = signer.PrivKey()
		pub = signer.PubKey()
	case types.P2PK, types.P2PKH, types.P2WPKH, types.P2SH, types.P2WPKH_NESTED:
		signer, err := types.NewECDSASigner("")
		if err != nil {
			return "", "", "", err
		}
		priv = signer.PrivateKey()
		pub = signer.PubKey()
	}

	addr, err = types.PubKeyToAddr(pub, addrType, types.GetParams(types.BTC_Testnet3))
	if err != nil {
		return "", "", "", err
	}
	return hex.EncodeToString(priv), hex.EncodeToString(pub), addr, nil
}
