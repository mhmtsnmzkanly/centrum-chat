export interface TransactionManager {
  run<T>(fn: () => T): T;
}
