import type { TransactionManager } from "../../src/shared/transactions/transactionManager.ts";

export class FakeTransactionManager implements TransactionManager {
  readonly calls: string[] = [];

  run<T>(fn: () => T): T {
    this.calls.push("run");
    return fn();
  }
}
