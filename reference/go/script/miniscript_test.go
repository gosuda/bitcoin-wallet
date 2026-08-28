package script

import (
	"fmt"
	"testing"
	"time"

	"github.com/benma/miniscript-go"
	"github.com/btcsuite/btcd/btcec/v2"
	"github.com/btcsuite/btcd/btcutil"
	"github.com/btcsuite/btcd/txscript"
	"github.com/stretchr/testify/require"
)

func TestPkNode(t *testing.T) {
	for _, test := range []struct {
		compressed bool
	}{
		{true},
		{false},
	} {
		privKey, err := btcec.NewPrivateKey()
		require.NoError(t, err)
		var pubKey []byte
		if test.compressed {
			pubKey = privKey.PubKey().SerializeCompressed()
		} else {
			pubKey = privKey.PubKey().SerializeUncompressed()
		}

		pkNode := &PkNode{PubKey: pubKey}

		// create script from public key
		builder := txscript.NewScriptBuilder()
		pkNode.ToScript(builder)
		script, err := builder.Script()
		require.NoError(t, err)

		// recover public key from script
		pkNodeNew := &PkNode{}
		err = pkNodeNew.FromScript(script)
		require.NoError(t, err)

		require.Equal(t, pubKey, pkNodeNew.PubKey)
	}
}

func TestPkhNode(t *testing.T) {
	for _, test := range []struct {
		compressed bool
	}{
		{true},
		{false},
	} {
		privKey, err := btcec.NewPrivateKey()
		require.NoError(t, err)
		var pubKeyHash []byte
		if test.compressed {
			pubKey := privKey.PubKey().SerializeCompressed()
			pubKeyHash = btcutil.Hash160(pubKey)
		} else {
			pubKey := privKey.PubKey().SerializeUncompressed()
			pubKeyHash = btcutil.Hash160(pubKey)
		}
		pkhNode := &PkhNode{Hash: pubKeyHash}

		// create script from public key
		builder := txscript.NewScriptBuilder()
		pkhNode.ToScript(builder)
		script, err := builder.Script()
		require.NoError(t, err)

		// recover public key from script
		pkhNodeNew := &PkhNode{}
		err = pkhNodeNew.FromScript(script)
		require.NoError(t, err)

		require.Equal(t, pubKeyHash, pkhNodeNew.Hash)
	}
}

func TestAfterNode(t *testing.T) {
	for _, test := range []struct {
		time int64
	}{
		{850000},                  // block height
		{time.Now().UTC().Unix()}, // unix timestamp
		{time.Now().UTC().AddDate(0, 0, -1).Unix()},
		{time.Now().UTC().AddDate(0, 0, 1).Unix()},
	} {
		afterNode := &AfterNode{Time: test.time}

		// create to script
		builder := txscript.NewScriptBuilder()
		afterNode.ToScript(builder)
		script, err := builder.Script()
		require.NoError(t, err)

		// recover from script
		afterNodeNew := &AfterNode{}
		err = afterNodeNew.FromScript(script)
		require.NoError(t, err)

		require.Equal(t, test.time, afterNodeNew.Time)
	}
}

func TestOlderNode(t *testing.T) {
	for _, test := range []struct {
		blockHeight int64
		timeSecond  int64
	}{
		{100, 0},  // 100 block height later
		{0, 2048}, // 2048 seconds later
	} {
		olderNode := &OlderNode{}
		if test.blockHeight > 0 {
			err := olderNode.SetBlock(test.blockHeight)
			require.NoError(t, err)
		} else {
			err := olderNode.SetTime(test.timeSecond)
			require.NoError(t, err)
		}

		// create to script
		builder := txscript.NewScriptBuilder()
		olderNode.ToScript(builder)
		script, err := builder.Script()
		require.NoError(t, err)

		// recover from script
		olderNodeNew := &OlderNode{}
		err = olderNodeNew.FromScript(script)
		require.NoError(t, err)

		require.Equal(t, olderNode.Time, olderNodeNew.Time)
	}
}

func TestMakeMiniscript(t *testing.T) {
	privKey, err := btcec.NewPrivateKey()
	require.NoError(t, err)
	pubKey := privKey.PubKey().SerializeCompressed()

	mini := fmt.Sprintf("pk_h(%x)", pubKey)
	ast, err := miniscript.Parse(mini)
	require.NoError(t, err)

	err = ast.ApplyVars(func(identifier string) ([]byte, error) {
		// Provide the public key hash when requested
		if identifier == fmt.Sprintf("%x", pubKey) {
			return pubKey, nil
		}
		// Return nil if no matching identifier
		return nil, fmt.Errorf("unknown identifier: %s", identifier)
	})
	require.NoError(t, err)

	script, err := ast.Script()
	require.NoError(t, err)
	fmt.Println(script)
}
