// The window's opening size and the smallest size it can be resized to. Shared so the fixture
// gallery renders at exactly the sizes the real window uses.
export const WINDOW_SIZE = {
  default: { width: 1200, height: 720 },
  min: { width: 860, height: 500 }
} as const
