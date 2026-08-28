package transaction

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/gosuda/btctxbuilder/types"
)

// p2pk
// PrivKey := f7da598ef504fb1638484b05cc3dba7c943ebd03ccf6794707e7950724141011
// Public Key := 024bbe77b1699f7acaa5d2602ed2e9cab9f3c8a547da357c3f670ce2c22727d466
// Address := 024bbe77b1699f7acaa5d2602ed2e9cab9f3c8a547da357c3f670ce2c22727d466

// p2pkh
// PrivKeyHex := "a6018c89646f3c7596516544602283135e8d6e5b31421e335b91b86ae9c76409"
// PrivKey, _ := hex.DecodeString(PrivKeyHex)
// PubKey := "0248d7c76f23e387bb151e6094590eb8f7777a8efbea9d0a5ddd1ea1833fa3925c"
// Address := "n368zCWREFiRRX7icJRBb6n8nMsjJjNVK8"

// p2wpkh
// PrivKeyHex := 887ad33f247a7df59f1bf61b6aa69ab2a537c0708d7d6fb6614e10511fca377b
// PubKeyHex := 023c53ee7749c3466415bd8f8b644227b4eb4eaf2339abbb0f1e44e035ea06b21f
// Address := tb1q307vt2zz3f66hhs90p0le2pp6r53tvyqnzsy42

// np2wpkh
// PrivKeyHex := 36a9efbd34ee20d8640cc88be12760984bf04557bfe1f8b7b9d7b51fdaf4e69c
// PubKeyHex := 02e4362efc65525318bc25e1c35162a2761cc8daea92758e373bf7664007c6ab22
// Address := 2N234Z7UX4kGSTVRmusC5J5GrjdY4JNwhfy

// p2tr
// PrivKeyHex := "49b8dbd365939908d920ab74aec8ec9cb3b7d49d252e1aec3ef59bed0f801acc"
// PrivKey, _ := hex.DecodeString(PrivKeyHex)
// Address := "tb1plt7057su6z39qjqtnvnnw7d6htdwulqm93mtpddj5wcetwxcv2nsm6geal"

// DONE : p2pk / p2pkh / p2wpkh / p2tr ( need utxo input for p2pk )
// TODO : np2wpkh, p2sh, p2wsh, np2wsh...??

