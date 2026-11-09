Apply fixes for correctness bugs, failing tests, failing CI checks and leaked secrets.
Do not apply fixes that change the match scoring weights or the Keynote load bounds; leave those as comments for a human.
Do not apply fixes to files under deploy/ that change replicas or resource limits.
