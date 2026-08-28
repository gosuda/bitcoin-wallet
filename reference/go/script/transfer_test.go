package script

import (
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/stretchr/testify/require"

	"github.com/gosuda/btctxbuilder/types"
)

func TestEncodeTransferScript(t *testing.T) {
	for _, test := range []struct {
		addrType types.AddrType
		network  types.Network
	}{
		// from public key
		{types.P2PKH, types.BTC_Testnet3},
		{types.P2WPKH, types.BTC_Testnet3},
		{types.P2WPKH_NESTED, types.BTC_Testnet3},
		{types.P2TR, types.BTC_Testnet3},
	} {
		// make params and address
		param := types.GetParams(test.network)
		privKey, err := btcec.NewPrivateKey()
		require.NoError(t, err)
		pubKey := privKey.PubKey().SerializeUncompressed()
		addr, err := types.PubKeyToAddr(pubKey, test.addrType, param)
		require.NoError(t, err)

		// encode address to script
		decodeAddr, _, err := types.DecodeAddress(addr, param)
		require.NoError(t, err)
		script, err := EncodeTransferScript(decodeAddr)
		require.NoError(t, err)

		// decode script to address
		decodedAddress, err := DecodeTransferScript(script, param)
		require.NoError(t, err)
		require.Equal(t, addr, decodedAddress.EncodeAddress())
	}
}
