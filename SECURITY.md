# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub's advisory form:
https://github.com/hellpuffyt/waterfall-lens/security/advisories/new

Do not open a public issue for a suspected vulnerability. If you attach a HAR
file, strip cookies, authorization headers and response bodies first.

## Scope

HAR files are untrusted input. In scope: script or markup from a HAR reaching
the generated HTML report as anything other than text; crashes, hangs or
unbounded resource use on crafted HAR files.

Note that a HAR captured "with content" can itself contain credentials
(cookies, tokens) — waterfall-lens does not copy request/response headers or
bodies into its report, but it does copy full request URLs, including query
strings, so a token passed in a URL ends up in the report. Treat both the HAR
file and the generated report as sensitive.

## Supported versions

Only the latest commit on `main` is supported.
