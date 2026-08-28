package transaction

import (
	"errors"
	"fmt"

	"github.com/btcsuite/btcd/btcutil/psbt"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/btcsuite/btcd/wire"

	"github.com/gosuda/btctxbuilder/types"
	"github.com/gosuda/btctxbuilder/utils"
)

// -----------------------------------------------------------------------------
// TxBuilder
// -----------------------------------------------------------------------------

type TxBuilder struct {
	params     *chaincfg.Params
	feeRate    float64
	fromAddr   string
	changeAddr string
	utxos      []*types.Utxo
	Inputs     TxInputs
	Outputs    TxOutputs
	pkt        *psbt.Packet

	errs []error
}

// -----------------------------------------------------------------------------
// ctor / error handling
// -----------------------------------------------------------------------------

func NewTxBuilder(params *chaincfg.Params) *TxBuilder {
	return &TxBuilder{params: params}
}

func (b *TxBuilder) addErr(err error) {
	if err != nil {
		b.errs = append(b.errs, err)
	}
}

func (b *TxBuilder) Err() error {
	if len(b.errs) == 0 {
		return nil
	}
	return errors.Join(b.errs...)
}

func (b *TxBuilder) OK() bool { return b.Err() == nil }

// -----------------------------------------------------------------------------
// setters
// -----------------------------------------------------------------------------

func (b *TxBuilder) From(addr string) *TxBuilder {
	if b.OK() {
		b.fromAddr = addr
	}
	return b
}

func (b *TxBuilder) Change(addr string) *TxBuilder {
	if b.OK() {
		b.changeAddr = addr
	}
	return b
}

func (b *TxBuilder) FeeRate(feeRate float64) *TxBuilder {
	if b.OK() {
		b.feeRate = feeRate
	}
	return b
}

func (b *TxBuilder) To(addr string, amt int64) *TxBuilder {
	if b.OK() {
		b.addErr(b.Outputs.AddOutputTransfer(b.params, addr, amt))
	}
	return b
}

func (b *TxBuilder) ToMap(balance map[string]int64) *TxBuilder {
	for addr, amt := range balance {
		b.To(addr, amt)
	}
	return b
}

// -----------------------------------------------------------------------------
// transitions (mutating builder)
// -----------------------------------------------------------------------------

// SelectUtxo picks UTXOs to cover Outputs (fee finalized in Build).
func (b *TxBuilder) SelectUtxo(utxos []*types.Utxo) *TxBuilder {
	if !b.OK() {
		return b
	}
	amountTotal := int(b.Outputs.AmountTotal())

	selected, unselected, ok := utils.SelectUtxo(utxos, amountTotal, func(u *types.Utxo) int {
		return int(u.Value)
	})
	if !ok {
		b.addErr(fmt.Errorf("insufficient balance | need : %v", amountTotal))
		return b
	}

	for _, u := range selected {
		b.addErr(b.Inputs.AddInput(b.params, u.RawTx, u.Vout, u.Value, b.fromAddr))
	}
	b.utxos = unselected

	if b.changeAddr == "" {
		b.changeAddr = b.fromAddr
	}
	return b
}

// -----------------------------------------------------------------------------
// build / sign
// -----------------------------------------------------------------------------

func (b *TxBuilder) Build() *TxBuilder {
	if !b.OK() {
		return b
	}

	msg := wire.NewMsgTx(wire.TxVersion)

	ins, err := b.Inputs.ToWire()
	if err != nil {
		b.addErr(err)
		return b
	}
	for _, in := range ins {
		msg.AddTxIn(in)
	}

	outs, err := b.Outputs.ToWire()
	if err != nil {
		b.addErr(err)
		return b
	}
	for _, out := range outs {
		msg.AddTxOut(out)
	}

	// finalize fee + add change
	if b.changeAddr != "" {
		if err := FundRawTransaction(
			b.params,
			msg,
			&b.Inputs,
			b.Outputs,
			b.changeAddr,
			b.feeRate,
			b.utxos,
			b.fromAddr,
		); err != nil {
			b.addErr(err)
			return b
		}
	}

	pkt, err := psbt.NewFromUnsignedTx(msg)
	if err != nil {
		b.addErr(err)
		return b
	}
	if err := DecorateTxInputs(pkt, b.Inputs); err != nil {
		b.addErr(err)
		return b
	}

	b.pkt = pkt
	return b
}

func (b *TxBuilder) SignWith(sign types.Signer, pubkey []byte) *TxBuilder {
	if !b.OK() {
		return b
	}
	if sign == nil {
		b.addErr(fmt.Errorf("no signer provided"))
		return b
	}
	pkt, err := SignTx(b.params, b.pkt, sign, pubkey)
	if err != nil {
		b.addErr(err)
		return b
	}
	b.pkt = pkt
	return b
}

func (b *TxBuilder) Packet() (*psbt.Packet, error) {
	if err := b.Err(); err != nil {
		return nil, err
	}
	if b.pkt == nil {
		return nil, fmt.Errorf("no packet: call Build() first")
	}
	return b.pkt, nil
}

func (b *TxBuilder) RawTx() ([]byte, error) {
	if err := b.Err(); err != nil {
		return nil, err
	}
	if b.pkt == nil || b.pkt.UnsignedTx == nil {
		return nil, fmt.Errorf("no unsigned tx: call Build() first")
	}
	return types.EncodePsbtToRawTx(b.pkt)
}
