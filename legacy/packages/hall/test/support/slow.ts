/**
 * How much slower than a real machine this one is (CI_SLOW=10 under x64 emulation on an arm64 Mac):
 * multiplies the time budgets of the timing tests, so an emulated run does not fail them for its own
 * slowness. Unset, the budgets are the real ones.
 */
export const SLOW = Number(process.env.CI_SLOW) > 1 ? Number(process.env.CI_SLOW) : 1
