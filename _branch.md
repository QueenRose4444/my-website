Not documentation for the site — a one-command answer to "which branch is this host serving?".

    curl https://rosestuffs.org/_branch.txt        -> master
    curl https://wip.rosestuffs.org/_branch.txt    -> wip

It exists because a Pages custom domain CNAME'd to the PROJECT alias
(`<project>.pages.dev`) silently serves production, while one CNAME'd to the BRANCH
alias (`<branch>.<project>.pages.dev`) serves the branch. Both answer 200 with a
plausible-looking site, so there is no way to tell them apart by eye — and
rosestuffs.org returns the home page at 200 for any missing path, so even a 404
check proves nothing.

If this file ever returns HTML instead of a single word, the host is serving the
missing-path fallback and the branch it claims to be is not the branch you are on.
