package transaction

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/ecdsa"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
	"github.com/btcsuite/btcd/btcutil/psbt"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/btcsuite/btcd/chaincfg/chainhash"
	"github.com/btcsuite/btcd/txscript"
	"github.com/btcsuite/btcd/wire"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"

	"github.com/gosuda/btctxbuilder/types"
)

// signTx signs a PSBT packet using the provided signer and public key.
func SignTx(chain *chaincfg.Params, packet *psbt.Packet, sign types.Signer, pubkey []byte) (*psbt.Packet, error) {
	err := psbt.InputsReadyToSign(packet)
	if err != nil {
		return nil, err
	}

	updater, err := psbt.NewUpdater(packet)
	if err != nil {
		return nil, err
	}

	prevOutputFetcher := PsbtPrevOutputFetcher(packet)
	for i, input := range packet.Inputs {
		// Extract previous transaction output information
		if input.WitnessUtxo == nil && input.NonWitnessUtxo == nil {
			return nil, fmt.Errorf("missing input UTXO information for input %d", i)
		}

		var prevOutValue int64
		var pkScript []byte
		if input.WitnessUtxo != nil {
			updater.AddInWitnessUtxo(input.WitnessUtxo, i)
			prevOutValue = input.WitnessUtxo.Value
			pkScript = input.WitnessUtxo.PkScript
		} else if input.NonWitnessUtxo != nil {
			index := packet.UnsignedTx.TxIn[i].PreviousOutPoint.Index
			prevOut := input.NonWitnessUtxo.TxOut[index]
			prevOutValue = prevOut.Value
			pkScript = prevOut.PkScript
		}

		scriptClass, _, _, err := txscript.ExtractPkScriptAddrs(pkScript, chain)
		if err != nil {
			return nil, err
		}

		switch scriptClass {
		case txscript.WitnessV1TaprootTy: // P2TR
			err = signInputP2TR(updater, i, pkScript, sign, prevOutputFetcher)
		case txscript.PubKeyTy: // P2PK
			err = signInputP2PK(updater, i, pkScript, sign)
		case txscript.PubKeyHashTy: // P2PKH
			err = signInputP2PKH(updater, i, pkScript, sign, pubkey)
		case txscript.ScriptHashTy: // P2SH
			err = signInputP2SH(updater, input.RedeemScript, i, pkScript, sign, pubkey)
		case txscript.WitnessV0PubKeyHashTy: // P2WPKH
			err = signInputP2WPKH(updater, i, pkScript, prevOutValue, prevOutputFetcher, sign, pubkey)
		case txscript.WitnessV0ScriptHashTy: // P2WSH
			err = signInputP2WSH(updater, i, pkScript, input.WitnessScript, prevOutValue, prevOutputFetcher, sign, pubkey)
		case txscript.MultiSigTy: // Multisig
			panic("not supported yet")
		case txscript.NullDataTy: // OP_RETURN

		default:
			return nil, fmt.Errorf("unsupported script type")
		}
		if err != nil {
			return nil, err
		}
		_, err = psbt.MaybeFinalize(packet, i)
		if err != nil {
			return nil, err
		}
	}

	return packet, nil
}

func signInputP2PK(updater *psbt.Updater, i int, prevPkScript []byte, sign types.Signer) error {
	// TODO : hashtype always all in p2pk
	hashType := txscript.SigHashAll
	if err := updater.AddInSighashType(hashType, i); err != nil {
		return err
	}
	signature, err := RawTxInSignature(updater.Upsbt.UnsignedTx, i, prevPkScript, hashType, sign)
	if err != nil {
		return err
	}
	scriptSig, err := txscript.NewScriptBuilder().AddData(signature).Script()
	if err != nil {
		return err
	}
	updater.Upsbt.Inputs[i].FinalScriptSig = scriptSig
	return nil
}

