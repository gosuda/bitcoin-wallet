package transaction

import (
	"fmt"

	"github.com/btcsuite/btcd/btcutil"
	"github.com/btcsuite/btcd/btcutil/psbt"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/btcsuite/btcd/chaincfg/chainhash"
	"github.com/btcsuite/btcd/txscript"
	"github.com/btcsuite/btcd/wire"

	"github.com/gosuda/btctxbuilder/script"
	"github.com/gosuda/btctxbuilder/types"
)

type TxInput struct {
	txid string
	vout uint32

	tx       *wire.MsgTx
	prevVout *wire.TxOut

	Amount   btcutil.Amount
	Address  btcutil.Address
	AddrType types.AddrType
}

type TxInputs []*TxInput

func (t *TxInputs) AddInput(params *chaincfg.Params, rawTx *wire.MsgTx, vout uint32, amount int64, address string) error {
	var prevVout *wire.TxOut
	if rawTx != nil {
		prevVout = rawTx.TxOut[vout]
	}

	btcAmount := btcutil.Amount(amount)
	btcAddress, _, err := types.DecodeAddress(address, params)
	if err != nil {
		return err
	}
	AddrType := types.GetAddressType(btcAddress)

	*t = append(*t, &TxInput{
		txid:     rawTx.TxID(),
		vout:     vout,
		tx:       rawTx,
		prevVout: prevVout,
		Amount:   btcAmount,
		Address:  btcAddress,
		AddrType: AddrType,
	})
	return nil
}

func (t *TxInputs) AmountTotal() btcutil.Amount {
	var total btcutil.Amount
	for _, input := range *t {
		total += input.Amount
	}
	return total
}

func (t *TxInputs) ToWire() ([]*wire.TxIn, error) {
	var txIns []*wire.TxIn = make([]*wire.TxIn, 0, len(*t))
	for _, in := range *t {
		txHash, err := chainhash.NewHashFromStr(in.txid)
		if err != nil {
			return nil, err
		}
		outPoint := wire.NewOutPoint(txHash, in.vout)
		txIn := wire.NewTxIn(outPoint, nil, nil)
		txIns = append(txIns, txIn)
	}

	return txIns, nil
}

type TxOutput struct {
	Amount   btcutil.Amount
	PkScript []byte
}

type TxOutputs []*TxOutput

func (t *TxOutputs) AddOutputTransfer(params *chaincfg.Params, addr string, amount int64) error {
	rawAddr, _, err := types.DecodeAddress(addr, params)
	if err != nil {
		return err
	}
	pkScript, err := script.EncodeTransferScript(rawAddr)
	if err != nil {
		return err
	}
	t.AddOutputPkScript(pkScript, amount)
	return nil
}

func (t *TxOutputs) AddOutputPkScript(pkScript []byte, amount int64) {
	vout := &TxOutput{
		Amount:   btcutil.Amount(amount),
		PkScript: pkScript,
	}
	*t = append(*t, vout)
}

func (t *TxOutputs) AmountTotal() btcutil.Amount {
	var total btcutil.Amount
	for _, vout := range *t {
		total += vout.Amount
	}
	return total
}

func (t *TxOutputs) ToWire() ([]*wire.TxOut, error) {
	txOuts := make([]*wire.TxOut, 0, len(*t))
	for _, out := range *t {
		txOuts = append(txOuts, wire.NewTxOut(int64(out.Amount), out.PkScript))
	}
	return txOuts, nil
}

func DecorateTxInputs(packet *psbt.Packet, inputs TxInputs) error {
	if len(packet.Inputs) != len(inputs) {
		return fmt.Errorf("psbt inputs (%d) and provided inputs (%d) mismatch",
			len(packet.Inputs), len(inputs))
	}

	for i := range packet.Inputs {
		txInput := inputs[i]

		switch txInput.AddrType {
		case types.P2PK, types.P2PKH:
			addInputInfoNonSegWit(&packet.Inputs[i], txInput)
		case types.P2WPKH, types.P2WPKH_NESTED:
			addInputInfoSegWitV0(&packet.Inputs[i], txInput)
		case types.P2TR:
			addInputInfoSegWitV1(&packet.Inputs[i], txInput)
		default:
			return fmt.Errorf("not support address type %s", txInput.AddrType)
		}
	}
	return nil
}

func addInputInfoNonSegWit(in *psbt.PInput, txInput *TxInput) {
	in.NonWitnessUtxo = txInput.tx

	// Include the derivation path for each input.
	// in.Bip32Derivation = []*psbt.Bip32Derivation{
	// 	derivationInfo,
	// }
}

// addInputInfoSegWitV0 adds the UTXO and BIP32 derivation info for a SegWit v0
// PSBT input (p2wkh, np2wkh) from the given wallet information.
func addInputInfoSegWitV0(in *psbt.PInput, txInput *TxInput) {

	// As a fix for CVE-2020-14199 we have to always include the full
	// non-witness UTXO in the PSBT for segwit v0.
	in.NonWitnessUtxo = txInput.tx

	// To make it more obvious that this is actually a witness output being
	// spent, we also add the same information as the witness UTXO.
	in.WitnessUtxo = txInput.prevVout
	in.SighashType = txscript.SigHashAll

	// Include the derivation path for each input.
	// in.Bip32Derivation = []*psbt.Bip32Derivation{
	// 	derivationInfo,
	// }

	// For nested P2WKH we need to add the redeem script to the input,
	// otherwise an offline wallet won't be able to sign for it. For normal
	// P2WKH this will be nil.
	if txInput.AddrType == types.P2WPKH_NESTED {
		// TODO : test!!
		in.RedeemScript = in.WitnessScript
	}
}

// addInputInfoSegWitV0 adds the UTXO and BIP32 derivation info for a SegWit v1
// PSBT input (p2tr) from the given wallet information.
func addInputInfoSegWitV1(in *psbt.PInput, txInput *TxInput) {

	// For SegWit v1 we only need the witness UTXO information.
	in.WitnessUtxo = txInput.prevVout
	in.SighashType = txscript.SigHashDefault

	// Include the derivation path for each input in addition to the
	// taproot specific info we have below.
	// in.Bip32Derivation = []*psbt.Bip32Derivation{
	// 	derivationInfo,
	// }

	// Include the derivation path for each input.
	// in.TaprootBip32Derivation = []*psbt.TaprootBip32Derivation{{
	// 	XOnlyPubKey:          derivationInfo.PubKey[1:],
	// 	MasterKeyFingerprint: derivationInfo.MasterKeyFingerprint,
	// 	Bip32Path:            derivationInfo.Bip32Path,
	// }}
}
