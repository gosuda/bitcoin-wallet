package types

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"

	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
)

type Signer func(msgHash []byte) (signature []byte, err error)

// ECDSASigner wraps a secp256k1 private key for legacy/ECDSA signing.
type ECDSASigner struct {
	privkey *btcec.PrivateKey
}

// NewECDSASigner creates an ECDSA signer.
// If privkeyHex is empty, a new random private key will be generated.
func NewECDSASigner(privkeyHex string) (*ECDSASigner, error) {
	var priv *btcec.PrivateKey
	if privkeyHex == "" {
		p, err := btcec.NewPrivateKey()
		if err != nil {
			return nil, err
		}
		priv = p
	} else {
		raw, err := hex.DecodeString(privkeyHex)
		if err != nil {
			return nil, err
		}
		p, _ := btcec.PrivKeyFromBytes(raw)
		priv = p
	}
	return &ECDSASigner{privkey: priv}, nil
}

// Sign returns a DER-encoded ECDSA signature for the given 32-byte hash.
func (r *ECDSASigner) Sign(msgHash []byte) ([]byte, error) {
	signature, err := r.privkey.ToECDSA().Sign(rand.Reader, msgHash, nil)
	if err != nil {
		return nil, err
	}
	return signature, nil
}

// PrivateKeyHex returns the private key as a hex string (32 bytes).
func (s *ECDSASigner) PrivateKey() []byte {
	return s.privkey.Serialize()
}

// PubKeyCompressed returns the 33-byte compressed secp256k1 public key.
func (s *ECDSASigner) PubKey() []byte {
	return s.privkey.PubKey().SerializeCompressed()
}

// SchnorrSigner wraps a (already-tweaked or freshly-generated) BIP-340 private key.
// If you need Taproot internal&merkle tweaking, this constructor handles the common
// "no script path" tweak (merkleRoot=nil) when tweakedPrivkeyHex is empty.
type SchnorrSigner struct {
	privkey *btcec.PrivateKey
}

func NewSchnorrSigner(tweakedPrivkeyHex string) (*SchnorrSigner, error) {
	var privkey *btcec.PrivateKey

	if tweakedPrivkeyHex == "" {
		// 1) generate internal key
		internal, err := btcec.NewPrivateKey()
		if err != nil {
			return nil, err
		}
		// 2) evenize as per BIP-340
		internalEven := evenizePriv(internal)
		// 3) x-only internal pubkey
		xonly := schnorr.SerializePubKey(internalEven.PubKey()) // 32 bytes

		// 4) TapTweak(xonly || merkleRoot=nil)
		tweak := tapTweakHash(xonly, nil) // []byte(32)

		// 5) k' = (k + tweak) mod n
		n := btcec.S256().N
		k := new(big.Int).SetBytes(internalEven.Serialize())
		t := new(big.Int).SetBytes(tweak)
		k.Add(k, t)
		k.Mod(k, n)
		if k.Sign() == 0 {
			return nil, fmt.Errorf("/ invalid (extremely unlikely)")
		}
		privkey, _ = btcec.PrivKeyFromBytes(k.Bytes())
	} else {
		raw, err := hex.DecodeString(tweakedPrivkeyHex)
		if err != nil {
			return nil, err
		}
		privkey, _ = btcec.PrivKeyFromBytes(raw)
	}

	return &SchnorrSigner{privkey: privkey}, nil
}

// Sign returns a 64-byte BIP-340 signature using the (already-tweaked) private key.
// If you need a sighash type byte, append it at the call site.
func (s *SchnorrSigner) Sign(msgHash []byte) ([]byte, error) {
	sig, err := schnorr.Sign(s.privkey, msgHash)
	if err != nil {
		return nil, err
	}
	return sig.Serialize(), nil
}

// XOnlyPubKey returns the 32-byte x-only internal key for Taproot.
func (s *SchnorrSigner) PrivKey() []byte {
	return s.privkey.Serialize()
}

// XOnlyPubKey returns the 32-byte x-only internal key for Taproot.
func (s *SchnorrSigner) PubKey() []byte {
	return schnorr.SerializePubKey(s.privkey.PubKey()) // 32 bytes (x-only)
}

func evenizePriv(priv *btcec.PrivateKey) *btcec.PrivateKey {
	if priv.PubKey().Y().Bit(0) == 1 { // odd Y
		n := btcec.S256().N
		k := new(big.Int).Sub(n, new(big.Int).SetBytes(priv.Serialize()))
		k.Mod(k, n)
		if k.Sign() == 0 {
			k = big.NewInt(1) // extremely unlikely; avoid zero
		}
		p, _ := btcec.PrivKeyFromBytes(k.Bytes())
		return p
	}
	return priv
}

// TapTweak = taggedHash("TapTweak", xonly(P) || merkleRoot)
func tapTweakHash(xonly []byte, merkleRoot []byte) []byte {
	tag := sha256.Sum256([]byte("TapTweak"))
	h := sha256.New()
	h.Write(tag[:])
	h.Write(tag[:])
	h.Write(xonly)
	if len(merkleRoot) > 0 {
		h.Write(merkleRoot)
	}
	return h.Sum(nil)
}
