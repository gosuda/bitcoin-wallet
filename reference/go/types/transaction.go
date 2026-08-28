package types

import (
	"bytes"
	"fmt"

	"github.com/btcsuite/btcd/wire"

	"github.com/gosuda/btctxbuilder/utils"
)

type TransactionType string

const (
	Transfer TransactionType = "transfer"
	Multisig TransactionType = "multisig"
	Timelock TransactionType = "timelock"

	Ordinals TransactionType = "ordinals"
)

func DecodeRawTransaction(rawTx string) (*wire.MsgTx, error) {
	// Parse the raw transaction
	var rawTxBytes []byte
	if utils.IsHex(rawTx) {
		rawTxBytes = utils.HexMustDecode(rawTx)
	} else {
		rawTxBytes = []byte(rawTx)
	}

	msgTx := wire.NewMsgTx(wire.TxVersion)
	err := msgTx.Deserialize(bytes.NewReader(rawTxBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to deserialize transaction: %w", err)
	}

	return msgTx, nil
}
