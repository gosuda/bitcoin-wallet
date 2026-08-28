package script

/*
// EncodeTaprootMultiSigScript creates a Taproot address for a multisig setup.
func EncodeTaprootMultiSigScript(network types.Network, pubKeys [][]byte, nRequired int) ([]byte, error) {
	if len(pubKeys) < nRequired {
		return nil, errors.New("number of required signatures cannot exceed number of public keys")
	}

	tapLeafScripts := make([]txscript.TapLeaf, len(pubKeys))
	for i, pubKey := range pubKeys {
		tapLeafScripts[i] = txscript.NewTapLeaf(txscript.BaseLeafVersion, pubKey)
	}

	// Build the Taproot script tree
	taprootTree := txscript.AssembleTaprootScriptTree(tapLeafScripts...)

	// Compute Taproot output key
	outputKey := taprootTree.RootNode.TapHash()
	_ = outputKey
	return nil, nil
	// Return the witness program (segwit v1)
	// return txscript.NewScriptBuilder().AddData(outputKey).Script()
}

// DecodeTaprootMultiSigScript decodes the Taproot multisig script and extracts keys.
func DecodeTaprootMultiSigScript(script []byte) ([][]byte, error) {
	// Check if script is a valid witness program
	if len(script) < 2 || script[0] != txscript.OP_0 {
		return nil, errors.New("invalid Taproot script")
	}

	// Parse the Taproot output key
	outputKey := script[1:]
	_, tapTree, err := txscript.ParseTaprootOutputKey(outputKey)
	if err != nil {
		return nil, err
	}

	// Extract public keys from the TapTree leaves
	var pubKeys [][]byte
	for _, leaf := range tapTree.Leaves {
		pubKeys = append(pubKeys, leaf.Script) // Each leaf script holds the public key
	}

	return pubKeys, nil
}
*/
