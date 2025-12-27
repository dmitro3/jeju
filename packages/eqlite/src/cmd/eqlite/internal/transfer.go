

package internal

import (
	"flag"
	"strings"

	"eqlite/src/client"
	"eqlite/src/crypto/hash"
	"eqlite/src/proto"
	"eqlite/src/types"
)

var (
	toUser    string
	toDSN     string
	amount    uint64
	tokenType string
)

// CmdTransfer is eqlite transfer command entity.
var CmdTransfer = &Command{
	UsageLine: "eqlite transfer [common params] [-wait-tx-confirm] [-to-user wallet | -to-dsn dsn] [-amount count] [-token token_type]",
	Short:     "transfer token to target account",
	Long: `
Transfer transfers your token to the target account or database.
The command arguments are target wallet address(or dsn), amount of token, and token type.
e.g.
    eqlite transfer -to-user=43602c17adcc96acf2f68964830bb6ebfbca6834961c0eca0915fcc5270e0b40 -amount=100 -token=Particle

Since EQLite is built on top of the blockchain, you need to wait for the transaction
confirmation before the transfer takes effect.
e.g.
    eqlite transfer -wait-tx-confirm -to-dsn="eqlite://xxxx" -amount=100 -token=Particle
`,
	Flag:       flag.NewFlagSet("Transfer params", flag.ExitOnError),
	CommonFlag: flag.NewFlagSet("Common params", flag.ExitOnError),
	DebugFlag:  flag.NewFlagSet("Debug params", flag.ExitOnError),
}

func init() {
	CmdTransfer.Run = runTransfer

	addCommonFlags(CmdTransfer)
	addConfigFlag(CmdTransfer)
	addWaitFlag(CmdTransfer)
	CmdTransfer.Flag.StringVar(&toUser, "to-user", "", "Target address of an user account to transfer token")
	CmdTransfer.Flag.StringVar(&toDSN, "to-dsn", "", "Target database dsn to transfer token")
	CmdTransfer.Flag.Uint64Var(&amount, "amount", 0, "Token account to transfer")
	CmdTransfer.Flag.StringVar(&tokenType, "token", "", "Token type to transfer, e.g. Particle, Wave")
}

func runTransfer(cmd *Command, args []string) {
	commonFlagsInit(cmd)

	if len(args) > 0 || (toUser == "" && toDSN == "") || tokenType == "" {
		ConsoleLog.Error("transfer command need to-user(or to-dsn) address and token type as param")
		SetExitStatus(1)
		printCommandHelp(cmd)
		Exit()
	}
	if toUser != "" && toDSN != "" {
		ConsoleLog.Error("transfer command accepts either to-user or to-dsn as param")
		SetExitStatus(1)
		printCommandHelp(cmd)
		Exit()
	}

	unit := types.FromString(tokenType)
	if !unit.Listed() {
		ConsoleLog.Error("transfer token failed: invalid token type")
		SetExitStatus(1)
		return
	}

	var addr string
	if toUser != "" {
		addr = toUser
	} else {
		if !strings.HasPrefix(toDSN, client.DBScheme) && !strings.HasPrefix(toDSN, client.DBSchemeAlias) {
			ConsoleLog.Error("transfer token failed: invalid dsn provided, use address start with 'eqlite://'")
			SetExitStatus(1)
			return
		}
		toDSN = strings.TrimPrefix(toDSN, client.DBScheme+"://")
		addr = strings.TrimPrefix(toDSN, client.DBSchemeAlias+"://")
	}

	targetAccountHash, err := hash.NewHashFromStr(addr)
	if err != nil {
		ConsoleLog.WithError(err).Error("target account address is not valid")
		SetExitStatus(1)
		return
	}
	targetAccount := proto.AccountAddress(*targetAccountHash)

	configInit()

	txHash, err := client.TransferToken(targetAccount, amount, unit)
	if err != nil {
		ConsoleLog.WithError(err).Error("transfer token failed")
		SetExitStatus(1)
		return
	}

	if waitTxConfirmation {
		err = wait(txHash)
		if err != nil {
			ConsoleLog.WithError(err).Error("transfer token failed")
			SetExitStatus(1)
			return
		}
	}

	ConsoleLog.Info("succeed in sending transaction to EQLite")
}
