# Lean TDD

## Verbatim Prompt Source

```text
imlement lean tdd
```

## Gate

For each change, write the smallest failing test that expresses the requested behavior or invariant before the implementation that satisfies it.

Then implement only the smallest code or documentation change needed for the test to pass.

Run the repo verification command:

```text
bash C:\git\radio\tests\run
```

The runner is the lean acceptance gate for this repository. It includes:

- engine behavior tests
- Z3 invariant proof test
- paywall tests
- static Cloudflare Pages readiness tests
- lean TDD and course-conversion guard tests

## Scope

The lean TDD gate is repository-local. It does not add CI/CD, a backend database, a local delivery target, or a new deployment method.

Provider account setup and Cloudflare dashboard setup remain manual external steps until a prompt names an exact allowed mutation method for those accounts.
