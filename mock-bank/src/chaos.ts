/**
 * Chaos controller — injects the runtime/exceptional states the eval hinges on (brief §1, §3.3).
 * Armed explicitly via POST /__chaos so discovery, replay and tests can trigger a state deterministically.
 *
 * Mapping to the error taxonomy (blueprint §9):
 *   interstitial   -> recoverable (dismiss)
 *   transientFails -> recoverable (retry)
 *   sessionExpired -> escalation (human re-auth)
 * (member_not_found / permission_denied are driven by the member id, as legitimate business outcomes.)
 */
export interface ChaosState {
  interstitial: boolean;
  transientFails: number;
  sessionExpired: boolean;
}

export class Chaos {
  private state: ChaosState = { interstitial: false, transientFails: 0, sessionExpired: false };

  arm(patch: Partial<ChaosState> & { reset?: boolean }): ChaosState {
    if (patch.reset) this.state = { interstitial: false, transientFails: 0, sessionExpired: false };
    if (patch.interstitial !== undefined) this.state.interstitial = patch.interstitial;
    if (patch.transientFails !== undefined) this.state.transientFails = patch.transientFails;
    if (patch.sessionExpired !== undefined) this.state.sessionExpired = patch.sessionExpired;
    return { ...this.state };
  }

  /** One-shot: returns true and disarms if an interstitial should fire now. */
  takeInterstitial(): boolean {
    if (!this.state.interstitial) return false;
    this.state.interstitial = false;
    return true;
  }

  /** Returns true (and decrements) if this request should transiently fail. */
  takeTransientFail(): boolean {
    if (this.state.transientFails <= 0) return false;
    this.state.transientFails -= 1;
    return true;
  }

  get expired(): boolean {
    return this.state.sessionExpired;
  }

  clearExpiry(): void {
    this.state.sessionExpired = false;
  }
}
