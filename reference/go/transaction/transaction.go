package transaction

import (
	"fmt"

	"github.com/btcsuite/btcd/chaincfg"

	"github.com/gosuda/btctxbuilder/client"
	"github.com/gosuda/btctxbuilder/types"
	"github.com/gosuda/btctxbuilder/utils"
)

func BroadcastTx(
	client *client.Client,
	fromAddress string,
	toAddress map[string]int64,
	privkeyHex string,
) (txid string, err error) {
	params := client.GetParams()
	utxos, err := client.GetUTXOWithRawTx(fromAddress)
	if err != nil {
		return "", fmt.Errorf("Failed to fetch UTXOs: %s", err)
	}
	feeEstimate, err := client.FeeEstimate()
	if err != nil {
		return "", fmt.Errorf("Failed to fetch fee estimate: %s", err)
	}
	fee := max(0.00001, feeEstimate["6"])
	signer, err := types.NewECDSASigner(privkeyHex)
	if err != nil {
		return "", err
	}

	rawTx, err := NewTransferTx(
		params,
		utxos,
		fromAddress,
		toAddress,
		signer.Sign,
		signer.PubKey(),
		fee,
	)
	if err != nil {
		return "", err
	}

	txid, err = client.BroadcastTx(utils.HexEncode(rawTx))
	if err != nil {
		return "", fmt.Errorf("Failed to broadcast transaction: %s", err)
	}
	return txid, nil
}

// fee is expected in sat/vB. signer may be nil to return an unsigned PSBT.
func NewTransferTx(
	params *chaincfg.Params,
	utxos []*types.Utxo,
	fromAddress string,
	toAddress map[string]int64,
	signer types.Signer,
	pubkey []byte,
	fee float64,
) (rawTx []byte, err error) {
	return NewTxBuilder(params).
		FeeRate(fee).
		From(fromAddress).
		Change(fromAddress).
		ToMap(toAddress).
		SelectUtxo(utxos).
		Build().
		SignWith(signer, pubkey).
		RawTx()
}

func NewRunestoneEdictTx(params *chaincfg.Params, utxos []*types.Utxo, fromAddress string, toAddress map[string]int64, fundAddress string) {

}
