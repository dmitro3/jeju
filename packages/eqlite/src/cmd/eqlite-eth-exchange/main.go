
package main

import (
	"context"
	"errors"
	"flag"
	"os"

	validator "gopkg.in/go-playground/validator.v9"
	yaml "gopkg.in/yaml.v2"

	"eqlite/src/conf"
	"eqlite/src/utils"
	"eqlite/src/utils/log"
)

var (
	configFile string
	logLevel   string
)

func init() {
	flag.StringVar(&configFile, "config", "~/.eqlite/config.yaml", "Config file path")
	flag.StringVar(&logLevel, "log-level", "", "Log level")
}

func main() {
	flag.Parse()
	log.SetStringLevel(logLevel, log.InfoLevel)
	configFile = utils.HomeDirExpand(configFile)

	cfg, err := loadConfig()
	if err != nil {
		return
	}

	xchg, err := NewExchange(cfg)
	if err != nil {
		return
	}

	err = xchg.Start(context.Background())
	if err != nil {
		return
	}

	<-utils.WaitForExit()

	xchg.Stop()
}

func loadConfig() (cfg *ExchangeConfig, err error) {
	_, err = conf.LoadConfig(configFile)
	if err != nil {
		log.WithError(err).Error("read eqlite config failed")
		return
	}

	var configBytes []byte
	if configBytes, err = os.ReadFile(configFile); err != nil {
		log.WithError(err).Error("read config file failed")
		return
	}

	r := &struct {
		Exchange *ExchangeConfig `json:"Exchange,omitempty" yaml:"Exchange,omitempty"`
	}{}
	if err = yaml.Unmarshal(configBytes, r); err != nil {
		log.WithError(err).Error("unmarshal config file failed")
		return
	}

	if r.Exchange == nil {
		err = errors.New("nil exchange config")
		log.Error("could not read exchange config")
		return
	}

	validate := validator.New()
	if err = validate.Struct(*r.Exchange); err != nil {
		log.WithError(err).Error("validate config failed")
		return
	}

	cfg = r.Exchange
	return
}
