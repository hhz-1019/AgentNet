package consolev2

import "errors"

// A valid fresh proof does not restore an absent binding. Do not query the
// requested Agent ID here: that would disclose whether another account exists.
var errIdentityRecoveryRequired = errors.New("installation key is not bound to the expected Agent")
