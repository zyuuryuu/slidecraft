# Contributing to SlideCraft

Thanks for your interest in SlideCraft! Contributions — bug reports, fixes, features, docs — are
welcome.

## Quick start

```bash
npm install
npm run tauri dev   # run the desktop app (or `npm run dev` for the browser dev build)
npm test            # vitest unit suite
npm run build       # tsc + vite production build
npm run lint        # eslint
```

## Ground rules

- **Discuss first for anything large.** Open an issue before a big change so we can agree on the
  approach.
- **Tests are expected.** New features and bug fixes should come with tests; keep the suite green
  (`npm test`, and `npm run build` to catch type errors).
- **Conventional commits.** Use `feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`.
- **Be excellent to each other.** This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- **Security issues** go through [SECURITY.md](SECURITY.md), not public issues.

## More

The full contributor guide — architecture, coding rules, the engine/UI split, and the review process
— lives in [docs/guide/contributing.md](docs/guide/contributing.md)
(also on the [documentation site](https://zyuuryuu.github.io/slidecraft/guide/contributing.html)).

By contributing, you agree that your contributions are licensed under the project's
[Apache-2.0](LICENSE) license.
