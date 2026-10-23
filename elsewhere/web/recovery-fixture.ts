// Imported only by DEV preview routes. Never changes real transport or credentials.
let unavailable = false;
export function setRecoveryUnavailable(value: boolean) {
  unavailable = value;
}
export function recoveryFixture() {
  if (unavailable)
    throw Object.assign(new Error('Failed to fetch'), { status: 0 });
  return { message: '周末一起去逛旧书店吧。', author: '林间' };
}
