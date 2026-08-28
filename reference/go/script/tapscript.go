package script

import (
	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
	"github.com/btcsuite/btcd/btcutil"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/btcsuite/btcd/txscript"
	"github.com/btcsuite/btcd/wire"
)

func GetTapScriptAddress(pk *btcec.PublicKey, revealedScript []byte, net *chaincfg.Params) (btcutil.Address, error) {
	pubkey33 := pk.SerializeCompressed()
	if pubkey33[0] == 0x02 {
		pubkey33[0] = byte(txscript.BaseLeafVersion)
	} else {
		pubkey33[0] = byte(txscript.BaseLeafVersion) + 1
	}

	controlBlock, err := txscript.ParseControlBlock(
		pubkey33,
	)
	if err != nil {
		return nil, err
	}
	rootHash := controlBlock.RootHash(revealedScript)

	// Next, we'll construct the final commitment (creating the external or
	// taproot output key) as a function of this commitment and the
	// included internal key: taprootKey = internalKey + (tPoint*G).
	taprootKey := txscript.ComputeTaprootOutputKey(
		controlBlock.InternalKey, rootHash,
	)

	// If we convert the taproot key to a witness program (we just need to
	// serialize the public key), then it should exactly match the witness
	// program passed in.
	tapKeyBytes := schnorr.SerializePubKey(taprootKey)

	addr, err := btcutil.NewAddressTaproot(
		tapKeyBytes,
		net,
	)
	return addr, nil
}

func IsTapScript(witness wire.TxWitness) bool {
	if len(witness) != 3 {
		return false
	}
	witness2 := witness[2]
	if len(witness2) == 33 && (witness2[0] == 0xc0 || witness2[0] == 0xc1) {
		return true
	}
	return false
}