func signInputP2PKH(updater *psbt.Updater, i int, prevPkScript []byte, sign types.Signer, pubkey []byte) error {
	// TODO : hashtype always all in p2pkh
	hashType := txscript.SigHashAll
	if err := updater.AddInSighashType(hashType, i); err != nil {
		return err
	}

	signature, err := RawTxInSignature(updater.Upsbt.UnsignedTx, i, prevPkScript, txscript.SigHashAll, sign)
	if err != nil {
		return err
	}

	if signOutcome, err := updater.Sign(i, signature, pubkey, nil, nil); err != nil {
		return err
	} else if signOutcome != psbt.SignSuccesful {
		return fmt.Errorf("signing failed, code: %d", signOutcome)
	}

	return nil
}

func signInputP2SH(updater *psbt.Updater, redeemScript []byte, i int, prevPkScript []byte, sign types.Signer, pubkey []byte) error {
	hashType := txscript.SigHashAll
	if err := updater.AddInSighashType(hashType, i); err != nil {
		return err
	}

	// valid RedeemScript
	if !ValidRedeemSignature(redeemScript, prevPkScript) {
		return fmt.Errorf("invalid redeem script")
	}

	if txscript.IsWitnessProgram(redeemScript) {
		return fmt.Errorf("redeemScript is a witness program (nested segwit). Use a P2WPKH/WSH path with amount-aware signing")
	}

	signature, err := RawTxInSignature(updater.Upsbt.UnsignedTx, i, redeemScript, hashType, sign)
	if err != nil {
		return err
	}
	signOutcome, err := updater.Sign(i, signature, pubkey, redeemScript, nil)
	if err != nil {
		return fmt.Errorf("failed to sign PSBT input: %v", err)
	} else if signOutcome != psbt.SignSuccesful {
		return fmt.Errorf("signing was not successful, outcome: %v", signOutcome)
	}
	return nil
}

func signInputP2WPKH(updater *psbt.Updater, i int, prevPkScript []byte, amount int64, prevOutFetcher *txscript.MultiPrevOutFetcher, sign types.Signer, pubkey []byte) error {
	// TODO : hashtype always all in p2wpkh
	hashType := txscript.SigHashAll
	if err := updater.AddInSighashType(hashType, i); err != nil {
		return err
	}

	signature, err := RawTxInWitnessSignature(updater.Upsbt.UnsignedTx, txscript.NewTxSigHashes(updater.Upsbt.UnsignedTx, prevOutFetcher), i, amount, prevPkScript, hashType, sign)
	if err != nil {
		return err
	}
	if signOutcome, err := updater.Sign(i, signature, pubkey, nil, nil); err != nil {
		return err
	} else if signOutcome != psbt.SignSuccesful {
		return fmt.Errorf("signing failed, code: %d", signOutcome)
	}
	return nil
}

func signInputP2WSH(updater *psbt.Updater, i int, prevPkScript []byte, witnessScript []byte, amount int64, prevOutFetcher *txscript.MultiPrevOutFetcher, sign types.Signer, pubkey []byte) error {
	const hashType = txscript.SigHashAll
	if err := updater.AddInSighashType(hashType, i); err != nil {
		return err
	}
	ver, program, err := txscript.ExtractWitnessProgramInfo(prevPkScript)
	if err != nil {
		return err
	} else if ver != 0 || len(program) != 32 {
		return fmt.Errorf("input %d: prevPkScript is not P2WSH (v0,witLen=32)", i)
	}

	h := sha256.Sum256(witnessScript)
	if !bytes.Equal(program, h[:]) {
		return fmt.Errorf("input %d: witnessScript hash mismatch (pkScript != sha256(witnessScript))", i)
	}

	sigHashes := txscript.NewTxSigHashes(updater.Upsbt.UnsignedTx, prevOutFetcher)
	signature, err := RawTxInWitnessSignature(updater.Upsbt.UnsignedTx, sigHashes, i, amount, witnessScript, hashType, sign)
	if err != nil {
		return err
	}
	if signOutcome, err := updater.Sign(i, signature, pubkey, nil, witnessScript); err != nil {
		return err
	} else if signOutcome != psbt.SignSuccesful {
		return fmt.Errorf("signing failed, code: %d", signOutcome)
	}
	return nil
}

