package client

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/gosuda/btctxbuilder/types"
	"github.com/stretchr/testify/require"
)

func TestGetBestBlock(t *testing.T) {
	client, err := NewClient(types.BTC)
	require.NoError(t, err)

	height, err := client.BestBlockHeight()
	require.NoError(t, err)
	fmt.Println("height:", height)

	hash, err := client.BestBlockHash()
	require.NoError(t, err)

	fmt.Println("hash:", hash)

	block, err := client.GetBlock(hash)
	require.NoError(t, err)

	fmt.Println("block:", block)

	txs, err := client.GetBlockTx(hash, 0)
	require.NoError(t, err)
	for _, tx := range txs {
		fmt.Println(tx.Txid)
		// rawTx, err := client.GetRawTx(tx.Txid)
		require.NoError(t, err)
		// fmt.Println("rawTx:", string(rawTx))
		for _, vout := range tx.Vout {
			fmt.Printf("%s ", vout.ScriptpubkeyType)
		}
		fmt.Println()
	}
}

func TestGetBlock(t *testing.T) {
	client, err := NewClient(types.BTC)
	require.NoError(t, err)

	blockHash, err := client.GetBlockHashByHeight(800000)
	require.NoError(t, err)
	require.Equal(t, "00000000000000000002a7c4c1e48d76c5a37902165a270156b7a8d72728a054", blockHash)

	block, err := client.GetBlock(blockHash)
	require.NoError(t, err)
	fmt.Println("block:", block)
}

// transaction example
// p2pkh : ef796f3cef041768d37a34a469d72e5c91de568f963eae6daf3480fe8405e2ed
// v0_p2wpkh : 6c9f507a64cfec9ef96de41680af40c84607d71b62eac7f7f2a406a597c8c582
// p2sh : 6216b12925f9bf817679e4cbaae35e1f5b8da997dc8b12603c6de7dd965af5c1
// v0_p2wsh : ca31304e07751c96dfc9c48812a3404759fb31c89694efc27cbe1a72d1d439d8
// v1_p2tr : dcf80b086238982841bfc382a5a567c8f6898878db44d9da0d3726edc7bb7211
func TestGetTx(t *testing.T) {
	client, err := NewClient(types.BTC)
	require.NoError(t, err)

	tx, err := client.GetTx("6c9f507a64cfec9ef96de41680af40c84607d71b62eac7f7f2a406a597c8c582")
	require.NoError(t, err)

	txJson, _ := json.MarshalIndent(tx, "", "\t")
	fmt.Println(string(txJson))

	for _, vin := range tx.Vin {
		if vin.Prevout != nil {
			fmt.Println("prev vout value :", vin.Prevout.Value)
			fmt.Println("prev vout scriptpubkey :", vin.Prevout.Scriptpubkey)
			fmt.Println("prev vout scriptpubkey asm :", vin.Prevout.ScriptpubkeyAsm)
			fmt.Println("type :", vin.Prevout.ScriptpubkeyType)
		}

		fmt.Println("vin script sig :", vin.Scriptsig)
		fmt.Println("vin script sig asm :", vin.ScriptsigAsm)
		fmt.Println("vin witness :", vin.Witness)
		fmt.Println("vin sequence :", vin.Sequence)
		fmt.Println()
	}

	for _, vout := range tx.Vout {
		fmt.Println("vout scriptpubkey :", vout.Scriptpubkey)
		fmt.Println("vout scriptpubkey asm :", vout.ScriptpubkeyAsm)
		fmt.Println("vout scriptpubkey type :", vout.ScriptpubkeyType)
		fmt.Println("vout scriptpubkey address :", vout.ScriptpubkeyAddress)
		fmt.Println("vout value :", vout.Value)
		fmt.Println()
	}

}

