package transaction

import (
	"bytes"

	"github.com/btcsuite/btcd/btcutil"
	"github.com/btcsuite/btcd/btcutil/psbt"
	"github.com/btcsuite/btcd/txscript"
	"github.com/gosuda/btctxbuilder/utils"
)

func DecodePSBT(psbtStr string) (*psbt.Packet, error) {
	var err error
	var psbtRaw []byte

	isHex := utils.IsHex(psbtStr)
	if isHex {
		psbtRaw, err = utils.HexDecode(psbtStr)
		if err != nil {
			return nil, err
		}
	} else {
		psbtRaw = []byte(psbtStr)
	}
	p, err := psbt.NewFromRawBytes(bytes.NewReader(psbtRaw), !isHex)
	if err != nil {
		return nil, err
	}
	return p, nil
}

// PsbtPrevOutputFetcher returns a txscript.PrevOutFetcher built from the UTXO
// information in a PSBT packet.
func PsbtPrevOutputFetcher(packet *psbt.Packet) *txscript.MultiPrevOutFetcher {
	fetcher := txscript.NewMultiPrevOutFetcher(nil)
	for idx, txIn := range packet.UnsignedTx.TxIn {
		in := packet.Inputs[idx]

		// Skip any input that has no UTXO.
		if in.WitnessUtxo == nil && in.NonWitnessUtxo == nil {
			continue
		}

		if in.NonWitnessUtxo != nil {
			prevIndex := txIn.PreviousOutPoint.Index
			fetcher.AddPrevOut(
				txIn.PreviousOutPoint,
				in.NonWitnessUtxo.TxOut[prevIndex],
			)
			continue
		}

		// Fall back to witness UTXO only for older wallets.
		if in.WitnessUtxo != nil {
			fetcher.AddPrevOut(
				txIn.PreviousOutPoint, in.WitnessUtxo,
			)
		}
	}
	return fetcher
}

func ValidRedeemSignature(redeemScript []byte, pkScript []byte) bool {
	redeemScriptHash := btcutil.Hash160(redeemScript)
	actualScriptHash := pkScript[2 : len(pkScript)-1]
	return bytes.Equal(redeemScriptHash, actualScriptHash)
}
