package ordinals

import (
	"github.com/btcsuite/btcd/btcutil/psbt"
	"github.com/btcsuite/btcd/chaincfg"

	"github.com/gosuda/btctxbuilder/transaction"
)

// func NewInscribeTx(c *client.Client, fromAddress string, fundAddress string, inscriptionDatas []*InscriptionData) (revealTx []*psbt.Packet, commitTx *psbt.Packet, err error) {
// 	fromPubKey, err := types.AddrP2TRToPubkey(fromAddress, c.GetParams())
// 	if err != nil {
// 		return nil, nil, err
// 	}

// 	for _, inscriptionData := range inscriptionDatas {
// 		inscriptionScript, err := script.CreateInscriptionScript(fromPubKey, inscriptionData.ContentType, inscriptionData.Body, []byte(inscriptionData.RevealAddr))
// 		if err != nil {
// 			return nil, nil, err
// 		}

// 	}

// 	return nil, nil, nil
// }

// 1. Build the empty reveal transactions
func buildRevealTxs(params *chaincfg.Params, inscriptionDatas []*InscriptionData, feeRate float64) (revealTx []*psbt.Packet, err error) {
	builder := transaction.NewTxBuilder(params)
	_ = builder
	for _, inscriptionData := range inscriptionDatas {
		_ = inscriptionData
	}
	return nil, nil
}

// 2. Build commit transaction
func buildCommitTx() {

}

// 3. Complete and Sign the reveal transactions
func signRevealTxs() {

}

// 4. Sign the commit transaction
func signCommitTx() {

}