// fromPrivKeyHex := "a6018c89646f3c7596516544602283135e8d6e5b31421e335b91b86ae9c76409"
// fromPrivKey, _ := hex.DecodeString(fromPrivKeyHex)
// fromPubKey := "0248d7c76f23e387bb151e6094590eb8f7777a8efbea9d0a5ddd1ea1833fa3925c"
// fromAddress := "n368zCWREFiRRX7icJRBb6n8nMsjJjNVK8"
// toAddress := "tb1plt7057su6z39qjqtnvnnw7d6htdwulqm93mtpddj5wcetwxcv2nsm6geal"
func TestGetBalance(t *testing.T) {
	client, err := NewClient(types.BTC_Signet)
	require.NoError(t, err)

	addr, err := client.GetAddress("n368zCWREFiRRX7icJRBb6n8nMsjJjNVK8")
	require.NoError(t, err)
	fmt.Println(addr.Address)
	fmt.Println("funded sat :", addr.ChainStats.FundedTxoSum)
	fmt.Println("spent sat :", addr.ChainStats.SpentTxoSum)
	fmt.Println("balance :", addr.ChainStats.FundedTxoSum-addr.ChainStats.SpentTxoSum)
	fmt.Println("tx count :", addr.ChainStats.TxCount)

}
func TestGetUtxo(t *testing.T) {
	client, err := NewClient(types.BTC_Signet)
	require.NoError(t, err)

	utxos, err := client.GetUTXO("024bbe77b1699f7acaa5d2602ed2e9cab9f3c8a547da357c3f670ce2c22727d466")
	require.NoError(t, err)

	fmt.Println(utxos)

	for _, utxo := range utxos {
		fmt.Println(utxo)
	}
}

func TestFeeEstimate(t *testing.T) {
	client, err := NewClient(types.BTC_Signet)
	require.NoError(t, err)

	fee, err := client.FeeEstimate()
	require.NoError(t, err)

	fmt.Println(fee)
}

func TestBroadCastTx(t *testing.T) {
	client, err := NewClient(types.BTC_Signet)
	require.NoError(t, err)

	tx := "010000000351cd1f8fa5e8bc5a23d6889bc51fac974e6c4d04d70e4ccbe9dfacfcfe0b2edb0000000049483045022100f7c6f1a021d13454f687eef700ca2edafa8ce61d7e590c5e4086df2dcc5b429e02207461e50882f31a642264631c858a59e7dfb7fd19891e7ae535f60b8a411cd7e501ffffffffa49b09c283330454cb586ad94697a3df892fa0162ca28792274c4f9402351f1d000000004847304402201a17bc8ca5d0214ec6cf7bc98ee13e82962464ba063bce8a60781defb33e7ba5022060d9ba886589b4e5cc837e940f032a8619106fac19bd5fe5e1e432103596f2a601ffffffffed5bd0c33a3d776d1a98b15ff6e0b802a3fef26486e4394b25f6711c14f942e02e00000048473044022068581b3a07deaf9d6d285e0f0238de6ea9e751172186a14eeffddbc9003cf8e502206263c4889ead0d3f519969af53d21fd6cb45c9b5c9cd2daef1a5cfdcab8df9fa01ffffffff0258020000000000001976a914eca14b26ef6056bf1011137061a5ffdbecba4c6188ac180e0000000000002321024bbe77b1699f7acaa5d2602ed2e9cab9f3c8a547da357c3f670ce2c22727d466ac00000000"

	rawTx, err := types.DecodeRawTransaction(tx)
	require.NoError(t, err)
	fmt.Println("txid :", rawTx.TxID())
	for _, txIn := range rawTx.TxIn {
		fmt.Println("\tvin hash  :", txIn.PreviousOutPoint.Hash)
		fmt.Println("\tvin index :", txIn.PreviousOutPoint.Index)
		fmt.Println("\tvin sig :", txIn.SignatureScript)
		fmt.Println("\tvin witness :", txIn.Witness)
		fmt.Println("\tvin sequence :", txIn.Sequence)
	}
	for _, txOut := range rawTx.TxOut {
		fmt.Println("\tvout script :", txOut.PkScript)
		fmt.Println("\tvout value  :", txOut.Value)
	}

	res, err := client.BroadcastTx(tx)
	require.NoError(t, err)
	fmt.Println("result:", res)
}