func signInputP2TR(updater *psbt.Updater, i int, prevPkScript []byte, sign types.Signer, prevOutFetcher txscript.PrevOutputFetcher) error {
	var err error

	sigHashes := txscript.NewTxSigHashes(updater.Upsbt.UnsignedTx, prevOutFetcher)

	// TODO : hashtype always default in taproot
	hashType := txscript.SigHashDefault
	err = updater.AddInSighashType(hashType, i)
	if err != nil {
		return err
	}
	msgHash, err := txscript.CalcTaprootSignatureHash(sigHashes, hashType, updater.Upsbt.UnsignedTx, i, prevOutFetcher)
	if err != nil {
		return err
	}
	signature, err := sign(msgHash)
	if err != nil {
		return err
	}
	updater.Upsbt.Inputs[i].TaprootKeySpendSig = signature
	return nil
}

func CheckDuplicateOfUpdater(updater *psbt.Updater, index int) {
	signatures := updater.Upsbt.Inputs[index].TaprootScriptSpendSig
	m := map[string]*psbt.TaprootScriptSpendSig{}
	signs := make([]*psbt.TaprootScriptSpendSig, 0)
	for _, v := range signatures {
		key := append(v.XOnlyPubKey, v.LeafHash...)
		keyHex := hex.EncodeToString(key)
		_, ok := m[keyHex]
		if !ok {
			m[keyHex] = v
			signs = append(signs, v)
		}
	}
	updater.Upsbt.Inputs[index].TaprootScriptSpendSig = signs
}

const (
	witnessV0PubKeyHashLen = 22

	sigHashMask = 0x1f
)

// RawTxInSignature returns the serialized ECDSA signature for the input idx of
// the given transaction, with hashType appended to it.
func RawTxInSignature(tx *wire.MsgTx, idx int, subScript []byte,
	hashType txscript.SigHashType, sign types.Signer) ([]byte, error) {

	hash, err := txscript.CalcSignatureHash(subScript, hashType, tx, idx)
	if err != nil {
		return nil, err
	}
	signature, err := sign(hash)
	if err != nil {
		return nil, err
	}

	return append(signature, byte(hashType)), nil
}

// RawTxInWitnessSignature returns the serialized ECDA signature for the input
// idx of the given transaction, with the hashType appended to it. This
// function is identical to RawTxInSignature, however the signature generated
// signs a new sighash digest defined in BIP0143.
func RawTxInWitnessSignature(tx *wire.MsgTx, sigHashes *txscript.TxSigHashes, idx int,
	amt int64, subScript []byte, hashType txscript.SigHashType, sign types.Signer) ([]byte, error) {

	msgHash, err := calcWitnessSignatureHashRaw(subScript, sigHashes, hashType, tx, idx, amt)
	if err != nil {
		return nil, err
	}

	signature, err := sign(msgHash)
	if err != nil {
		return nil, err
	}

	return append(signature, byte(hashType)), nil
}

