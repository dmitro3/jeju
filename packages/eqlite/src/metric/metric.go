
package metric

import (
	"sort"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/common/version"

	"eqlite/src/utils/log"
)

func init() {
	prometheus.MustRegister(version.NewCollector("EQLite"))
}

// StartMetricCollector starts collector registered in NewNodeCollector().
func StartMetricCollector() (registry *prometheus.Registry) {
	nc, err := NewNodeCollector()
	if err != nil {
		log.WithError(err).Error("couldn't create node collector")
		return
	}

	registry = prometheus.NewRegistry()
	err = registry.Register(nc)
	if err != nil {
		log.WithError(err).Error("couldn't register collector")
		return nil
	}

	log.Info("enabled collectors:")
	var collectors []string
	for n := range nc.Collectors {
		collectors = append(collectors, n)
	}
	sort.Strings(collectors)
	for _, n := range collectors {
		log.Infof(" - %s", n)
	}

	return
}