func TestTransfer(t *testing.T) {
	for _, test := range []struct {
		net         types.Network
		fromPrivKey string
		fromPubKey  string
		fromAddress string
		toAddress   string
		toAmount    int64
		utxos       []*types.Utxo
	}{
		// p2pk to p2pkh
		{
			types.BTC_Signet,
			"f7da598ef504fb1638484b05cc3dba7c943ebd03ccf6794707e7950724141011",
			"024bbe77b1699f7acaa5d2602ed2e9cab9f3c8a547da357c3f670ce2c22727d466",
			"024bbe77b1699f7acaa5d2602ed2e9cab9f3c8a547da357c3f670ce2c22727d466",
			"n368zCWREFiRRX7icJRBb6n8nMsjJjNVK8",
			600,
			[]*types.Utxo{
				{
					Txid:  "db2e0bfefcacdfe9cb4c0ed7044d6c4e97ac1fc59b88d6235abce8a58f1fcd51",
					Vout:  0,
					Value: 1500,
				},
				{
					Txid:  "1d1f3502944f4c279287a22c16a02f89dfa39746d96a58cb54043383c2099ba4",
					Vout:  0,
					Value: 1500,
				},
				{
					Txid:  "e042f9141c71f6254b39e48664f2fea302b8e0f65fb1981a6d773d3ac3d05bed",
					Vout:  46,
					Value: 2000,
				},
			},
		},

		// p2pkh to p2pk
		// {
		// 	types.BTC_Signet,
		// 	"a6018c89646f3c7596516544602283135e8d6e5b31421e335b91b86ae9c76409",
		// 	"0248d7c76f23e387bb151e6094590eb8f7777a8efbea9d0a5ddd1ea1833fa3925c",
		// 	"n368zCWREFiRRX7icJRBb6n8nMsjJjNVK8",
		// 	"024bbe77b1699f7acaa5d2602ed2e9cab9f3c8a547da357c3f670ce2c22727d466",
		// 	1500, nil,
		// },

		// p2pkh to p2wpkh
		// {
		// 	types.BTC_Signet,
		// 	"a6018c89646f3c7596516544602283135e8d6e5b31421e335b91b86ae9c76409",
		// 	"0248d7c76f23e387bb151e6094590eb8f7777a8efbea9d0a5ddd1ea1833fa3925c",
		// 	"n368zCWREFiRRX7icJRBb6n8nMsjJjNVK8",
		// 	"tb1q307vt2zz3f66hhs90p0le2pp6r53tvyqnzsy42",
		// 	1500, nil,
		// },

		// p2wpkh to np2wpkh
		// {
		// 	types.BTC_Signet,
		// 	"887ad33f247a7df59f1bf61b6aa69ab2a537c0708d7d6fb6614e10511fca377b",
		// 	"023c53ee7749c3466415bd8f8b644227b4eb4eaf2339abbb0f1e44e035ea06b21f",
		// 	"tb1q307vt2zz3f66hhs90p0le2pp6r53tvyqnzsy42",
		// 	"2N234Z7UX4kGSTVRmusC5J5GrjdY4JNwhfy",
		// 	500, nil,
		// },

		// np2wpkh to p2tr - TODO. need redeem script generation
		// {
		// 	types.BTC_Signet,
		// 	"36a9efbd34ee20d8640cc88be12760984bf04557bfe1f8b7b9d7b51fdaf4e69c",
		// 	"02e4362efc65525318bc25e1c35162a2761cc8daea92758e373bf7664007c6ab22",
		// 	"2N234Z7UX4kGSTVRmusC5J5GrjdY4JNwhfy",
		// 	"tb1plt7057su6z39qjqtnvnnw7d6htdwulqm93mtpddj5wcetwxcv2nsm6geal",
		// 	1500, nil,
		// },

		// p2tr to p2pkh
		// {
		// 	types.BTC_Signet,
		// 	"49b8dbd365939908d920ab74aec8ec9cb3b7d49d252e1aec3ef59bed0f801acc",
		// 	"0248d7c76f23e387bb151e6094590eb8f7777a8efbea9d0a5ddd1ea1833fa3925c",
		// 	"tb1plt7057su6z39qjqtnvnnw7d6htdwulqm93mtpddj5wcetwxcv2nsm6geal",
		// 	"n368zCWREFiRRX7icJRBb6n8nMsjJjNVK8",
		// 	1500, nil,
		// },
	} {
		signer, err := types.NewECDSASigner(test.fromPrivKey)
		require.NoError(t, err)
		params := types.GetParams(test.net)
		signedTxRaw, err := NewTransferTx(params, test.utxos, test.fromAddress, map[string]int64{test.toAddress: test.toAmount}, signer.Sign, signer.PubKey(), 0.0001)
		require.NoError(t, err)

		// verify tx
		// pub, err := secp256k1.ParsePubKey(utils.MustDecode(fromPubKey))
		// require.NoError(t, err)
		// valid, err := VerifyTx(params, signedPacket, pub)
		// require.NoError(t, err)
		// fmt.Println(valid)

		signedTxHex := hex.EncodeToString(signedTxRaw)
		fmt.Println(signedTxHex)

		// txid, err := c.BroadcastTx(signedTxHex)
		// require.NoError(t, err)
		// fmt.Println("txid:", txid)

		newTx, err := types.DecodeRawTransaction(signedTxHex)
		require.NoError(t, err)

		jsonNewTx, _ := json.MarshalIndent(newTx, "", "\t")
		fmt.Println(string(jsonNewTx))
	}
}
