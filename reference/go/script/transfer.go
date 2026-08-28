package script

import (
	"errors"

	"github.com/btcsuite/btcd/btcutil"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/btcsuite/btcd/txscript"
)

func EncodeTransferScript(address btcutil.Address) ([]byte, error) {
	return txscript.PayToAddrScript(address)
}

func DecodeTransferScript(script []byte, params *chaincfg.Params) (btcutil.Address, error) {
	_, addresses, _, err := txscript.ExtractPkScriptAddrs(script, params)
	if err != nil {
		return nil, err
	}
	// only one address is expected
	if len(addresses) != 1 {
		return nil, errors.New("invalid script address")
	}

	return addresses[0], nil
}
