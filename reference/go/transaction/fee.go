package transaction

import (
	"fmt"

	"github.com/btcsuite/btcd/btcutil"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/btcsuite/btcd/chaincfg/chainhash"
	"github.com/btcsuite/btcd/wire"
	"github.com/btcsuite/btcwallet/wallet/txrules"
	"github.com/btcsuite/btcwallet/wallet/txsizes"

	"github.com/gosuda/btctxbuilder/script"
	"github.com/gosuda/btctxbuilder/types"
	"github.com/gosuda/btctxbuilder/utils"
)

func FundRawTransaction(
	params *chaincfg.Params,
	msgTx *wire.MsgTx,
	inputs *TxInputs,
	outputs TxOutputs,
	changeAddr string,
	feeRate float64,
	utxoPool []*types.Utxo,
	fromAddr string,
) error {
	changeBTC, err := btcutil.DecodeAddress(changeAddr, params)
	if err != nil {
		return fmt.Errorf("decode change address: %w", err)
	}

	changeScript, err := script.EncodeTransferScript(changeBTC)
	if err != nil {
		return fmt.Errorf("encode change script: %w", err)
	}

	addWireInput := func(raw *wire.MsgTx, vout uint32) error {
		txid, err := chainhash.NewHashFromStr(raw.TxID())
		if err != nil {
			return err
		}
		msgTx.AddTxIn(wire.NewTxIn(wire.NewOutPoint(txid, vout), nil, nil))
		return nil
	}

	userOuts := make([]*wire.TxOut, len(msgTx.TxOut))
	copy(userOuts, msgTx.TxOut)

	fee, err := EstimateTxFee(feeRate, *inputs, userOuts, changeBTC)
	if err != nil {
		return fmt.Errorf("estimate fee: %w", err)
	}
	inTotal := inputs.AmountTotal()
	outTotal := outputs.AmountTotal()
	fund := inTotal - outTotal - fee

	for fund < 0 {
		deficit := -fund
		selected, rest, ok := utils.SelectUtxo(utxoPool, int(deficit), func(u *types.Utxo) int {
			return int(u.Value)
		})
		if !ok {
			return fmt.Errorf("insufficient balance: have=%v, need=%v (fee=%v)",
				inTotal, outTotal+fee, fee)
		}
		for _, u := range selected {
			if err := inputs.AddInput(params, u.RawTx, u.Vout, u.Value, fromAddr); err != nil {
				return fmt.Errorf("add input: %w", err)
			}
			if err := addWireInput(u.RawTx, u.Vout); err != nil {
				return fmt.Errorf("add txin: %w", err)
			}
			inTotal += btcutil.Amount(u.Value)
		}
		utxoPool = rest

		fee, err = EstimateTxFee(feeRate, *inputs, userOuts, changeBTC)
		if err != nil {
			return fmt.Errorf("re-estimate fee: %w", err)
		}
		fund = inTotal - outTotal - fee
	}

	if fund > 0 {
		changeOut := wire.NewTxOut(int64(fund), changeScript)
		if changeOut.Value > 0 {
			msgTx.AddTxOut(changeOut)
		}
	}

	return nil
}

func EstimateTxFee(feeRate float64, ins TxInputs, outs []*wire.TxOut, fundAddress btcutil.Address) (btcutil.Amount, error) {
	feeRatePerKb := btcutil.Amount(feeRate) * 1000
	vSize, err := EstimateTxVirtualSize(ins, outs, fundAddress)
	if err != nil {
		return 0, err
	}
	estimateFee := txrules.FeeForSerializeSize(feeRatePerKb, vSize)
	return estimateFee, nil
}

func EstimateTxVirtualSize(ins TxInputs, outs []*wire.TxOut, fundAddress btcutil.Address) (vSize int, err error) {
	// TODO : Add support for p2sh, p2wsh
	var nested, p2wpkh, p2tr, p2pkh int
	for _, in := range ins {
		switch types.GetAddressType(in.Address) {
		case types.P2PKH:
			p2pkh++
		case types.P2WPKH:
			p2wpkh++
		case types.P2WPKH_NESTED, types.P2WSH_NESTED:
			nested++
		case types.P2TR:
			p2tr++
		}
	}
	fundScriptSize, err := GetFundScriptSize(fundAddress)
	if err != nil {
		return 0, err
	}

	vSize = txsizes.EstimateVirtualSize(p2pkh, p2tr, p2wpkh, nested, outs, fundScriptSize)
	return vSize, nil
}

func GetFundScriptSize(fundAddress btcutil.Address) (int, error) {
	// Determine the script type and size
	switch fundAddress.(type) {
	case *btcutil.AddressPubKey: // P2PK
		return 35, nil // [33-byte PubKey] OP_CHECKSIG
	case *btcutil.AddressPubKeyHash: // P2PKH
		return 25, nil // OP_DUP OP_HASH160 [20-byte HASH] OP_EQUALVERIFY OP_CHECKSIG
	case *btcutil.AddressScriptHash: // P2SH
		return 23, nil // OP_HASH160 [20-byte HASH] OP_EQUAL
	case *btcutil.AddressWitnessPubKeyHash: // P2WPKH
		return 22, nil // OP_0 [20-byte HASH]
	case *btcutil.AddressWitnessScriptHash: // P2WSH
		return 34, nil // OP_0 [32-byte HASH]
	case *btcutil.AddressTaproot: // P2TR
		return 34, nil // OP_1 [32-byte Taproot PubKey]
	default:
		return 0, fmt.Errorf("unsupported address type: %T", fundAddress)
	}
}
