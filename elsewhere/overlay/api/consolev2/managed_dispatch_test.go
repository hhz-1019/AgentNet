package consolev2

import (
	"errors"
	"testing"
	"time"
)

func TestManagedDispatchBoundedAndNonblocking(t *testing.T) {
	slots := make(chan struct{}, 2)
	started := make(chan int64, 2)
	release := make(chan struct{})
	done := make(chan struct{}, 2)
	var calls int64
	claim := func() (*managedJob, error) { calls++; return &managedJob{AgentID: calls}, nil }
	execute := func(job managedJob) { started <- job.AgentID; <-release; done <- struct{}{} }
	if err := dispatchManagedBatch(slots, claim, execute); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("jobs did not start concurrently")
		}
	}
	if err := dispatchManagedBatch(slots, claim, execute); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatal("claimed a job without a free slot")
	}
	close(release)
	<-done
	<-done
	for len(slots) > 0 {
		time.Sleep(time.Millisecond)
	}
	expected := errors.New("claim failure")
	if err := dispatchManagedBatch(slots, func() (*managedJob, error) { return nil, expected }, execute); !errors.Is(err, expected) {
		t.Fatal(err)
	}
	if len(slots) != 0 {
		t.Fatal("failed claim leaked a slot")
	}
	if err := dispatchManagedBatch(slots, func() (*managedJob, error) { return nil, nil }, execute); err != nil || len(slots) != 0 {
		t.Fatal("empty queue leaked a slot")
	}
}
