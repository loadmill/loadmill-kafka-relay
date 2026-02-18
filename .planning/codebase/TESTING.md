# Testing Patterns

**Analysis Date:** 2026-02-18

## Test Framework

**Runner:**
- Jest (via `jest` and `ts-jest`)
- Config: `jest.config.js`
  - `preset: 'ts-jest'`
  - `testEnvironment: 'node'`
  - TS transform: `'^.+\\.ts$': ['ts-jest', { isolatedModules: true }]`
  - Ignores build output: `modulePathIgnorePatterns: ['<rootDir>/dist']`

**Assertion Library:**
- Jest built-in `expect` matchers.

**Run Commands:**
```bash
yarn test              # Run all tests (package.json -> node --no-experimental-fetch .../jest)
yarn build             # Runs clean + lint + tsc + test
```
Source: `package.json` scripts.

## Test File Organization

**Location:**
- Tests are in a dedicated top-level `test/` directory.
  - Examples: `test/kafka/consume.test.ts`, `test/kafka/convert.test.ts`

**Naming:**
- Use `*.test.ts` naming.
  - Examples: `test/kafka/consume.test.ts`, `test/kafka/convert.test.ts`

**Structure:**
```
test/
└── kafka/
    ├── consume.test.ts
    └── convert.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
describe('filterMessages', () => {
  it('should filter a message by a header', async () => {
    // arrange
    // act
    // assert
    expect(res).toEqual([message2]);
  });

  afterAll(() => {
    subscriptionsManager.stopDeletingExpiredSubscribers();
  });
});
```
Example: `test/kafka/consume.test.ts`.

**Patterns:**
- Prefer **black-box unit tests** of exported helpers.
  - Example: `test/kafka/consume.test.ts` tests `filterMessages` from `src/kafka/consume.ts`.
- Use inline fixtures (plain objects) and cast to types when convenient.
  - Example: `test/kafka/consume.test.ts` builds objects and casts `as ConsumedMessage`.
- Cleanup global/singleton background work if tests import modules that start timers.
  - Example: `test/kafka/consume.test.ts` calls `subscriptionsManager.stopDeletingExpiredSubscribers()` in `afterAll()`; this corresponds to interval startup in `src/kafka/subscribers/subscribers-manager.ts`.

## Mocking

**Framework:**
- Jest mocking is available but not used in current tests.
  - Evidence: no matches for `jest.mock(` / `jest.spyOn(` in `test/**/*.ts`.

**Patterns:**
- Prefer testing pure/mostly-pure functions without mocking.
  - Examples: `test/kafka/convert.test.ts`, `test/kafka/consume.test.ts`.

**What to Mock:**
- When needed, mock at module boundaries for external systems (Kafka/Redis/Fastify) rather than internal helpers.
  - External boundaries live under: `src/redis/`, `src/kafka/`, `src/router.ts`.

**What NOT to Mock:**
- Avoid mocking pure data transforms.
  - Examples of pure-ish utilities: `src/kafka/deep-modify-object.ts`, `src/kafka/convert.ts`.

## Fixtures and Factories

**Test Data:**
```typescript
const obj = { bar: 1, foo: '2' };
await convert(obj, [{ key: 'foo', type: ConvertType.DECIMAL }]);
expect(obj.foo).toBeInstanceOf(Decimal);
```
Example: `test/kafka/convert.test.ts`.

**Location:**
- No shared fixture/factory directory detected; tests define fixtures inline.

## Coverage

**Requirements:**
- None enforced (no coverage thresholds/config detected in `jest.config.js` or `package.json`).

**View Coverage:**
```bash
node --no-experimental-fetch node_modules/.bin/jest --coverage
```
(`package.json` does not define a dedicated coverage script.)

## Test Types

**Unit Tests:**
- Present; focus on deterministic behavior of helpers and data conversions.
  - Examples: `test/kafka/consume.test.ts`, `test/kafka/convert.test.ts`.

**Integration Tests:**
- Not detected (no tests that boot Fastify server or connect to Kafka/Redis in `test/`).

**E2E Tests:**
- Not used (no Playwright/Cypress configs detected; no E2E folder).

## Common Patterns

**Async Testing:**
```typescript
void expect(async () => await convert(obj, [{ key: 'foo', type: 'foo' as ConvertType }]))
  .rejects
  .toThrow('Unknown convertion type foo');
```
Example: `test/kafka/convert.test.ts`.

**Error Testing:**
- Prefer asserting on error message text for thrown `ClientError` and other errors.
  - Example: `test/kafka/convert.test.ts` asserts `.toThrow('Unknown convertion type foo')`.

---

*Testing analysis: 2026-02-18*