// calcWitnessSignatureHashRaw computes the sighash digest of a transaction's
// segwit input using the new, optimized digest calculation algorithm defined
// in BIP0143: https://github.com/bitcoin/bips/blob/master/bip-0143.mediawiki.
// This function makes use of pre-calculated sighash fragments stored within
// the passed HashCache to eliminate duplicate hashing computations when
// calculating the final digest, reducing the complexity from O(N^2) to O(N).
// Additionally, signatures now cover the input value of the referenced unspent
// output. This allows offline, or hardware wallets to compute the exact amount
// being spent, in addition to the final transaction fee. In the case the
// wallet if fed an invalid input amount, the real sighash will differ causing
// the produced signature to be invalid.
func calcWitnessSignatureHashRaw(subScript []byte, sigHashes *txscript.TxSigHashes,
	hashType txscript.SigHashType, tx *wire.MsgTx, idx int, amt int64) ([]byte, error) {

	// As a sanity check, ensure the passed input index for the transaction
	// is valid.
	//
	// TODO(roasbeef): check needs to be lifted elsewhere?
	if idx > len(tx.TxIn)-1 {
		return nil, fmt.Errorf("idx %d but %d txins", idx, len(tx.TxIn))
	}

	sigHashBytes := chainhash.DoubleHashRaw(func(w io.Writer) error {
		var scratch [8]byte

		// First write out, then encode the transaction's version
		// number.
		binary.LittleEndian.PutUint32(scratch[:], uint32(tx.Version))
		w.Write(scratch[:4])

		// Next write out the possibly pre-calculated hashes for the
		// sequence numbers of all inputs, and the hashes of the
		// previous outs for all outputs.
		var zeroHash chainhash.Hash

		// If anyone can pay isn't active, then we can use the cached
		// hashPrevOuts, otherwise we just write zeroes for the prev
		// outs.
		if hashType&txscript.SigHashAnyOneCanPay == 0 {
			w.Write(sigHashes.HashPrevOutsV0[:])
		} else {
			w.Write(zeroHash[:])
		}

		// If the sighash isn't anyone can pay, single, or none, the
		// use the cached hash sequences, otherwise write all zeroes
		// for the hashSequence.
		if hashType&txscript.SigHashAnyOneCanPay == 0 &&
			hashType&sigHashMask != txscript.SigHashSingle &&
			hashType&sigHashMask != txscript.SigHashNone {

			w.Write(sigHashes.HashSequenceV0[:])
		} else {
			w.Write(zeroHash[:])
		}

		txIn := tx.TxIn[idx]

		// Next, write the outpoint being spent.
		w.Write(txIn.PreviousOutPoint.Hash[:])
		var bIndex [4]byte
		binary.LittleEndian.PutUint32(
			bIndex[:], txIn.PreviousOutPoint.Index,
		)
		w.Write(bIndex[:])

		if isWitnessPubKeyHashScript(subScript) {
			// The script code for a p2wkh is a length prefix
			// varint for the next 25 bytes, followed by a
			// re-creation of the original p2pkh pk script.
			w.Write([]byte{0x19})
			w.Write([]byte{txscript.OP_DUP})
			w.Write([]byte{txscript.OP_HASH160})
			w.Write([]byte{txscript.OP_DATA_20})
			w.Write(extractWitnessPubKeyHash(subScript))
			w.Write([]byte{txscript.OP_EQUALVERIFY})
			w.Write([]byte{txscript.OP_CHECKSIG})
		} else {
			// For p2wsh outputs, and future outputs, the script
			// code is the original script, with all code
			// separators removed, serialized with a var int length
			// prefix.
			wire.WriteVarBytes(w, 0, subScript)
		}

		// Next, add the input amount, and sequence number of the input
		// being signed.
		binary.LittleEndian.PutUint64(scratch[:], uint64(amt))
		w.Write(scratch[:])
		binary.LittleEndian.PutUint32(scratch[:], txIn.Sequence)
		w.Write(scratch[:4])

		// If the current signature mode isn't single, or none, then we
		// can re-use the pre-generated hashoutputs sighash fragment.
		// Otherwise, we'll serialize and add only the target output
		// index to the signature pre-image.
		if hashType&sigHashMask != txscript.SigHashSingle &&
			hashType&sigHashMask != txscript.SigHashNone {

			w.Write(sigHashes.HashOutputsV0[:])
		} else if hashType&sigHashMask == txscript.SigHashSingle &&
			idx < len(tx.TxOut) {

			h := chainhash.DoubleHashRaw(func(tw io.Writer) error {
				wire.WriteTxOut(tw, 0, 0, tx.TxOut[idx])
				return nil
			})
			w.Write(h[:])
		} else {
			w.Write(zeroHash[:])
		}

		// Finally, write out the transaction's locktime, and the sig
		// hash type.
		binary.LittleEndian.PutUint32(scratch[:], tx.LockTime)
		w.Write(scratch[:4])
		binary.LittleEndian.PutUint32(scratch[:], uint32(hashType))
		w.Write(scratch[:4])

		return nil
	})

	return sigHashBytes[:], nil
}

// extractWitnessPubKeyHash extracts the witness public key hash from the passed
// script if it is a standard pay-to-witness-pubkey-hash script. It will return
// nil otherwise.
func extractWitnessPubKeyHash(script []byte) []byte {
	// A pay-to-witness-pubkey-hash script is of the form:
	//   OP_0 OP_DATA_20 <20-byte-hash>
	if len(script) == witnessV0PubKeyHashLen &&
		script[0] == txscript.OP_0 &&
		script[1] == txscript.OP_DATA_20 {

		return script[2:witnessV0PubKeyHashLen]
	}

	return nil
}

