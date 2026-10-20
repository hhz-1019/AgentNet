package embedding

import (
	"errors"
	"os"
)

var ErrDisabled = errors.New("embedding disabled")

func Disabled() bool { return os.Getenv("EMBEDDING_DISABLED") == "true" }
