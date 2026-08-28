package script

import (
	"github.com/btcsuite/btcd/btcutil"
	"github.com/btcsuite/btcd/txscript"

	"github.com/gosuda/btctxbuilder/types"
)

func EncodeMultiSigScript(network types.Network, pubKeys [][]byte, nRequired int) ([]byte, error) {
	if nRequired <= 1 {
		nRequired = len(pubKeys) - 1
	}

	addrPubKeys := make([]*btcutil.AddressPubKey, 0, len(pubKeys))
	for _, pubKey := range pubKeys {
		addrPubkey, err := btcutil.NewAddressPubKey(pubKey, types.GetParams(network))
		if err != nil {
			return nil, err
		}
		addrPubKeys = append(addrPubKeys, addrPubkey)
	}

	script, err := txscript.MultiSigScript(addrPubKeys, nRequired)
	if err != nil {
		return nil, err
	}
	return script, nil
}

const (
	ScriptVersion = 0
)

func DecodeMultiSigScript(script []byte) ([][]byte, error) {
	tokenizer := txscript.MakeScriptTokenizer(ScriptVersion, script)

	var pubkeys [][]byte = make([][]byte, 0, 16)
	var nRequired int = 0
	for tokenizer.Next() {
		op := tokenizer.Opcode()
		data := tokenizer.Data()

		// parse nRequired opcode for multisig
		if nRequired == 0 && op >= txscript.OP_1 && op <= txscript.OP_16 {
			nRequired = int(op - txscript.OP_1 + 1)
			continue
		}

		if len(data) > 0 && (op == txscript.OP_DATA_33 || op == txscript.OP_DATA_65) {
			pubkeys = append(pubkeys, data)
		}
	}
	if err := tokenizer.Err(); err != nil {
		return nil, err
	}

	return pubkeys, nil
}
