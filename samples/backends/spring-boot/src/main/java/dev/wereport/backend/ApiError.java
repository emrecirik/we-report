package dev.wereport.backend;

/** An error whose message is safe to show to the caller. */
public class ApiError extends RuntimeException {
  private final int status;

  public ApiError(int status, String message) {
    super(message);
    this.status = status;
  }

  public int status() {
    return status;
  }
}
