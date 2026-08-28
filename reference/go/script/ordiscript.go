package script

import (
	"bytes"
	"encoding/hex"
	"errors"
	"strings"

	"github.com/btcsuite/btcd/txscript"
	"github.com/btcsuite/btcd/wire"
)

const (
	MAX_CHUNK_SIZE   = 520
	ORD_PREFIX       = "ord"
	ORD_PREFIX_BYTES = "6f7264"
	DUST_SATOSHI     = 546
)

func CreateInscriptionScript(pubkey []byte, contentType string, fileBytes []byte, inscriptionAddData []byte) ([]byte, error) {
	builder := txscript.NewScriptBuilder()
	builder.AddData(pubkey) //push schnorr pubkey
	builder.AddOp(txscript.OP_CHECKSIG)
	// Ordinals script
	if len(inscriptionAddData) > 0 {
		builder.AddData(inscriptionAddData)
		builder.AddOp(txscript.OP_DROP)
	}
	builder.AddOp(txscript.OP_FALSE)
	builder.AddOp(txscript.OP_IF)
	builder.AddData([]byte(ORD_PREFIX))
	builder.AddOp(txscript.OP_DATA_1)
	builder.AddOp(txscript.OP_DATA_1)
	builder.AddData([]byte(contentType))
	builder.AddOp(txscript.OP_0)
	data, err := builder.Script()
	if err != nil {
		return nil, err
	}

	// append file
	bodySize := len(fileBytes)
	for i := 0; i < bodySize; i += MAX_CHUNK_SIZE {
		end := i + MAX_CHUNK_SIZE
		if end > bodySize {
			end = bodySize
		}
		builder.AddFullData(fileBytes[i:end])
	}
	data = append(data, txscript.OP_ENDIF)
	return data, err
}

func CreateCommitmentScript(pubkey []byte, commitment []byte) ([]byte, error) {
	builder := txscript.NewScriptBuilder()

	builder.AddData(pubkey)
	builder.AddOp(txscript.OP_CHECKSIG)
	builder.AddOp(txscript.OP_FALSE)
	builder.AddOp(txscript.OP_IF)
	builder.AddData(commitment)
	builder.AddOp(txscript.OP_ENDIF)

	return builder.Script()
}

func GetOrdinalsContent(tapScript []byte) (mime string, content []byte, err error) {
	scriptStr, err := txscript.DisasmString(tapScript)
	if err != nil {
		return "", nil, err
	}
	start := false
	scriptStrArray := strings.Split(scriptStr, " ")
	contentHex := ""
	for i := 0; i < len(scriptStrArray); i++ {
		if scriptStrArray[i] == ORD_PREFIX_BYTES {
			start = true
			mimeBytes, _ := hex.DecodeString(scriptStrArray[i+2])
			mime = string(mimeBytes)
			i = i + 4
		}
		if i < len(scriptStrArray) {
			if start {
				contentHex = contentHex + scriptStrArray[i]
			}
			if scriptStrArray[i] == "OP_ENDIF" {
				break
			}
		}
	}
	contentBytes, _ := hex.DecodeString(contentHex)
	return mime, contentBytes, nil
}

func IsOrdinalsScript(script []byte) bool {
	if bytes.Contains(script, ordiBytes) && script[len(script)-1] == txscript.OP_ENDIF {
		return true
	}
	return false
}

func GetInscriptionContent(tx *wire.MsgTx) (contentType string, content []byte, err error) {
	for _, txIn := range tx.TxIn {
		if IsTapScript(txIn.Witness) {
			if IsOrdinalsScript(txIn.Witness[1]) {
				contentType, data, err := GetOrdinalsContent(txIn.Witness[1])
				if err != nil {
					return "", nil, err
				}
				return contentType, data, nil
			}
		}
	}
	return "", nil, errors.New("no ordinals script found")
}

var ordiBytes []byte

func init() {
	builder := txscript.NewScriptBuilder()
	builder.AddOp(txscript.OP_FALSE)
	builder.AddOp(txscript.OP_IF)
	builder.AddData([]byte("ord"))
	builder.AddOp(txscript.OP_DATA_1)
	ordiBytes, _ = builder.Script()
}
