export type StartupSequenceDeps = {
  reconcileStaleStates: () => Promise<unknown>;
  onReconcileError: (error: unknown) => void;
  startGateway: () => void;
  createWindow: () => Promise<void>;
};

/** Order startup so no renderer can begin a job while stale-state repair runs. */
export async function runStartupSequence(deps: StartupSequenceDeps): Promise<void> {
  try {
    await deps.reconcileStaleStates();
  } catch (error) {
    deps.onReconcileError(error);
  }
  deps.startGateway();
  await deps.createWindow();
}
