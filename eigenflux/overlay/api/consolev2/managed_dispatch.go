package consolev2

import (
	"context"
	"eigenflux_server/pkg/metrics"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"os"
	"strconv"
	"time"
)

var managedActive = promauto.With(metrics.Registry).NewGauge(prometheus.GaugeOpts{Name: "elsewhere_managed_active", Help: "Current model/publication jobs in this process."})
var managedDuration = promauto.With(metrics.Registry).NewHistogram(prometheus.HistogramOpts{Name: "elsewhere_managed_job_seconds", Help: "Model/publication job duration.", Buckets: []float64{1, 5, 15, 30, 60, 120, 210, 300}})

// Slots are acquired before budget reservation. Existing database admission
// prevents concurrent execution of the same Agent across all instances.
func managedConcurrency() int {
	n, err := strconv.Atoi(os.Getenv("AGENTNET_MANAGED_CONCURRENCY"))
	if err != nil {
		return 2
	}
	return max(1, min(4, n))
}
func dispatchManagedBatch(slots chan struct{}, claim func() (*managedJob, error), execute func(managedJob)) error {
	for i := 0; i < cap(slots); i++ {
		select {
		case slots <- struct{}{}:
		default:
			return nil
		}
		job, err := claim()
		if err != nil || job == nil {
			<-slots
			return err
		}
		go func(job managedJob) {
			defer func() { <-slots }()
			managedActive.Inc()
			defer managedActive.Dec()
			started := time.Now()
			defer func() { managedDuration.Observe(time.Since(started).Seconds()) }()
			execute(job)
		}(*job)
	}
	return nil
}
func (s *Service) managedDispatchLoop() {
	slots := make(chan struct{}, managedConcurrency())
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		if !managedModelConfigured() {
			continue
		}
		err := dispatchManagedBatch(slots, func() (*managedJob, error) {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			return s.claimManaged(ctx, time.Now())
		}, func(job managedJob) {
			ctx, cancel := context.WithTimeout(context.Background(), 210*time.Second)
			defer cancel()
			s.executeManaged(ctx, job)
		})
		if err != nil {
			s.managedBeat("claim_failed")
		}
	}
}
