package runes

// func NewRunestoneEtchingTx(c *client.Client, utxos []*types.Utxo, fromAddress string, toAddress string, fundAddress string, etching *runestone.Etching) (*psbt.Packet, error) {
// 	from, addrType, err := types.DecodeAddress(fromAddress, c.GetParams())
// 	if err != nil {
// 		return nil, err
// 	} else if addrType != types.P2TR {
// 		return nil, errors.New("from address must be a taproot address")
// 	}
// 	to, addrType, err := types.DecodeAddress(toAddress, c.GetParams())
// 	if err != nil {
// 		return nil, err
// 	} else if addrType != types.P2TR {
// 		return nil, errors.New("to address must be a taproot address")
// 	}

// 	fromPubKey, err := types.AddrP2TRToPubkey(fromAddress, c.GetParams())
// 	if err != nil {
// 		return nil, err
// 	}

// 	rs := &runestone.Runestone{
// 		Etching: etching,
// 	}
// 	rsData, err := rs.Encipher()
// 	if err != nil {
// 		return nil, err
// 	}
// 	rsCommitMent := rs.Etching.Rune.Commitment()

// 	return nil, nil
// }
