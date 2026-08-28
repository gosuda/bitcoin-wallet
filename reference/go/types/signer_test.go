package types

import (
	"crypto/sha256"
	"encoding/hex"
	"math/big"
	"testing"

	"github.com/btcsuite/btcd/btcec/v2"
	ecdsa_btcec "github.com/btcsuite/btcd/btcec/v2/ecdsa"
	"github.com/btcsuite/btcd/btcec/v2/schnorr"
	"github.com/stretchr/testify/require"
)

func TestECDSASigner_GenerateAndSign(t *testing.T) {
	s, err := NewECDSASigner("")
	require.NoError(t, err)
	msgHash := sha256.Sum256([]byte("hello world!"))

	der, err := s.Sign(msgHash[:])
	require.NoError(t, err)

	sig, err := ecdsa_btcec.ParseDERSignature(der)
	require.NoError(t, err)
	verify := sig.Verify(msgHash[:], s.privkey.PubKey())
	require.True(t, verify, "ecdsa signature verification failed")

}

func TestECDSASigner_FromHexAndSign(t *testing.T) {
	base, _ := btcec.NewPrivateKey()
	privHex := hex.EncodeToString(base.Serialize())

	s, err := NewECDSASigner(privHex)
	require.NoError(t, err)

	gotPub := s.PubKey()
	wantPub := base.PubKey().SerializeCompressed()
	require.Equal(t, hex.EncodeToString(gotPub), hex.EncodeToString(wantPub), "pubkey mismatch")

	msgHash := sha256.Sum256([]byte("hello world!"))
	der, err := s.Sign(msgHash[:])
	require.NoError(t, err)

	sig, err := ecdsa_btcec.ParseDERSignature(der)
	require.NoError(t, err)

	verify := sig.Verify(msgHash[:], s.privkey.PubKey())
	require.True(t, verify, "ecdsa signature verification failed")
}

func TestNewSchnorrSigner_GenerateTweakedAndSign(t *testing.T) {
	s, err := NewSchnorrSigner("")
	require.NoError(t, err)

	msgHash := sha256.Sum256([]byte("hello world!"))
	sigBytes, err := s.Sign(msgHash[:])
	require.NoError(t, err)

	sig, err := schnorr.ParseSignature(sigBytes)
	require.NoError(t, err)

	// Verify against the tweaked public key
	pub := s.privkey.PubKey()
	verify := sig.Verify(msgHash[:], pub)
	require.True(t, verify, "schnorr signature verification failed")
}

func TestNewSchnorrSigner_UseProvidedTweakedKey(t *testing.T) {
	// Create an internal key, evenize, tweak manually, then pass tweaked hex in.
	internal, _ := btcec.NewPrivateKey()
	internalEven := evenizePriv(internal)
	xonly := schnorr.SerializePubKey(internalEven.PubKey())
	tweak := tapTweakHash(xonly, nil)

	n := btcec.S256().N
	k := new(big.Int).SetBytes(internalEven.Serialize())
	tw := new(big.Int).SetBytes(tweak)
	k.Add(k, tw)
	k.Mod(k, n)
	if k.Sign() == 0 {
		t.Fatalf("zero tweaked key (unexpected)")
	}
	tweakedPriv, _ := btcec.PrivKeyFromBytes(k.Bytes())

	hexTweaked := hex.EncodeToString(tweakedPriv.Serialize())
	s, err := NewSchnorrSigner(hexTweaked)
	require.NoError(t, err)

	// Sign & verify
	msgHash := sha256.Sum256([]byte("hello world!"))
	sigBytes, err := s.Sign(msgHash[:])
	require.NoError(t, err)
	sig, err := schnorr.ParseSignature(sigBytes)
	require.NoError(t, err)
	verify := sig.Verify(msgHash[:], s.privkey.PubKey())
	require.True(t, verify, "schnorr signature verification failed")
}
