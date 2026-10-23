package ownerauth

import "os"

// UIDEnabled selects human authentication independently of Agent credentials.
func UIDEnabled() bool { return os.Getenv("HUMAN_AUTH_MODE") == "uid" }