// isWitnessPubKeyHashScript returns whether or not the passed script is a
// standard pay-to-witness-pubkey-hash script.
func isWitnessPubKeyHashScript(script []byte) bool {
	return extractWitnessPubKeyHash(script) != nil
}

// VerifyTx verifies signatures for common script types without executing the full script.
// Supported: P2PK, P2PKH, P2WPKH, P2WSH(single-sig), Taproot key-path.
// It verifies using the provided pubkey (single-sig assumption).
func VerifyTx(chain *chaincfg.Params, pkt *psbt.Packet, pubkey *secp256k1.PublicKey) (bool, error) {
	// Convert decred pubkey -> btcec pubkey for btcec/schnorr usage
	btcecPub, err := btcec.ParsePubKey(pubkey.SerializeCompressed())
	if err != nil {
		return false, fmt.Errorf("invalid pubkey: %w", err)
	}

	prevOutFetcher := PsbtPrevOutputFetcher(pkt)
	tx := pkt.UnsignedTx
	sigHashes := txscript.NewTxSigHashes(tx, prevOutFetcher)

	for i, in := range pkt.Inputs {
		// Resolve pkScript and amount for this input
		var pkScript []byte
		var amount int64
		switch {
		case in.WitnessUtxo != nil:
			pkScript = in.WitnessUtxo.PkScript
			amount = in.WitnessUtxo.Value
		case in.NonWitnessUtxo != nil:
			// Use the outpoint index of this *input* (not i)
			idx := tx.TxIn[i].PreviousOutPoint.Index
			if int(idx) >= len(in.NonWitnessUtxo.TxOut) {
				return false, fmt.Errorf("input %d: NonWitnessUtxo missing output index %d", i, idx)
			}
			pkScript = in.NonWitnessUtxo.TxOut[idx].PkScript
			amount = in.NonWitnessUtxo.TxOut[idx].Value
		default:
			return false, fmt.Errorf("input %d: missing UTXO data", i)
		}

		class, _, _, err := txscript.ExtractPkScriptAddrs(pkScript, chain)
		if err != nil {
			return false, fmt.Errorf("input %d: extract class: %w", i, err)
		}

		switch class {
		case txscript.PubKeyTy:
			// scriptSig: <DER+ht>
			sigPushes, err := extractPushes(tx.TxIn[i].SignatureScript)
			if err != nil || len(sigPushes) < 1 {
				return false, fmt.Errorf("input %d: invalid scriptSig", i)
			}
			raw := sigPushes[len(sigPushes)-1]
			if len(raw) < 2 {
				return false, fmt.Errorf("input %d: malformed DER+hashtype", i)
			}
			ht := txscript.SigHashType(raw[len(raw)-1])
			der := raw[:len(raw)-1]

			digest, err := txscript.CalcSignatureHash(pkScript, ht, tx, i)
			if err != nil {
				return false, fmt.Errorf("input %d: sighash: %w", i, err)
			}
			esig, err := ecdsa.ParseDERSignature(der)
			if err != nil {
				return false, fmt.Errorf("input %d: parse der: %w", i, err)
			}
			if !esig.Verify(digest, btcecPub) {
				return false, fmt.Errorf("input %d: ECDSA verify failed", i)
			}

		case txscript.PubKeyHashTy:
			// scriptSig: <DER+ht> <pubkey>
			sigPushes, err := extractPushes(tx.TxIn[i].SignatureScript)
			if err != nil || len(sigPushes) < 1 {
				return false, fmt.Errorf("input %d: invalid scriptSig", i)
			}
			raw := sigPushes[0]
			if len(raw) < 2 {
				return false, fmt.Errorf("input %d: malformed DER+hashtype", i)
			}
			ht := txscript.SigHashType(raw[len(raw)-1])
			der := raw[:len(raw)-1]

			digest, err := txscript.CalcSignatureHash(pkScript, ht, tx, i)
			if err != nil {
				return false, fmt.Errorf("input %d: sighash: %w", i, err)
			}
			esig, err := ecdsa.ParseDERSignature(der)
			if err != nil {
				return false, fmt.Errorf("input %d: parse der: %w", i, err)
			}
			if !esig.Verify(digest, btcecPub) {
				return false, fmt.Errorf("input %d: ECDSA verify failed", i)
			}

		case txscript.WitnessV0PubKeyHashTy:
			// witness: [ <DER+ht>, <pubkey> ]
			wit := tx.TxIn[i].Witness
			if len(wit) < 2 || len(wit[0]) < 2 {
				return false, fmt.Errorf("input %d: invalid witness", i)
			}
			raw := wit[0]
			ht := txscript.SigHashType(raw[len(raw)-1])
			der := raw[:len(raw)-1]

			// BIP143: subScript derived from P2WPKH (handled in calcWitnessSignatureHashRaw)
			digest, err := calcWitnessSignatureHashRaw(pkScript, sigHashes, ht, tx, i, amount)
			if err != nil {
				return false, fmt.Errorf("input %d: sighash(witness): %w", i, err)
			}
			esig, err := ecdsa.ParseDERSignature(der)
			if err != nil {
				return false, fmt.Errorf("input %d: parse der: %w", i, err)
			}
			if !esig.Verify(digest, btcecPub) {
				return false, fmt.Errorf("input %d: ECDSA verify failed", i)
			}

		case txscript.WitnessV0ScriptHashTy:
			// witness: [ <sig?> ... , <witnessScript> ]
			wit := tx.TxIn[i].Witness
			if len(wit) < 2 {
				return false, fmt.Errorf("input %d: invalid wsh witness", i)
			}
			witnessScript := wit[len(wit)-1]
			// pick first non-empty element before last as signature (single-sig assumption)
			var raw []byte
			for _, el := range wit[:len(wit)-1] {
				if len(el) > 0 {
					raw = el
					break
				}
			}
			if len(raw) < 2 {
				return false, fmt.Errorf("input %d: missing DER+hashtype in wsh witness", i)
			}
			ht := txscript.SigHashType(raw[len(raw)-1])
			der := raw[:len(raw)-1]

			digest, err := calcWitnessSignatureHashRaw(witnessScript, sigHashes, ht, tx, i, amount)
			if err != nil {
				return false, fmt.Errorf("input %d: sighash(wsh): %w", i, err)
			}
			esig, err := ecdsa.ParseDERSignature(der)
			if err != nil {
				return false, fmt.Errorf("input %d: parse der: %w", i, err)
			}
			if !esig.Verify(digest, btcecPub) {
				return false, fmt.Errorf("input %d: ECDSA verify failed", i)
			}

		case txscript.WitnessV1TaprootTy:
			// key-path only (no script path here)
			wit := tx.TxIn[i].Witness
			if len(wit) < 1 {
				return false, fmt.Errorf("input %d: empty taproot witness", i)
			}
			sig, err := schnorr.ParseSignature(wit[0])
			if err != nil {
				return false, fmt.Errorf("input %d: schnorr parse: %w", i, err)
			}
			digest, err := txscript.CalcTaprootSignatureHash(sigHashes, txscript.SigHashDefault, tx, i, prevOutFetcher)
			if err != nil {
				return false, fmt.Errorf("input %d: taproot sighash: %w", i, err)
			}
			tweaked := txscript.ComputeTaprootKeyNoScript(btcecPub)
			if !sig.Verify(digest, tweaked) {
				return false, fmt.Errorf("input %d: schnorr verify failed", i)
			}

		default:
			// Not handled (OP_RETURN, exotic scripts, multisig, etc.)
			// Skip rather than failing hard.
		}
	}

	return true, nil
}

// Very small pushdata extractor for scriptSig: returns the data pushes in order.
func extractPushes(script []byte) ([][]byte, error) {
	var pushes [][]byte
	r := bytes.NewReader(script)
	for r.Len() > 0 {
		op, err := r.ReadByte()
		if err != nil {
			return nil, err
		}
		switch {
		case op == txscript.OP_0:
			// empty push
			pushes = append(pushes, []byte{})

		case op >= 0x01 && op <= 0x4b:
			// 1~75 bytes push
			n := int(op)
			buf := make([]byte, n)
			if _, err := io.ReadFull(r, buf); err != nil {
				return nil, err
			}
			pushes = append(pushes, buf)

		default:
		}
	}
	return pushes, nil
}
