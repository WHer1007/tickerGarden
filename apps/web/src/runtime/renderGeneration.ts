// A render owns both its local generation (filters) and captured snapshot
// identity. Async results may touch the DOM only while both remain current.
export function createRenderGeneration<T>(current: () => T) {
 let generation = 0;
 return {
  begin() {
   const own = ++generation;
   const snapshot = current();
   return { snapshot, isCurrent: () => own === generation && current() === snapshot };
  },
  invalidate() { generation++; },
 };
}
