// SYNTHETIC CI REPRODUCTION. Not the upstream CAE implementation.
// Illustrates identity/version checks and conservative UNKNOWN accounting only.
final class ExecutionLedger {
    private final String executionId;
    private int version = 0;
    private String state = "UNKNOWN";
    private boolean reserved = true;

    ExecutionLedger(String executionId) { this.executionId = executionId; }

    boolean applyObservedState(String observedExecutionId, int observedVersion, String next) {
        if (!executionId.equals(observedExecutionId) || version != observedVersion) return false;
        if (state.equals("SUCCESS") || state.equals("FAILED")) return state.equals(next);
        state = next;
        version++;
        if (next.equals("SUCCESS") || next.equals("FAILED")) reserved = false;
        return true;
    }

    boolean holdsReservation() { return reserved; }
}
