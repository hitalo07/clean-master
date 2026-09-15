export const ORB_CIRCUMFERENCE = 420

export function orbDashOffset(bytes: number, scanning: boolean): number {
  if (scanning) {
    return 120
  }
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return ORB_CIRCUMFERENCE
  }
  return 80
}
